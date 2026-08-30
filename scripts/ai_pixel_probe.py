#!/usr/bin/env python3
"""Environment-only ai-pixel Responses probe for gpt-5.6-luna.

Never prints request headers or the API key. Run only after rotating any key
that has appeared in a command line, transcript, or log.
"""
from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request

BASE = os.environ.get("AI_PIXEL_BASE_URL", "https://api.ai-pixel.online/v1").rstrip("/")
MODEL = "gpt-5.6-luna"


def api_key() -> str:
    key = os.environ.get("AI_PIXEL_API_KEY", "").strip()
    if not key:
        raise SystemExit("AI_PIXEL_API_KEY is not set")
    return key


def request(body: dict, timeout: int = 180) -> tuple[dict, float]:
    req = urllib.request.Request(
        BASE + "/responses",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + api_key(),
            "Content-Type": "application/json",
            "User-Agent": "GeoRSI-Luna-Probe/1.0",
        },
    )
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read(500).decode("utf-8", errors="replace")
        raise RuntimeError(f"Responses HTTP {error.code}: {detail}") from error
    return payload, time.monotonic() - started


def output_text(payload: dict) -> str:
    direct = payload.get("output_text")
    if isinstance(direct, str):
        return direct.strip()
    texts: list[str] = []
    for item in payload.get("output", []) if isinstance(payload.get("output"), list) else []:
        for part in item.get("content", []) if isinstance(item, dict) else []:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                texts.append(part["text"])
    return "\n".join(texts).strip()


def summary(payload: dict, elapsed: float) -> dict:
    usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
    return {
        "model": payload.get("model", MODEL),
        "status": payload.get("status"),
        "elapsed_s": round(elapsed, 3),
        "output_chars": len(output_text(payload)),
        "output_preview": output_text(payload)[:120],
        "usage": usage,
        "error": payload.get("error"),
    }


def basic() -> dict:
    payload, elapsed = request({
        "model": MODEL,
        "input": "Reply with exactly: ok",
        "reasoning": {"effort": "xhigh"},
        "max_output_tokens": 256,
    })
    result = summary(payload, elapsed)
    result["passed"] = output_text(payload).lower() == "ok"
    result["requested_thinking"] = "xhigh"
    return result


def tool() -> dict:
    payload, elapsed = request({
        "model": MODEL,
        "input": "A seismic wave travels 240 km at 8 km/s. Call record_answer with the result.",
        "reasoning": {"effort": "xhigh"},
        "max_output_tokens": 2048,
        "tools": [{
            "type": "function",
            "name": "record_answer",
            "description": "Record the computed answer.",
            "parameters": {
                "type": "object",
                "properties": {
                    "answer": {"type": "number"},
                    "unit": {"type": "string"},
                },
                "required": ["answer", "unit"],
                "additionalProperties": False,
            },
            "strict": True,
        }],
        "tool_choice": {"type": "function", "name": "record_answer"},
    })
    calls = []
    for item in payload.get("output", []) if isinstance(payload.get("output"), list) else []:
        if isinstance(item, dict) and item.get("type") == "function_call":
            calls.append({"name": item.get("name"), "arguments": item.get("arguments")})
    result = summary(payload, elapsed)
    result["tool_calls"] = calls
    result["passed"] = any(call.get("name") == "record_answer" for call in calls)
    result["requested_thinking"] = "xhigh"
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["basic", "tool", "all"], default="all")
    args = parser.parse_args()
    results = []
    for name, probe in (("basic", basic), ("tool", tool)):
        if args.mode not in ("all", name):
            continue
        try:
            results.append({"probe": name, **probe()})
        except Exception as error:  # probe must produce bounded diagnostics
            results.append({"probe": name, "passed": False, "error": f"{type(error).__name__}: {error}"[:500]})
    print(json.dumps({"provider": "ai-pixel", "model": MODEL, "results": results}, ensure_ascii=False, indent=2))
    if not results or not all(result.get("passed") is True for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
