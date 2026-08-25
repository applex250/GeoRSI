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

    # optional judge fallback for fill-in-the-blank near-synonyms
    judge = None
    gw = os.environ.get("RSILAB_JUDGE_KEY")
    if gw and a.split == "private":
        judge = _make_judge()

    score, detail = quiz_grader.grade_quiz(submission, questions, answers, a.split, judge)
    print(f"##SCORE##{score:.4f}")
    print(json.dumps({"fitness": round(score, 4), **detail}))


def _make_judge():
    """LLM-judge for fill-in-the-blank synonymy (private split only)."""
    import urllib.request

    base = os.environ["RSILAB_JUDGE_BASE"].rstrip("/")
    model = os.environ.get("RSILAB_JUDGE_MODEL", "hy3")
    key = os.environ["RSILAB_JUDGE_KEY"]

    def judge(question, gold, pred):
        prompt = (
            f"Question: {question}\nReference answer: {gold}\nCandidate answer: {pred}\n"
            "Do these answers express the SAME entity/concept (allowing case, articles, "
            "and obvious synonyms)? Reply with exactly YES or NO."
        )
        body = json.dumps(
            {"model": model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 2000, "temperature": 0}
        ).encode()
        req = urllib.request.Request(
            base + "/chat/completions", data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                out = json.loads(r.read().decode())
            txt = (out["choices"][0]["message"].get("content") or "").strip().upper()
            return txt.startswith("YES")
        except Exception:
            return False

    return judge


if __name__ == "__main__":
    main()
