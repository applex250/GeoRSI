"""Error Analyzer: offline post-run diagnosis -> clustered, actionable lessons.

Reads a FINISHED run's episode artifacts (safe to run while other runs are
active - read-only on runs/, writes only a report and optional PROBATION
knowledge nodes that require heldout validation before going active).

Per wrong/unanswered quiz question, classifies into the error taxonomy:
  unanswered        blank sheet entries (discipline/coverage)
  format_mismatch   normalized-close but not equal (output_format)
  near_numeric      within 10% of gold (calculation_error)
  letter_valid_wrong mcq letter in range but incorrect (knowledge_gap /
                    reasoning_error - distinguished by LLM pass if enabled)
  unknown_qid       answer references nonexistent question
Agent-type episodes (no quiz sheet) get fitness/error drill-down only.

Usage:
  python scripts/error_analyzer.py --run <name> [--min-cluster 4] [--emit-nodes] [--llm]
"""
import argparse
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "problems", "_shared"))
import quiz_grader  # noqa: E402


def load_gold(problem_dir):
    """qid -> {answer, kind} from a quiz chunk's private answers."""
    gold = {}
    pp = os.path.join(problem_dir, "answers.private.jsonl")
    if not os.path.exists(pp):
        return gold
    for line in open(pp, encoding="utf-8"):
        if line.strip():
            r = json.loads(line)
            gold[r["qid"]] = str(r["answer"])
    return gold


def load_questions(problem_dir):
    qs = {}
    qp = os.path.join(problem_dir, "data", "quiz.jsonl")
    if not os.path.exists(qp):
        return qs
    for line in open(qp, encoding="utf-8"):
        if line.strip():
            q = json.loads(line)
            qs[q["qid"]] = q
    return qs


def classify(pred, gold_answer, kind, options):
    pred_s = "" if pred is None else str(pred).strip()
    if pred is None or pred_s == "":
        return "unanswered"
    g = quiz_grader
    try:
        if kind == "mcq":
            if g.norm_mcq(pred_s, options) == g.norm_mcq(gold_answer, options) and g.norm_mcq(pred_s, options):
                return "correct"
            if re.fullmatch(r"[a-jA-J]", pred_s) or any(pred_s.strip() == str(o).strip() for o in (options or [])):
                return "letter_valid_wrong"
            return "format_mismatch"
        if kind == "tf":
            if g.norm_tf(pred_s) and g.norm_tf(pred_s) == g.norm_tf(gold_answer):
                return "correct"
            if g.norm_tf(pred_s):
                return "letter_valid_wrong"  # valid boolean stance, wrong side
            return "format_mismatch"
        if kind in ("value", "fill"):
            if g.grade_value(pred_s, gold_answer) or g.norm_fill(pred_s) == g.norm_fill(gold_answer):
                return "correct"
            pn = _num(pred_s)
            gn = _num(gold_answer)
            if pn is not None and gn is not None and gn != 0:
                rel = abs(pn - gn) / max(abs(gn), 1e-9)
                if rel <= 0.10:
                    return "near_numeric"
            import difflib
            ratio = difflib.SequenceMatcher(None, g.norm_fill(pred_s), g.norm_fill(gold_answer)).ratio()
            if ratio >= 0.75:
                return "format_mismatch"
            return "knowledge_gap" if kind == "fill" else "reasoning_error"
        return "letter_valid_wrong"
    except Exception:
        return "format_mismatch"


def _num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


