#!/usr/bin/env python3
"""Environment-only capability probe for the configured research model.

Reads the authoritative `research_model` block from a GeoRSI config file
(default: config/research-competition-luna.json). The credential is read only
from the environment variable named by `credential_env` (default
GEILIAPI_API_KEY). Never prints request headers or the key.

Required gates (all must pass):
  1. GET /models lists the exact configured model id.
  2. POST /chat/completions returns the same model id with valid usage.
  3. The probe tool call `georsi_capability_probe` is observed.

Reported but not gated by default (provider-dependent echo):
  - provider-observed thinking metadata (`--require-thinking-metadata` to gate)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
THINKING_KEYS = (
    "effective_reasoning_effort",
    "reasoning_effort",
)


def load_policy(config_path: Path) -> dict:
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    policy = cfg.get("research_model")
    if not isinstance(policy, dict) or not policy.get("model"):
        raise SystemExit("config has no research_model block")
    required = ("provider", "base_url", "model", "api", "thinking_level", "max_tokens_field", "credential_env")
    missing = [key for key in required if not policy.get(key)]
    if missing:
        raise SystemExit(f"research_model missing fields: {', '.join(missing)}")
    if policy["api"] != "openai-completions":
        raise SystemExit("research probe currently requires openai-completions")
    if policy["thinking_level"] != "xhigh":
        raise SystemExit("research probe requires thinking_level xhigh")
    return policy


def api_key(policy: dict) -> str:
    key = os.environ.get(policy["credential_env"], "").strip()
    if not key:
        raise SystemExit(f"{policy['credential_env']} is not set")
    return key


def request(policy: dict, path: str, body: dict, timeout: int, retries: int = 2) -> tuple[dict, int]:
    """One request with bounded retries on transient gateway failures (429/5xx)."""
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            policy["base_url"].rstrip("/") + path,
            data=json.dumps(body).encode("utf-8") if body is not None else None,
            headers={
                "Authorization": "Bearer " + api_key(policy),
                "Content-Type": "application/json",
                "User-Agent": UA,
            },
        )
        started = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
            return payload, round(time.monotonic() - started, 3)
        except urllib.error.HTTPError as error:
            detail = error.read(500).decode("utf-8", errors="replace")
            if error.code in (429, 502, 503) and attempt < retries:
                last_error = RuntimeError(f"HTTP {error.code}: {detail}")
                time.sleep(3 * (attempt + 1))
                continue
            raise RuntimeError(f"HTTP {error.code}: {detail}") from error
    raise RuntimeError(f"retries exhausted: {last_error}")


def observed_thinking(payload: dict) -> str | None:
    for key in THINKING_KEYS:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().lower()
    reasoning = payload.get("reasoning")
    if isinstance(reasoning, dict):
        effort = reasoning.get("effort")
        if isinstance(effort, str) and effort.strip():
            return effort.strip().lower()
    return None


def usage_of(payload: dict) -> dict | None:
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        return None
    out = {
        "inputTokens": usage.get("prompt_tokens", usage.get("input_tokens")),
        "outputTokens": usage.get("completion_tokens", usage.get("output_tokens")),
        "totalTokens": usage.get("total_tokens"),
    }
    if any(not isinstance(v, int) or isinstance(v, bool) or v < 0 for v in out.values()):
        return None
    if out["outputTokens"] <= 0 or out["totalTokens"] < out["outputTokens"]:
        return None
    return out


def catalog(policy: dict) -> dict:
    payload, elapsed = request(policy, "/models", None, 20)
    ids = [item.get("id") for item in payload.get("data", []) if isinstance(item, dict)]
    return {
        "probe": "catalog",
        "passed": policy["model"] in ids,
        "model": policy["model"],
        "listed": policy["model"] in ids,
        "catalog_size": len(ids),
        "elapsed_s": elapsed,
    }


def tool_call(policy: dict) -> dict:
    body = {
        "model": policy["model"],
        "messages": [{"role": "user", "content": "Call georsi_capability_probe with answer=1."}],
        "reasoning_effort": policy["thinking_level"],
        policy["max_tokens_field"]: 256,
        "stream": False,
        "tools": [{
            "type": "function",
            "function": {
                "name": "georsi_capability_probe",
                "description": "Record the capability probe answer.",
                "parameters": {
                    "type": "object",
                    "properties": {"answer": {"type": "integer"}},
                    "required": ["answer"],
                    "additionalProperties": False,
                },
                "strict": True,
            },
        }],
        "tool_choice": {"type": "function", "function": {"name": "georsi_capability_probe"}},
    }
    payload, elapsed = request(policy, "/chat/completions", body, 60)
    usage = usage_of(payload)
    choices = payload.get("choices") or []
    message = choices[0].get("message", {}) if choices and isinstance(choices[0], dict) else {}
    calls = message.get("tool_calls") or []
    names = [call.get("function", {}).get("name") for call in calls if isinstance(call, dict)]
    thinking = observed_thinking(payload)
    return {
        "probe": "tool_call",
        "passed": payload.get("model") == policy["model"] and usage is not None and "georsi_capability_probe" in names,
        "model": payload.get("model"),
        "expected_model": policy["model"],
        "tool_calls": names,
        "usage": usage,
        "thinking_metadata": thinking,
        "elapsed_s": elapsed,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(ROOT / "config" / "research-competition-luna.json"))
    parser.add_argument("--mode", choices=["catalog", "tool_call", "all"], default="all")
    parser.add_argument("--require-thinking-metadata", action="store_true",
                        help="fail when the provider does not echo effective xhigh metadata")
    args = parser.parse_args()
    policy = load_policy(Path(args.config))
    probes = {"catalog": catalog, "tool_call": tool_call}
    results = []
    for name, probe in probes.items():
        if args.mode not in ("all", name):
            continue
        try:
            results.append(probe(policy))
        except Exception as error:  # bounded diagnostics, never key material
            results.append({"probe": name, "passed": False, "error": f"{type(error).__name__}: {error}"[:500]})
    if args.require_thinking_metadata:
        for result in results:
            if result.get("probe") == "tool_call" and result.get("thinking_metadata") != "xhigh":
                result["passed"] = False
                result["error"] = "provider did not echo effective xhigh thinking metadata"
    summary = {
        "provider": policy["provider"],
        "model": policy["model"],
        "api": policy["api"],
        "base_url": policy["base_url"],
        "results": results,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if not results or not all(result.get("passed") is True for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    sys.exit(main())
