"""GABench eval: artifact checks + cached LLM judge vs hidden reference."""
import argparse
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))


def safe_artifact_path(ws, value):
    """Resolve a submitted artifact only inside the episode workspace."""
    if not isinstance(value, str) or not value.strip() or os.path.isabs(value):
        return None
    root = os.path.realpath(ws)
    candidate = os.path.realpath(os.path.join(root, value))
    try:
        if os.path.commonpath((root, candidate)) != root:
            return None
    except ValueError:
        return None
    return candidate

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submission", required=True)
    ap.add_argument("--split", default="private")
    a = ap.parse_args()
    try:
        sub = json.load(open(a.submission, encoding="utf-8"))
    except Exception as e:
        print("##SCORE##0"); print(json.dumps({"error": f"parse fail: {e}"})); return

    out_files = sub.get("output_files") if isinstance(sub.get("output_files"), list) else []
    ws = os.path.dirname(os.path.dirname(os.path.abspath(a.submission)))
    present = sum(
        1 for f in out_files
        if (path := safe_artifact_path(ws, f))
        and os.path.isfile(path)
        and os.path.getsize(path) > 1024
    )

    if a.split == "public":
        ok = isinstance(sub.get("summary"), str) and len(sub["summary"]) > 40
        print(f"##SCORE##{1.0 if ok else 0.0:.4f}")
        print(json.dumps({"public": "format_validity"}))
        return

    art = present / max(1, len(out_files)) if out_files else 0.0

    if not os.environ.get("RSILAB_JUDGE_KEY"):
        print("##SCORE##0"); print(json.dumps({"error": "no judge creds"})); return
    import judge as judge_mod
    ref = open(os.path.join(HERE, "reference", "reference.txt"), encoding="utf-8").read()
    score, reason = judge_mod.score_0_1(
        open(os.path.join(HERE, "statement_task.txt"), encoding="utf-8").read(),
        ref,
        json.dumps(sub, ensure_ascii=False)[:5000] + f" | artifacts_present={present}/{len(out_files)}",
    )
    if score is None:
        print("##SCORE##0"); print(json.dumps({"error": f"judge unusable: {reason}"})); return
    score = max(score, 0.15 * art) if art > 0 else score
    print(f"##SCORE##{score:.4f}")
    print(json.dumps({"mode": "judge", "artifacts": f"{present}/{len(out_files)}", "reason": reason[:160]}))


if __name__ == "__main__":
    main()
