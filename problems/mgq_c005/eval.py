"""Quiz batch eval: score an answers file against private gold.
Usage: python eval.py --submission <path> --split public|private
This file is a TEMPLATE — the builder copies it into each quiz chunk dir.
The shared grader lives in problems/_shared/quiz_grader.py.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_shared"))
import quiz_grader  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submission", required=True)
    ap.add_argument("--split", default="private")
    a = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "data", "quiz.jsonl"), encoding="utf-8") as f:
        questions = [json.loads(l) for l in f if l.strip()]
    with open(os.path.join(here, "answers.private.jsonl"), encoding="utf-8") as f:
        answers = {}
        for l in f:
            if l.strip():
                rec = json.loads(l)
                answers[rec["qid"]] = rec

    try:
        with open(a.submission, encoding="utf-8") as f:
            submission = json.load(f)
        if isinstance(submission, dict) and "answers" in submission and isinstance(submission["answers"], dict):
            submission = submission["answers"]
    except Exception as e:
        print("##SCORE##0")
        print(json.dumps({"error": f"submission parse fail: {e}"}))
        return

    # optional cached judge fallback for fill-in-the-blank near-synonyms
    judge = None
    gw = os.environ.get("RSILAB_JUDGE_KEY")
    if gw and a.split == "private":
        try:
            import judge as judge_mod

            judge = judge_mod.yes_no
        except Exception:
            judge = None

    score, detail = quiz_grader.grade_quiz(submission, questions, answers, a.split, judge)
    print(f"##SCORE##{score:.4f}")
    print(json.dumps({"fitness": round(score, 4), **detail}))


if __name__ == "__main__":
    main()
