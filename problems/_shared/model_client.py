"""Unified model-calling layer (Python side) — mirrors src/models.ts.

Single source of truth: config/model-profiles.json. One entry point:

    from model_client import complete
    text = complete("hy3", [{"role": "user", "content": "..."}], level="high")

Handles per-model adaptations transparently:
  - reasoning parameter style + accepted-level clamping (zen effort style)
  - dsv4f deep thinking via thinking_budget (the only real "max" there)
  - muse: Responses API path, reasoning parameters stripped entirely
  - retry/backoff from stability class

judge.py will switch to this after the running evolution finishes; until then
it keeps its own call path so an active run's grading code never changes.
"""
import json
import os
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # problems/_shared -> repo root
PROFILES_PATH = os.path.join(ROOT, "config", "model-profiles.json")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"

_LEVEL_ORDER = ["off", "minimal", "none", "low", "medium", "high", "xhigh", "max"]


def _research_model():
    """Authoritative research model policy from config.json (may be absent)."""
    try:
        cfg = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
    except Exception:
        return None
    rm = cfg.get("research_model")
    return rm if isinstance(rm, dict) and rm.get("model") else None


def _key_for(endpoint):
    if endpoint == "local":
        p = os.path.join(ROOT, "api_key_local.txt")
        return open(p, encoding="utf-8").read().strip() if os.path.exists(p) else ""
    if endpoint == "openrouter":
        p = os.path.join(ROOT, "api_key_or.txt")
        return open(p, encoding="utf-8").read().strip() if os.path.exists(p) else ""
    if endpoint == "emooo":
        return os.environ.get("RSILAB_EMOOO_API_KEY", os.environ.get("GEORSI_EMOOO_API_KEY", "")).strip()
    if endpoint in ("geiliapi", "research"):
        rm = _research_model() or {}
        return os.environ.get(rm.get("credential_env", "GEILIAPI_API_KEY"), "").strip()
    if endpoint == "ai-pixel":
        return os.environ.get("AI_PIXEL_API_KEY", "").strip()
    return open(os.path.join(ROOT, "api_key.txt"), encoding="utf-8").read().strip()


def _base_for(endpoint):
    cfg = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
    if endpoint == "local":
        return cfg["local_base_url"]
    if endpoint == "openrouter":
        return cfg.get("openrouter_base_url", "https://openrouter.ai/api/v1")
    if endpoint == "emooo":
        return cfg.get("emooo_base_url", "https://api.emooo.cc/v1")
    if endpoint in ("geiliapi", "research"):
        rm = _research_model() or {}
        return os.environ.get("GEILIAPI_BASE_URL", rm.get("base_url", cfg.get("geiliapi_base_url", "https://sub.geiliapi.com/v1")))
    if endpoint == "ai-pixel":
        return os.environ.get("AI_PIXEL_BASE_URL", cfg.get("ai_pixel_base_url", "https://api.ai-pixel.online/v1"))
    return cfg["base_url"]


def _max_tokens_field(model_id):
    """max_completion_tokens for the configured research model; else max_tokens."""
    rm = _research_model()
    if rm and rm.get("model") == model_id:
        return rm.get("max_tokens_field", "max_completion_tokens")
    return "max_tokens"


def _load_profiles():
    # stateless by design: a same-named cache global would shadow this
    # function after first call (dict rebind) and break every later caller
    return json.load(open(PROFILES_PATH, encoding="utf-8"))


def resolve_thinking(model_id, wanted="low", budget_tokens=None):
    """-> (level, extra_body_params, note). Same clamping rules as TS."""
    prof = _load_profiles()["models"].get(model_id)
    if not prof:
        raise KeyError(f"no profile for model {model_id!r} in config/model-profiles.json")
    r = prof.get("reasoning", {})
    if r.get("style") == "none":
        return wanted, {}, f"{model_id}: reasoning params stripped"
    accepted = set(r.get("levels_accepted", [])) | set(r.get("levels_accepted_trusted_history", []))
    level = wanted
    note = ""
    if accepted and wanted not in accepted:
        ranked = [l for l in _LEVEL_ORDER if l in accepted]
        wi = _LEVEL_ORDER.index(wanted)
        best = min(ranked, key=lambda l: (abs(_LEVEL_ORDER.index(l) - wi), -_LEVEL_ORDER.index(l)))
        floor = r.get("quality_floor")
        if floor and _LEVEL_ORDER.index(best) < _LEVEL_ORDER.index(floor) <= wi:
            best = floor
        level = best
        note = f"{model_id}: {wanted!r} -> clamped to {level!r}"
    extra = {}
    if r.get("style") == "effort_plus_budget" and r.get("budget_param"):
        if level in ("xhigh", "max") or budget_tokens:
            extra[r["budget_param"]] = budget_tokens or (32768 if level == "max" else 16384)
        elif level != "off":
            extra["reasoning_effort"] = level
    elif r.get("style") == "reasoning_effort":
        if r.get("thinking_format") == "zai":
            if level == "off":
                extra["thinking"] = {"type": "disabled"}
            else:
                extra["thinking"] = {"type": "enabled", "clear_thinking": False}
                extra["reasoning_effort"] = level
        else:
            extra["reasoning_effort"] = level
    return level, extra, note


