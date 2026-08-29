"""Shared quiz graders: per-kind answer normalization + exact/structured match.

Used by every quiz-type problem's eval.py. Normalization is intentionally
conservative (case/punctuation/articles/whitespace) — no fuzzy matching here;
near-synonyms for fill-in-the-blank go through the optional judge fallback in
the eval template, never silently.
"""
import json
import math
import re
import unicodedata


def norm_text(s: str) -> str:
    """Aggressive-but-safe textual normalization."""
    s = unicodedata.normalize("NFKC", str(s)).strip().lower()
    s = re.sub(r"[\u2018\u2019\u201c\u201d']", "", s)  # quotes
    s = re.sub(r"[.,;:!?()\[\]]", " ", s)
    s = re.sub(r"\b(a|an|the|is|are|of|to)\b", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def norm_mcq(ans: str, options=None) -> str:
    """Normalize an MCQ answer to a canonical letter (A-Z)."""
    s = str(ans).strip()
    # bare letter, possibly with punctuation: 'A', 'b)', '(C)', 'D.'
    m = re.match(r"^\(?([A-Za-z])\s*[\.\)\:]?$", s)
    if m:
        return m.group(1).upper()
    if options:
        # full option text given: match against options (case-insensitive)
        ns = norm_text(s)
        for i, opt in enumerate(options):
            if norm_text(opt) == ns:
                return chr(65 + i)
    return ""  # unmatchable


def norm_tf(ans: str) -> str:
    s = norm_text(ans)
    if s in ("true", "t", "yes", "y", "correct", "right", "对", "正确", "是真"):
        return "T"
    if s in ("false", "f", "no", "n", "incorrect", "wrong", "错", "错误", "是假"):
        return "F"
    return ""


def norm_fill(ans: str) -> str:
    return norm_text(ans)


def grade_mcq(pred, gold, options=None) -> bool:
    return norm_mcq(pred, options) != "" and norm_mcq(pred, options) == norm_mcq(gold, options)


def grade_tf(pred, gold, options=None) -> bool:
    return norm_tf(pred) != "" and norm_tf(pred) == norm_tf(gold)


def grade_fill(pred, gold, options=None) -> bool:
    return norm_fill(pred) == norm_fill(gold) and norm_fill(pred) != ""


def _num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def grade_value(pred, gold, options=None, rel_tol=0.02) -> bool:
    """MapQA-style structured value: numeric with tolerance, else normalized text."""
    pn, gn = _num(pred), _num(gold)
    if gn is not None and pn is not None:
        return math.isclose(pn, gn, rel_tol=rel_tol, abs_tol=1e-9)
    return norm_text(pred) == norm_text(gold) and norm_text(pred) != ""


GRADE = {
    "mcq": grade_mcq,
    "tf": grade_tf,
    "fill": grade_fill,
    "value": grade_value,
}


def grade_quiz(submission: dict, questions, answers, split: str, judge=None):
    """Score a quiz submission.

    submission: {qid: answer} from the agent's answers file
    questions:  list of {qid, kind, options?, dev?} (dev flags live in the
                PRIVATE answers file, never in the agent-visible copy)
    answers:    dict qid -> {answer, dev}
    split:      "public" -> dev calibration slice only;
                "private" -> non-dev questions only (honest test split)
    judge:      optional callable(question, gold, pred) -> bool for fill fallback
    returns (score, detail_dict)
    """
    total = 0
    correct = 0
    skipped = 0
    for q in questions:
        qid = q["qid"]
        kind = q.get("kind", "value")
        gold_rec = answers.get(qid)
        if gold_rec is None:
            skipped += 1
            continue
        if split == "public" and not gold_rec.get("dev"):
            continue
        if split == "private" and gold_rec.get("dev"):
            continue
        total += 1
        pred = submission.get(qid)
        if pred is None:
            continue  # unanswered = wrong
        ok = False
        grader = GRADE.get(kind, grade_value)
        try:
            ok = bool(grader(pred, gold_rec["answer"], q.get("options")))
        except Exception:
            ok = False
        if not ok and kind == "fill" and judge is not None:
            try:
                ok = bool(judge(q.get("question", ""), str(gold_rec["answer"]), str(pred)))
            except Exception:
                ok = False
        if ok:
            correct += 1
    score = (correct / total) if total > 0 else 0.0
    return score, {"correct": correct, "total": total, "skipped": skipped, "metric": "public-dev-v1" if split == "public" else "private-only-v2"}
