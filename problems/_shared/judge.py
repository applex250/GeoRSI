"""Shared LLM-as-judge with a deterministic disk cache.

The cache is the point: adversarial verification re-evals the SAME submission,
and the judge must return the SAME score both times or champion selection
becomes noise. Key = sha256(model + prompt); one line per judgment in
problems/_shared/judge_cache.jsonl.

Never import this from agent-visible code; eval.py only.
Env required: RSILAB_JUDGE_BASE / RSILAB_JUDGE_KEY / RSILAB_JUDGE_MODEL.
"""
import hashlib
import json
import os
import re
import time
import urllib.request

# cache location is overridable so a parallel run can use its own file instead
# of contending append-writes with an active run (see docs/MODELS.md run discipline)
_CACHE_PATH = os.environ.get(
    "RSILAB_JUDGE_CACHE",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "judge_cache.jsonl"),
)
_cache = None


def _load_cache():
    global _cache
    if _cache is None:
        _cache = {}
        try:
            with open(_CACHE_PATH, encoding="utf-8") as f:
                for line in f:
                    try:
                        rec = json.loads(line)
                        _cache[rec["k"]] = rec["v"]
                    except Exception:
                        pass
        except FileNotFoundError:
            pass
    return _cache


def _save(k, v):
    try:
        with open(_CACHE_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps({"k": k, "v": v}, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _responses_text(out):
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
    return "\n".join(texts).strip()


def _call(prompt, max_tokens=2000):
    base = os.environ["RSILAB_JUDGE_BASE"].rstrip("/")
    model = os.environ.get("RSILAB_JUDGE_MODEL", "hy3")
    key = os.environ["RSILAB_JUDGE_KEY"]
    api = os.environ.get("RSILAB_JUDGE_API", "chat-completions")
    last_err = None
    for attempt in range(5):
        # Reasoning models can spend the entire completion budget on hidden
        # reasoning when no effort is specified, leaving an empty visible
        # answer. Judges need a short, parseable verdict, so default to low
        # effort; callers can override this for a controlled comparison.
        effort = os.environ.get("RSILAB_JUDGE_REASONING_EFFORT", "low").strip()
        if api == "responses":
            body = {
                "model": model,
                "input": prompt,
                "max_output_tokens": max_tokens,
                "reasoning": {"effort": effort or "xhigh"},
            }
            path = "/responses"
        else:
            body = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "temperature": 0,
            }
            if effort and model != "muse-spark-1.2-contributor":
                body["reasoning_effort"] = effort
            path = "/chat/completions"
        body = json.dumps(body).encode()
        # the zen gateway sits behind Cloudflare and rejects non-browser user agents
        req = urllib.request.Request(
            base + path,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {key}",
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                out = json.loads(r.read().decode())
            content = _responses_text(out) if api == "responses" else (out["choices"][0]["message"].get("content") or "").strip()
            if content:
                return content
            last_err = RuntimeError("empty judge response")  # transient: retry
        except Exception as e:  # noqa: BLE001
            last_err = e
        # backoff: gateway rate limits / transient 5xx need time, not hammering
        if attempt < 4:
            time.sleep((2, 5, 15, 30)[attempt])
    raise RuntimeError(f"judge call failed after retries: {last_err}")


def _cached(prompt):
    model = os.environ.get("RSILAB_JUDGE_MODEL", "hy3")
    api = os.environ.get("RSILAB_JUDGE_API", "chat-completions")
    effort = os.environ.get("RSILAB_JUDGE_REASONING_EFFORT", "low")
    k = hashlib.sha256((model + "\x00" + api + "\x00" + effort + "\x00" + prompt).encode("utf-8")).hexdigest()
    cache = _load_cache()
    if k in cache:
        return cache[k]
    v = _call(prompt)
    if v:  # never cache empty responses (poisoned entries stick otherwise)
        cache[k] = v
        _save(k, v)
    return v


def yes_no(question, gold, pred):
    """Synonymy/equivalence check → bool (used by quiz fill fallback)."""
    prompt = (
        f"Question: {question}\nReference answer: {gold}\nCandidate answer: {pred}\n"
        "Do these answers express the SAME entity/concept (allowing case, articles, "
        "and obvious synonyms)? Reply with exactly YES or NO."
    )
    return _cached(prompt).upper().startswith("YES")


def score_0_1(task, reference, submission):
    """Grade an open response against a reference on 0-1 scale."""
    prompt = (
        "You are grading a geoscience agent's work.\n"
        f"TASK: {task}\n\nREFERENCE SOLUTION:\n{reference}\n\n"
        f"AGENT SUBMISSION:\n{submission}\n\n"
        "Score how well the submission accomplishes the task relative to the reference "
        "on 0.0-1.0 (1.0 = fully correct/equivalent, 0.5 = right approach with gaps, "
        "0.0 = wrong or evasive). Ignore style; judge substance only. "
        'Reply with exactly one JSON object: {"score": <float>, "reason": "<one line>"}'
    )
    txt = _cached(prompt)
    m = re.search(r"\{\s*\"score\"\s*:\s*([0-9.]+)", txt)
    if not m:
        fix = "Return ONLY a JSON object like " + '{"score": 0.7, "reason": "..."}' + " - no other text.\n\n" + txt[-1200:]
        repair = _cached(fix)
        m = re.search(r"\{\s*\"score\"\s*:\s*([0-9.]+)", repair)
        if not m:
            return None, (repair or txt)[:200]
        txt = repair
    val = float(m.group(1))
    return max(0.0, min(1.0, val)), txt[:200]


def match_score(task, reference, candidate):
    """GeoBenchX-style solution matching: taxonomy 0/1/2 -> 0.0/0.5/1.0.

    Same considerations as the benchmark's own evaluator: tools, datasets,
    filters, columns and results must line up; colors/wording do not.
    """
    prompt = (
        "You are checking a candidate solution for a geospatial task against reference solutions.\n"
        f"TASK: {task}\n\n"
        f"REFERENCE SOLUTIONS (JSON tool-step chains):\n{reference}\n\n"
        f"CANDIDATE SOLUTION:\n{candidate}\n\n"
        "Matching rules:\n"
        "- same tools and same datasets producing the same results = full match\n"
        "- candidate stops with reject_task and a reference solution is reject_task = full match\n"
        "- non-critical discrepancies (color scheme, legend wording, optional extra step) = partial\n"
        "- different tools, different datasets, different results, or wrong/missing key steps = no match\n"
        "- data years differing by 1 year = partial; 2+ years = no match\n"
        "- different selected columns or non-matching categorical filters = no match\n"
        "First reason within <MATCH REASONING></MATCH REASONING>, then record the score within "
        "<MATCH SCORE>0</MATCH SCORE> or <MATCH SCORE>1</MATCH SCORE> or <MATCH SCORE>2</MATCH SCORE> "
        "(0 = no match, 1 = partial, 2 = full)."
    )
    txt = _cached(prompt)
    m = re.search(r"<MATCH SCORE>\s*([012])", txt)
    if not m:
        fix = (
            "Return ONLY the score inside <MATCH SCORE></MATCH SCORE> tags "
            "(0, 1 or 2) - no other text.\n\n" + txt[-1200:]
        )
        repair = _cached(fix)
        m = re.search(r"<MATCH SCORE>\s*([012])", repair)
        if not m:
            return None, (repair or txt)[:200]
    return int(m.group(1)) / 2.0, txt[:200]