import re  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True, help="run name under runs/")
    ap.add_argument("--min-cluster", type=int, default=5)
    ap.add_argument("--emit-nodes", action="store_true",
                    help="append top clusters as PROBATION knowledge nodes (need heldout validation to activate)")
    ap.add_argument("--llm", action="store_true", help="use LLM pass to split knowledge vs reasoning errors (needs RSILAB_JUDGE_*)")
    a = ap.parse_args()

    root = os.path.join("runs", a.run)
    episodes = sorted(glob.glob(os.path.join(root, "episodes", "*")))
    if not episodes:
        print(json.dumps({"error": f"no episodes under {root}"}))
        sys.exit(1)

    counts = {}
    clusters = {}
    per_problem = {}
    agent_rows = []
    for ws in episodes:
        role = os.path.basename(ws)
        prob = role.rsplit("-", 1)[-1]
        pdir = os.path.join(ROOT, "problems", prob)
        ep = None
        for cand in ("episode.json",):
            ep_path = os.path.join(ws, cand)
            if os.path.exists(ep_path):
                ep = json.load(open(ep_path, encoding="utf-8"))
                break
        gold = load_gold(pdir)
        questions = load_questions(pdir)

        if not gold:  # agent-type problem: drill down on outcome only
            agent_rows.append({"role": role, "problem": prob, "fitness": ep.get("fitness") if ep else None,
                               "error": (ep or {}).get("error"), "turns": (ep or {}).get("turns"),
                               "tokens": (ep or {}).get("tokens")})
            continue

        ans_path = os.path.join(ws, "answers.json")
        try:
            answers = {str(k): v for k, v in json.load(open(ans_path, encoding="utf-8")).items()}
        except Exception:
            answers = {}
        stats = {"correct": 0}
        for qid, q in questions.items():
            pred = answers.get(qid)
            kindcat = classify(pred, gold.get(qid, ""), q.get("kind", "value"), q.get("options"))
            if kindcat == "correct":
                stats["correct"] = stats.get("correct", 0) + 1
            else:
                stats[kindcat] = stats.get(kindcat, 0) + 1
            if kindcat not in ("correct",):
                key = f"{q.get('kind','?')}:{kindcat}"
                clusters.setdefault(key, []).append(f"{prob}:{qid}")
        per_problem[role] = stats

    print("== per-episode quiz breakdown ==")
    for role, st in sorted(per_problem.items()):
        total = sum(v for k, v in st.items() if k != "correct")
        print(f"{role:<16} {st}")
    print("\n== error clusters (kind:category -> count) ==")
    ranked = sorted(clusters.items(), key=lambda kv: -len(kv[1]))
    for k, v in ranked:
        mark = " <-- actionable" if len(v) >= a.min_cluster else ""
        print(f"{k:<28} n={len(v)}{mark}")

    print("\n== agent-type episodes ==")
    for r in agent_rows:
        print(r)

    if a.emit_nodes and ranked:
        from datetime import datetime
        nodes = []
        for k, v in ranked:
            if len(v) < a.min_cluster:
                continue
            kind_cat = k.split(":")
            text = {
                "unanswered": "Answer EVERY question in the sheet - blanks score zero and drag the batch mean.",
                "format_mismatch": "Match the required output format exactly (option letter / boolean word / exact term); rephrase-to-guess loses points.",
                "near_numeric": "Recompute numerics twice; check units and decimal handling before submitting.",
                "letter_valid_wrong": "For MCQs, eliminate options first; commit only after ruling out two.",
            }.get(kind_cat[-1], "Cluster-specific remediation pending manual review.")
            nodes.append({
                "id": f"tip_err_{datetime.now().strftime('%H%M%S')}_{len(nodes)}",
                "text": text,
                "tags": ["quiz", kind_cat[0], kind_cat[1]],
                "scope": "regional",
                "stats": {"uses": 0, "wins": 0, "fitness_sum": 0},
                "origin": {"run": a.run, "gen": -1},
                "status": "probation",
            })
        kb = os.path.join(ROOT, "knowledge", "nodes.jsonl")
        with open(kb, "a", encoding="utf-8") as f:
            for n in nodes:
                f.write(json.dumps(n, ensure_ascii=False) + "\n")
        print(f"\nemitted {len(nodes)} PROBATION nodes (activate only after heldout validation)")


if __name__ == "__main__":
    main()
