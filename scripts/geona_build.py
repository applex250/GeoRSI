"""GeoNatureAgent (93 API-orchestration tasks) -> GeoRSI problems builder.

PLANNING-SEMANTICS adapter: the live FastAPI stack needs .local-dev data files
we do not ship, so episodes test ORCHESTRATION - the agent reads the tool
contract, plans an ordered tool-call sequence with arguments, and composes the
textual answer it would give. Scoring is fully DETERMINISTIC against the
benchmark's own fields (expected_tools / expected_actions / must_contain /
must_not_contain) - no LLM judge required.

  problems/geona_<NN>/
    statement.md   question + category/difficulty + tool contract + format
    eval.py        deterministic sequence/action/content scoring
    reference/     expected.json (hidden)

Usage: python scripts/geona_build.py [--n 93] [--suite geona]
"""
import argparse
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_CASES = os.path.join(ROOT, "benchmarks", "GeoNatureAgent_Benchmark", "geoagentbench", "cases", "benchmark_v5.json")
SRC_TOOLS = os.path.join(ROOT, "benchmarks", "GeoNatureAgent_Benchmark", "api", "agent", "tools", "tools.json")

STATEMENT = """# GeoNature task ({category}, difficulty {difficulty})

## Question
{question}

## Available API tools
Call these by exact name, with JSON arguments matching the schema:

{tool_catalog}

## How to submit
Call the submit tool with a JSON object EXACTLY of this shape:
{{
  "tool_calls": [{{"name": "<exact tool name>", "arguments": {{...}}}}, ...],
  "actions": ["<map action, e.g. fly_to_bounds>", ...],
  "response": "<the textual answer a user would see, containing all key facts/values>"
}}

Order matters: list tool calls in the exact order you would execute them.
Include EVERY call the analysis requires - missing calls score zero on that
step. The response must contain the concrete values/keywords a correct answer
needs, and must not contain error text.

## Grading
Fully deterministic: ordered tool-sequence match (0-0.5), required map
actions coverage (0-0.3), answer-content keyword coverage (0-0.2). Forbidden
content in the response voids the episode.
"""


def tool_catalog_md(tools):
    blocks = []
    for t in tools:
        params = json.dumps(t.get("input_schema", {}), ensure_ascii=False)
        blocks.append(f"### {t['name']}\n{t.get('description', '').strip()}\nargs schema: `{params}`")
    return "\n\n".join(blocks)


def seq_score(expected, got):
    if expected == got:
        return 1.0
    if sorted(expected) == sorted(got):
        return 0.6
    if not expected:
        return 0.0
    # longest ordered subsequence overlap (LCS)
    dp = [[0] * (len(got) + 1) for _ in range(len(expected) + 1)]
    for i, e in enumerate(expected):
        for j, g in enumerate(got):
            dp[i + 1][j + 1] = dp[i][j] + 1 if e == g else max(dp[i][j + 1], dp[i + 1][j])
    lcs = dp[len(expected)][len(got)]
    return 0.4 * (lcs / len(expected))


def main(n, suite):
    cases = json.load(open(SRC_CASES, encoding="utf-8"))[:n]
    tools = json.load(open(SRC_TOOLS, encoding="utf-8"))
    catalog = tool_catalog_md(tools)
    valid_names = {t["name"] for t in tools}

    out_root = os.path.join(ROOT, "problems")
    suite_problems = []
    for i, case in enumerate(cases, 1):
        pid = f"geona_{i:02d}"
        pdir = os.path.join(out_root, pid)
        os.makedirs(os.path.join(pdir, "reference"), exist_ok=True)

        with open(os.path.join(pdir, "statement.md"), "w", encoding="utf-8") as f:
            f.write(STATEMENT.format(
                category=case.get("category", "?"),
                difficulty=case.get("difficulty", "?"),
                question=case["question"].strip(),
                tool_catalog=catalog,
            ))
        with open(os.path.join(pdir, "reference", "expected.json"), "w", encoding="utf-8") as f:
            json.dump({
                "expected_tools": case.get("expected_tools", []),
                "expected_actions": case.get("expected_actions", []),
                "must_contain": case.get("must_contain", []),
                "must_not_contain": case.get("must_not_contain", []),
            }, f, ensure_ascii=False, indent=1)
        with open(os.path.join(pdir, "eval.py"), "w", encoding="utf-8") as f:
            f.write(EVAL_PY)
        with open(os.path.join(pdir, "problem.json"), "w", encoding="utf-8") as f:
            json.dump({
                "genre": "geona",
                "max_turns": 12,
                "eval_cap": 2,
                "episode_timeout_s": 900,
                "eval_timeout_s": 60,
            }, f, indent=2)
        suite_problems.append({"id": pid})
        print(f"{pid}: [{case.get('category')}] {case['question'][:70]}")

    suite_path = os.path.join(ROOT, "config", f"{suite}.problems.json")
    with open(suite_path, "w", encoding="utf-8") as f:
        json.dump({"suite": suite, "problems": suite_problems}, f, indent=2)
    print(f"\nbuilt {len(suite_problems)} problems -> {suite_path}")


EVAL_PY = '''"""GeoNatureAgent eval: deterministic orchestration scoring."""
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
'''

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=93)
    ap.add_argument("--suite", default="geona")
    a = ap.parse_args()
    main(a.n, a.suite)
