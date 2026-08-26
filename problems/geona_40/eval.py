"""GeoNatureAgent eval: deterministic orchestration scoring."""
import argparse
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submission", required=True)
    a = ap.parse_args()
    try:
        sub = json.load(open(a.submission, encoding="utf-8"))
    except Exception as e:
        print("##SCORE##0"); print(json.dumps({"error": f"parse fail: {e}"})); return

    exp = json.load(open(os.path.join(HERE, "reference", "expected.json"), encoding="utf-8"))
    resp = str(sub.get("response", ""))
    low = resp.lower()

    for bad in exp.get("must_not_contain", []):
        if str(bad).lower() in low:
            print("##SCORE##0")
            print(json.dumps({"reason": f"forbidden content: {bad}"}))
            return

    calls = [c.get("name") for c in sub.get("tool_calls", []) if isinstance(c, dict) and c.get("name")]
    expected_tools = exp.get("expected_tools", [])
    if calls == expected_tools:
        seq = 1.0
    elif sorted(calls) == sorted(expected_tools):
        seq = 0.6
    else:
        dp = [[0] * (len(calls) + 1) for _ in range(len(expected_tools) + 1)]
        for i, e in enumerate(expected_tools):
            for j, g in enumerate(calls):
                dp[i + 1][j + 1] = dp[i][j] + 1 if e == g else max(dp[i][j + 1], dp[i + 1][j])
        lcs = dp[len(expected_tools)][len(calls)]
        seq = 0.4 * (lcs / len(expected_tools)) if expected_tools else 0.0

    actions = set(sub.get("actions", []))
    needed = exp.get("expected_actions", [])
    act = (len([x for x in needed if x in actions]) / len(needed)) if needed else 1.0

    keys = exp.get("must_contain", [])
    content = (sum(1 for k in keys if str(k).lower() in low) / len(keys)) if keys else 1.0

    score = 0.5 * seq + 0.3 * act + 0.2 * content
    print(f"##SCORE##{score:.4f}")
    print(json.dumps({"seq": round(seq, 2), "actions": round(act, 2), "content": round(content, 2),
                      "detail": {"calls": calls, "expected": expected_tools}}))


if __name__ == "__main__":
    main()
