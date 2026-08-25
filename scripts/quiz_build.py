"""Quiz chunk builder: convert external benchmarks into GeoRSI quiz problems.

Sources (probed 2026-08-24):
  earthse  benchmarks/EarthSE/*.parquet   (mcq / tf / fill; options inline in question)
  k2       benchmarks/k2/data/geobench/*.json
           apstudy: clean {stem, choices[{text,label}], answerKey}
           npee: choice/tf/completion (options inline, "Choose from:" + "ANSWER:")
  mapqa    benchmarks/MapQA-dataset/llm/<region>/question-answer/*.csv
           (ID,Question,Answer; supporting entity JSONs copied to data/)

Output per suite:
  problems/<suite>_cNNN/  problem.json + statement.md + data/quiz.jsonl
                          + answers.private.jsonl + eval.py
  config/<suite>.problems.json   (register via config.json "problems_file")

Usage:
  python scripts/quiz_build.py --src earthse --kinds mcq,tf,fill --chunk 100 --suite earthse
  python scripts/quiz_build.py --src k2 --kinds mcq,tf,fill --chunk 100 --suite k2
  python scripts/quiz_build.py --src mapqa --chunk 60 --suite mapqa
"""
import argparse
import csv
import glob
import json
import os
import random
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BM = os.path.join(ROOT, "benchmarks")
SHARED = os.path.join(ROOT, "problems", "_shared")

QUIZ_STATEMENT = """# Quiz batch: {suite} (chunk {chunk} of {total})

## Task
1. Read `data/quiz.jsonl` — one JSON object per line: {{"qid": ..., "kind": "mcq|tf|fill|value", "question": ..., "options": [...]}}
2. Answer EVERY question yourself (reason carefully; no external data needed{extra}).
3. Write your answers to `answers.json` in the workspace root as one JSON object mapping qid to answer:
   - mcq: the letter, e.g. "B"
   - tf: "true" or "false"
   - fill: the missing text
   - value: the exact value requested by the question
   Write it with the write tool (you may build it up in parts across turns with the edit tool).
4. Call the submit tool with `answers_file: "answers.json"` (and final=true when done).

Batch discipline (recommended): work in batches of 15-20 questions — answer a
batch, merge it into answers.json, then continue. Do not try to solve the whole
sheet in one pass in your head. Once ~90% of questions are answered, submit:
partial submissions score partially and unanswered questions count as wrong.

## Grading
public score = accuracy on a hidden calibration slice (a number, never the answers);
private score = accuracy on all questions. Partial answers score partially —
always submit, even if unsure on some questions.
"""


def norm_id(s):
    return re.sub(r"[^a-z0-9_-]+", "_", s.lower()).strip("_")[:48]


# ---------------------------------------------------------------- earthse ---
def read_earthse(kinds):
    import pandas as pd

    items = []
    kind_map = {"mcq": "multiple_choice", "tf": "true_false", "fill": "fill_in_the_blank"}
    for kind, split in kind_map.items():
        if kind not in kinds:
            continue
        path = os.path.join(BM, "EarthSE", f"{split}-00000-of-00001.parquet")
        df = pd.read_parquet(path)
        for _, row in df.iterrows():
            q = str(row["question"])
            ans = str(row["answer"]).strip()
            options = None
            if kind == "mcq":
                options = extract_inline_options(q)
            items.append(
                {
                    "qid": f"es_{split[:3]}_{int(row['idx'])}",
                    "kind": kind,
                    "question": q,
                    "options": options,
                    "answer": ans,
                    "meta": {"subject": str(row.get("subject", ""))},
                }
            )
    return items


def extract_inline_options(question):
    """Parse 'A) text B) text C) text D) text' (EarthSE style) from a question."""
    m = re.search(r"A\)\s*(.+?)(?:\s*B\)\s*(.+?))?(?:\s*C\)\s*(.+?))?(?:\s*D\)\s*(.+?))?$", question, re.DOTALL)
    if not m:
        return None
    opts = [g for g in m.groups() if g]
    return opts if 2 <= len(opts) <= 6 else None


