"""Live connectivity test against the real gateway. Run manually:

    python tests/test_live.py              # all routed models
    python tests/test_live.py hy3 mimo-v2.5   # subset

Checks that each model answers through its configured route
(direct or proxy) and returns sane JSON for a tiny math task.
"""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from rsi.llm import extract_json, make_client, chat

cfg = json.load(open(os.path.join(ROOT, "config.json"), encoding="utf-8"))
key = open(os.path.join(ROOT, "api_key.txt"), encoding="utf-8").read().strip()
router = make_client(cfg["base_url"], key, routes=cfg.get("routes"))

DEFAULT_MODELS = ["hy3", "mimo-v2.5", "ox-alpha-free", "muse-spark-1.2-contributor"]
TRUTH = 0.4342944819 / 0.52  # log10(e)/(2.02-1.5)

TASK = (
    "A seismic catalog above completeness Mc=1.5 has mean magnitude 2.02. "
    "Estimate b with Aki MLE b = log10(e)/(mean - Mc). Compute it. "
    'Return JSON: {"b": <float>}'
)
SYSTEM = "You output exactly one JSON object and nothing else."


def check(model):
    t0 = time.time()
    reply = chat(router, model,
                 [{"role": "system", "content": SYSTEM},
                  {"role": "user", "content": TASK}],
                 max_tokens=4096)
    dt = round(time.time() - t0, 1)
    data = extract_json(reply["content"])
    if not data or "b" not in data:
        return False, f"no parsable JSON ({dt}s)"
    try:
        b = float(data["b"])
    except (TypeError, ValueError):
        return False, f"b not numeric ({dt}s)"
    if abs(b - TRUTH) > 0.01:
        return False, f"wrong value b={b} vs {TRUTH:.4f} ({dt}s)"
    mode = router.mode_for(model)
    return True, f"b={b} route={mode} {reply['tokens']}tok ({dt}s)"


def main():
    models = sys.argv[1:] or DEFAULT_MODELS
    failed = []
    for m in models:
        try:
            ok, msg = check(m)
        except Exception as e:
            ok, msg = False, f"{type(e).__name__}: {str(e)[:100]}"
        print(("PASS " if ok else "FAIL ") + m + "  " + msg)
        if not ok:
            failed.append(m)
    print("")
    print(str(len(models) - len(failed)) + "/" + str(len(models)) + " live checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