def _is_conn_drop(e):
    txt = str(e).lower()
    return "remote" in txt or "eof" in txt or "reset" in txt or "timed out" in txt or "timeout" in txt


def _stream_complete(base, key, body, timeout):
    """SSE streaming completion — resilience fallback for long generations."""
    payload = dict(body)
    payload["stream"] = True
    req = urllib.request.Request(base + "/chat/completions", data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}",
                 "User-Agent": UA, "Accept": "text/event-stream"})
    buf = []
    with urllib.request.urlopen(req, timeout=timeout) as r:
        for raw in r:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            try:
                d = json.loads(line[6:])
            except Exception:
                continue
            piece = ((d.get("choices") or [{}])[0].get("delta") or {}).get("content") or ""
            if piece:
                buf.append(piece)
    text = "".join(buf).strip()
    if not text:
        raise RuntimeError("stream produced no content")
    return text


def complete(model_id, messages, level="low", budget_tokens=None, max_tokens=4000, timeout=180):
    """The one method. Returns the assistant text; raises on final failure."""
    prof = _load_profiles()["models"][model_id]
    base = _base_for(prof["endpoint"])
    key = _key_for(prof["endpoint"])
    _, extra, note = resolve_thinking(model_id, level, budget_tokens)
    cls = prof.get("stability_class", "B")
    retries, backoffs = (5, [2, 5, 10, 20, 30]) if cls.startswith(("B", "C", "D")) else (4, [2, 5, 10, 15])

    last_err = None
    for attempt in range(retries):
        if prof["api_style"] == "responses":
            body = {"model": model_id, "input": "\n".join(str(m.get("content")) for m in messages),
                    "max_output_tokens": max_tokens}
            effort = extra.get("reasoning_effort")
            if effort:
                body["reasoning"] = {"effort": effort}
            path = "/responses"
        else:
            body = {"model": model_id, "messages": messages,
                    _max_tokens_field(model_id): max_tokens,
                    "temperature": 0, **extra}
            path = "/chat/completions"
        req = urllib.request.Request(base + path, data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}", "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                out = json.loads(r.read().decode())
            if prof["api_style"] == "responses":
                direct = out.get("output_text")
                if isinstance(direct, str) and direct.strip():
                    return direct.strip()
                texts = []
                for item in out.get("output") or []:
                    if not isinstance(item, dict):
                        continue
                    for part in item.get("content") or []:
                        if isinstance(part, dict) and isinstance(part.get("text"), str):
                            texts.append(part["text"])
                text = "\n".join(texts).strip()
                if not text:
                    raise RuntimeError(f"empty responses output: {str(out)[:120]}")
                return text
            content = (out["choices"][0]["message"].get("content") or "").strip()
            if not content:
                raise RuntimeError("empty completion")
            return content
        except Exception as e:  # noqa: BLE001
            last_err = e
            if note:
                last_err = RuntimeError(f"{note}; {e}")
            # stream fallback: long generations on free tiers get killed by
            # idle timeouts (measured RemoteDisconnected at ~60s); streaming
            # keeps bytes flowing so the same request survives
            if prof["api_style"] == "chat-completions" and _is_conn_drop(e) and not body.get("stream"):
                try:
                    return _stream_complete(base, key, body, timeout)
                except Exception as se:  # noqa: BLE001
                    last_err = se
            if attempt < retries - 1:
                time.sleep(backoffs[min(attempt, len(backoffs) - 1)])
    raise RuntimeError(f"complete({model_id!r}) failed after {retries} attempts: {last_err}")


if __name__ == "__main__":
    import sys

    mid = sys.argv[1] if len(sys.argv) > 1 else "dsv4f"
    lv = sys.argv[2] if len(sys.argv) > 2 else "low"
    lvl, extra, note = resolve_thinking(mid, lv)
    print(f"resolve({mid}, {lv}) -> level={lvl} extra={extra} note={note}")