# --------------------------------------------------------------------- k2 ---
def read_k2(kinds):
    items = []
    # apstudy: clean MCQ
    if "mcq" in kinds:
        d = json.load(open(os.path.join(BM, "k2", "data", "geobench", "geobench_apstudy.json"), encoding="utf-8"))
        for i, it in enumerate(d):
            q = it["question"]
            options = [c["text"] for c in q["choices"]]
            items.append(
                {
                    "qid": f"k2_ap_{i}",
                    "kind": "mcq",
                    "question": q["stem"],
                    "options": options,
                    "answer": str(it["answerKey"]).strip().upper()[:1],
                    "meta": {"src": "apstudy"},
                }
            )
        # npee choice: options inline
        n = json.load(open(os.path.join(BM, "k2", "data", "geobench", "geobench_npee.json"), encoding="utf-8"))
        for i, (q, a) in enumerate(zip(n["choice"]["question"], n["choice"]["answer"])):
            options = extract_choosefrom(q)
            stem = re.sub(r"\s*Choose from:.*$", "", q, flags=re.DOTALL).strip()
            items.append(
                {
                    "qid": f"k2_np_c{i}",
                    "kind": "mcq",
                    "question": stem,
                    "options": options,
                    "answer": str(a).strip().upper()[:1],
                    "meta": {"src": "npee-choice"},
                }
            )
    n = json.load(open(os.path.join(BM, "k2", "data", "geobench", "geobench_npee.json"), encoding="utf-8"))
    if "tf" in kinds:
        for i, (q, a) in enumerate(zip(n["tf"]["question"], n["tf"]["answer"])):
            items.append({"qid": f"k2_np_t{i}", "kind": "tf", "question": q, "options": None, "answer": str(a).strip(), "meta": {}})
    if "fill" in kinds:
        for i, (q, a) in enumerate(zip(n["completion"]["question"], n["completion"]["answer"])):
            items.append({"qid": f"k2_np_f{i}", "kind": "fill", "question": q, "options": None, "answer": str(a).strip(), "meta": {}})
    return items


def extract_choosefrom(q):
    """Parse npee 'Choose from:\\nA. x\\nB. y\\nC. z' blocks."""
    m = re.search(r"Choose from:\s*(.+)$", q, re.DOTALL)
    if not m:
        return None
    block = m.group(1)
    opts = re.findall(r"[A-E][\.\)]\s*(.+)", block)
    return opts if 2 <= len(opts) <= 6 else None


# ------------------------------------------------------------------ mapqa ---
def read_mapqa():
    items = []
    data_files = []
    for region in ("california_full", "illinois_test"):
        base = os.path.join(BM, "MapQA-dataset", "llm", region)
        qa_dir = os.path.join(base, "question-answer")
        for csv_path in glob.glob(os.path.join(qa_dir, "*.csv")):
            task = os.path.basename(csv_path).replace("_dataset.csv", "").replace(".csv", "")
            with open(csv_path, encoding="utf-8") as f:
                for row in csv.DictReader(f):
                    q = (row.get("Question") or "").strip()
                    a = (row.get("Answer") or "").strip()
                    if not q or not a or a.lower() == "null":
                        continue
                    items.append(
                        {
                            "qid": f"mq_{norm_id(region)}_{norm_id(task)}_{row.get('ID', '?')}",
                            "kind": "value",
                            "question": q,
                            "options": None,
                            "answer": a,
                            "meta": {"region": region, "task": task},
                        }
                    )
        # supporting entity data (small CSV/JSON) for the agent to consult
        for p in glob.glob(os.path.join(base, "*.csv")) + glob.glob(os.path.join(qa_dir, "*.json")):
            if os.path.getsize(p) < 25_000_000:
                data_files.append(p)
    return items, data_files


