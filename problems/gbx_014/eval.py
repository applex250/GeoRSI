"""GeoBenchX eval (auto-generated).
reject-reference tasks: deterministic (correct rejection = 1.0, anything else 0).
real tasks: cached LLM judge match score (0/1/2 taxonomy -> 0/0.5/1).
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submission", required=True)
    ap.add_argument("--split", default="private")
    a = ap.parse_args()
    try:
        sub = json.load(open(a.submission, encoding="utf-8"))
    except Exception as e:
        print("##SCORE##0"); print(json.dumps({"error": f"parse fail: {e}"})); return

    steps = sub.get("steps") if isinstance(sub.get("steps"), list) else []
    rejected = bool(sub.get("reject")) or any(
        isinstance(s, dict) and s.get("function_name") == "reject_task" for s in steps
    )

    if a.split == "public":
        # well-formedness only: never leak whether rejection is the reference
        ok = (rejected and len(str(sub.get("reason", ""))) > 10) or (
            isinstance(steps, list)
            and all(isinstance(s, dict) and s.get("function_name") for s in steps)
            and len(str(sub.get("answer", ""))) > 0
        )
        print(f"##SCORE##{1.0 if ok else 0.0:.4f}")
        print(json.dumps({"public": "format_validity"}))
        return

    ref = json.load(open(os.path.join(HERE, "reference", "reference.json"), encoding="utf-8"))
    ref_steps = ref["reference_solutions"][0].get("steps", [])
    ref_is_reject = bool(ref_steps) and ref_steps[0].get("function_name") == "reject_task"

    if ref_is_reject:
        # deterministic reject semantics: correct rejection = full, anything else = no match
        score = 1.0 if rejected else 0.0
        print(f"##SCORE##{score:.4f}")
        print(json.dumps({"mode": "reject-deterministic", "rejected": rejected}))
        return

    if not os.environ.get("RSILAB_JUDGE_KEY"):
        print("##SCORE##0"); print(json.dumps({"error": "no judge creds"})); return
    import judge as judge_mod
    score, reason = judge_mod.match_score(
        ref["task_text"],
        json.dumps(ref["reference_solutions"], ensure_ascii=False),
        json.dumps(sub, ensure_ascii=False)[:6000],
    )
    if score is None:
        print("##SCORE##0"); print(json.dumps({"error": f"judge unusable: {reason}"})); return
    print(f"##SCORE##{score:.4f}")
    print(json.dumps({"mode": "judge-match", "reason": reason[:160]}))


if __name__ == "__main__":
    main()
