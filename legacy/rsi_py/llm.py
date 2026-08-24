"""OpenAI-compatible LLM client: per-model routing, retry, browser UA."""

import json
import re
import time

import httpx
from openai import OpenAI

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126 Safari/537.36")

TOKENS = {"total": 0}

# Verified connectivity matrix (2024 probe): muse models are region-locked
# behind Cloudflare and only reachable through the local proxy; the rest
# connect directly.
DEFAULT_ROUTES = {
    "muse-spark-1.2-contributor": "proxy",
}


class ModelRouter:
    """Holds one shared OpenAI client per connection mode.

    modes: "direct" (ignore proxy env) and "proxy" (honour env proxies).
    """

    def __init__(self, base_url, api_key, routes=None):
        self.base_url = base_url
        self.api_key = api_key
        self.routes = dict(DEFAULT_ROUTES)
        if routes:
            self.routes.update(routes)
        self._clients = {}

    def mode_for(self, model):
        return self.routes.get(model, "direct")

    def client_for(self, model):
        mode = self.mode_for(model)
        if mode not in self._clients:
            self._clients[mode] = OpenAI(
                base_url=self.base_url,
                api_key=self.api_key,
                http_client=httpx.Client(
                    headers={"User-Agent": UA}, timeout=180.0,
                    trust_env=(mode == "proxy"),
                ),
            )
        return self._clients[mode]


def make_client(base_url, api_key, routes=None):
    return ModelRouter(base_url, api_key, routes)


def _wait_for(attempt):
    return min(90, 2 ** attempt)


def chat(router, model, messages, max_tokens=4096, temperature=0.7,
         max_retries=8):
    """Chat completion with bounded exponential-backoff retry.

    router: a ModelRouter (per-model direct/proxy routing) or a plain
    OpenAI client (used directly). Models whose id starts with "muse-"
    are served over the Responses API and routed accordingly.
    """
    if isinstance(router, ModelRouter):
        client = router.client_for(model)
    else:
        client = router
    if model.startswith("muse-"):
        return _chat_responses(client, model, messages, max_tokens,
                               temperature, max_retries)
    for attempt in range(1, max_retries + 1):
        try:
            resp = client.chat.completions.create(
                model=model, messages=messages,
                max_tokens=max_tokens, temperature=temperature,
            )
            content = resp.choices[0].message.content or ""
            usage = resp.usage
            tok = usage.total_tokens if usage else 0
            TOKENS["total"] += tok
            return {"content": content, "tokens": tok}
        except Exception as e:
            if attempt == max_retries:
                raise
            wait = _wait_for(attempt)
            msg = f"  [llm retry {attempt}/{max_retries}] {type(e).__name__}: {e}; wait {wait}s"
            print(msg)
            time.sleep(wait)


def _responses_content(resp):
    text = getattr(resp, "output_text", None)
    if text:
        return text
    parts = []
    for item in getattr(resp, "output", None) or []:
        for c in getattr(item, "content", None) or []:
            t = getattr(c, "text", None)
            if t:
                parts.append(t)
    return "\n".join(parts)


def _chat_responses(client, model, messages, max_tokens, temperature, max_retries):
    """Same contract as chat(), via the OpenAI Responses API."""
    for attempt in range(1, max_retries + 1):
        try:
            msgs = []
            for m in messages:
                if m["role"] == "assistant":
                    part = [{"type": "output_text", "text": m["content"]}]
                else:
                    part = [{"type": "input_text", "text": m["content"]}]
                msgs.append({"role": m["role"], "content": part})
            resp = client.responses.create(
                model=model, input=msgs,
                max_output_tokens=max_tokens,
                temperature=max(0.0, min(temperature, 2.0)),
            )
            content = _responses_content(resp)
            usage = getattr(resp, "usage", None)
            tok = getattr(usage, "total_tokens", 0) if usage else 0
            TOKENS["total"] += tok
            return {"content": content, "tokens": tok}
        except Exception as e:
            if attempt == max_retries:
                raise
            wait = _wait_for(attempt)
            msg = f"  [llm retry {attempt}/{max_retries}] {type(e).__name__}: {e}; wait {wait}s"
            print(msg)
            time.sleep(wait)


JSON_FENCE_RE = re.compile(r"```(?:json)?\s*({.*?})\s*```", re.DOTALL)


def extract_json(text):
    """Extract the first JSON object from a reply (tolerates fences/prose)."""
    m = JSON_FENCE_RE.search(text)
    candidates = [m.group(1)] if m else [text]
    dec = json.JSONDecoder()
    for c in candidates:
        start = c.find("{")
        while start != -1:
            try:
                obj, _ = dec.raw_decode(c[start:])
                if isinstance(obj, dict):
                    return obj
            except ValueError:
                pass
            start = c.find("{", start + 1)
    return None