# ------------------------------------------------------------------- gkmc ---
def read_gkmc():
    """GeoBenchLLM/GKMC: 1,600 Chinese scenario MCQ (original Jeeves-GKMC data)."""
    d = json.load(open(os.path.join(BM, "GeoBenchLLM", "data", "GKMC", "raw", "dataset.json"), encoding="utf-8"))
    items = []
    for it in d:
        opts = [str(it.get(k) or "").strip() for k in ("A", "B", "C", "D")]
        ans = str(it.get("answer") or "").strip().upper()[:1]
        if not all(opts) or ans not in list("ABCD"):
            continue
        stem = (str(it.get("scenario") or "").strip() + "\n" + str(it["question"]).strip()).strip()
        items.append(
            {
                "qid": f"gk_{it['id']}",
                "kind": "mcq",
                "question": stem,
                "options": opts,
                "answer": ans,
                "meta": {"src": "gkmc"},
            }
        )
    return items


# --------------------------------------------------------------- stepgame ---
STEPGAME_DIRS = ["left", "right", "above", "below", "upper-left", "upper-right", "lower-left", "lower-right", "overlap"]


def read_stepgame(limit, seed):
    """GeoBenchLLM/StepGame: multi-hop spatial direction MCQ (HF ZhengyanShi/StepGame)."""
    import random

    rows = []
    with open(os.path.join(BM, "GeoBenchLLM", "data", "StepGame", "raw", "test.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    rng = random.Random(seed)
    rng.shuffle(rows)
    items = []
    for i, r in enumerate(rows[:limit]):
        if r["label"] not in STEPGAME_DIRS:
            continue
        q = " ".join(r["story"]) + "\n" + r["question"] + "\nDirections: " + ", ".join(STEPGAME_DIRS)
        items.append(
            {
                "qid": f"sg_{i}",
                "kind": "mcq",
                "question": q,
                "options": STEPGAME_DIRS,
                "answer": chr(65 + STEPGAME_DIRS.index(r["label"])),
                "meta": {"src": "stepgame", "k_hop": r.get("k_hop")},
            }
        )
    return items


# -------------------------------------------------------------------- mgq ---
MGQ_TYPE_MAP = {
    "boolean": "tf",
    "distance_kilometers": "value",
    "area_km2": "value",
    "numeric": "value",
    "count": "value",
    "categorical": "fill",
    "entity_name": "fill",
}


def read_mgq():
    """MultiGlobeQA eng/small (kwg+worldkg): gradeable answer types only.

    Gold is a scalar per ground_truth_type (the HF gold_triples are supporting
    KG facts, not the answer format); alias ids do not match question entity
    ids, so entity equivalence goes through the judge fallback instead.
    """
    import pandas as pd

    frames = [
        pd.read_parquet(os.path.join(BM, "MultiGlobeQA", "hf", "questions", "eng", "small", f"{kg}.parquet"))
        for kg in ("kwg", "worldkg")
    ]
    q = pd.concat(frames)
    items = []
    for _, r in q.iterrows():
        if not bool(r["is_valid"]) or not bool(r["is_true_premise"]):
            continue
        kind = MGQ_TYPE_MAP.get(str(r["ground_truth_type"]))
        ans = str(r["ground_truth"]).strip()
        if not kind or not ans or ans.lower() in ("none", "nan"):
            continue
        if kind == "tf":
            ans = "true" if ans.lower() in ("true", "yes", "t") else "false"
        items.append(
            {
                "qid": f"mgq_{r['question_id'][:12]}",
                "kind": kind,
                "question": str(r["question"]).strip(),
                "options": None,
                "answer": ans,
                "meta": {"src": "mgq", "type": r["ground_truth_type"], "kg": r["kg_source"]},
            }
        )
    return items


# ------------------------------------------------------------------ build ---
def build(src, kinds, chunk, suite, dev_size, seed, limit):
    rng = random.Random(seed)
    extra = ""
    data_files = []
    if src == "earthse":
        items = read_earthse(kinds)
    elif src == "k2":
        items = read_k2(kinds)
    elif src == "mapqa":
        items, data_files = read_mapqa()
        extra = "; entity reference data is provided in data/"
    elif src == "gkmc":
        items = read_gkmc()
    elif src == "stepgame":
        items = read_stepgame(limit, seed)
    elif src == "mgq":
        items = read_mgq()
    else:
        sys.exit(f"unknown src: {src}")
    if not items:
        sys.exit("no items extracted")

    rng.shuffle(items)
    chunks = [items[i : i + chunk] for i in range(0, len(items), chunk)]
    total = len(chunks)
    suite_problems = []
    out_root = os.path.join(ROOT, "problems")
    for ci, part in enumerate(chunks, 1):
        pid = f"{suite}_c{ci:03d}"
        pdir = os.path.join(out_root, pid)
        os.makedirs(os.path.join(pdir, "data"), exist_ok=True)
        with open(os.path.join(pdir, "data", "quiz.jsonl"), "w", encoding="utf-8") as f:
            for it in part:
                rec = {"qid": it["qid"], "kind": it["kind"], "question": it["question"]}
                if it.get("options"):
                    rec["options"] = it["options"]
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        with open(os.path.join(pdir, "answers.private.jsonl"), "w", encoding="utf-8") as f:
            for j, it in enumerate(part):
                f.write(
                    json.dumps({"qid": it["qid"], "answer": it["answer"], "dev": j < dev_size}, ensure_ascii=False) + "\n"
                )
        with open(os.path.join(pdir, "statement.md"), "w", encoding="utf-8") as f:
            f.write(QUIZ_STATEMENT.format(suite=suite, chunk=ci, total=total, extra=extra))
        with open(os.path.join(pdir, "problem.json"), "w", encoding="utf-8") as f:
            json.dump(
                {
                    "type": "quiz",
                    "genre": f"quiz-{suite}",
                    **({"judge": True} if any(it["kind"] == "fill" for it in part) else {}),
                    "max_turns": 40,
                    "eval_cap": 2,
                    "episode_timeout_s": 3600,
                    "patience": 2,
                    "eval_timeout_s": 1800,
                },
                f,
                indent=2,
            )
        shutil.copyfile(os.path.join(SHARED, "quiz_eval_template.py"), os.path.join(pdir, "eval.py"))
        if src == "mapqa":
            for p in data_files[:40]:
                dst = os.path.join(pdir, "data", f"{norm_id(os.path.basename(p))}")
                if not os.path.exists(dst):
                    shutil.copyfile(p, dst)
        heldout = ci == total  # last chunk = held-out exam material
        suite_problems.append({"id": pid, **({"heldout": True} if heldout else {})})
        print(f"  {pid}: {len(part)} questions (dev {min(dev_size, len(part))})")

    cfg_dir = os.path.join(ROOT, "config")
    os.makedirs(cfg_dir, exist_ok=True)
    suite_path = os.path.join(cfg_dir, f"{suite}.problems.json")
    with open(suite_path, "w", encoding="utf-8") as f:
        json.dump({"suite": suite, "problems": suite_problems}, f, indent=2)
    print(f"\nbuilt {len(items)} questions -> {total} chunks")
    print(f"suite file: {suite_path}")
    print(f'enable with: add "problems_file": "config/{suite}.problems.json" to config.json')


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, choices=["earthse", "k2", "mapqa", "gkmc", "stepgame", "mgq"])
    ap.add_argument("--kinds", default="mcq,tf,fill")
    ap.add_argument("--chunk", type=int, default=100)
    ap.add_argument("--suite", required=True)
    ap.add_argument("--dev-size", type=int, default=20)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--limit", type=int, default=2000, help="sample cap for stepgame")
    a = ap.parse_args()
    kinds = set(a.kinds.split(","))
    build(a.src, kinds, a.chunk, a.suite, a.dev_size, a.seed, a.limit)
