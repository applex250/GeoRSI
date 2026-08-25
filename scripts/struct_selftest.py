"""Structural self-checks for GeoRSI problem suites (no LLM, fast).

Covers the A/B-tier integration invariants:
- quiz chunks: required files, gold isolation (answers never inside data/),
  eval.py callable (has the __main__ guard that once went missing)
- gbx/gab problems: hidden reference/ stays outside data/
- judge cache: every line parses, keys unique (determinism precondition —
  adversarial re-eval must hit the same cached judgment)
- env isolation: solve.ts strips RSILAB_JUDGE* from agent-side spawns

Prints STRUCT_OK when everything passes.
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fail = []


def bad(msg):
    fail.append(msg)


# 1. quiz chunks ------------------------------------------------------------
quiz_dirs = sorted(glob.glob(os.path.join(ROOT, "problems", "*_c[0-9][0-9][0-9]")))
if not quiz_dirs:
    bad("no quiz chunk dirs found")
checked = 0
for d in quiz_dirs:
    pid = os.path.basename(d)
    try:
        with open(os.path.join(d, "problem.json"), encoding="utf-8") as f:
            pj = json.load(f)
        if pj.get("type") != "quiz":
            bad(f"{pid}: problem.json not type=quiz")
        qpath = os.path.join(d, "data", "quiz.jsonl")
        qs = [json.loads(l) for l in open(qpath, encoding="utf-8") if l.strip()]
        if not qs:
            bad(f"{pid}: empty quiz.jsonl")
        for rec in qs:
            if "answer" in rec or "dev" in rec:
                bad(f"{pid}: gold leaks into data/quiz.jsonl ({list(rec)[:4]})")
                break
        priv = [json.loads(l) for l in open(os.path.join(d, "answers.private.jsonl"), encoding="utf-8") if l.strip()]
        if not priv or len(priv) != len(qs):
            bad(f"{pid}: answers.private.jsonl size mismatch ({len(priv)} vs {len(qs)})")
        if os.path.basename(os.path.dirname(os.path.join(d, "answers.private.jsonl"))) == "data":
            bad(f"{pid}: answers file inside data/")
        ev = open(os.path.join(d, "eval.py"), encoding="utf-8").read()
        if "__main__" not in ev or "grade_quiz" not in ev:
            bad(f"{pid}: eval.py missing __main__ guard or grade_quiz call")
        checked += 1
    except Exception as e:  # noqa: BLE001
        bad(f"{pid}: {e}")

# 2. hidden references never inside agent data/ -----------------------------
for pat in ("gbx_*", "gab_*"):
    for d in glob.glob(os.path.join(ROOT, "problems", pat)):
        pid = os.path.basename(d)
        if not os.path.isdir(os.path.join(d, "reference")):
            bad(f"{pid}: missing reference/")
        for p in glob.glob(os.path.join(d, "data", "reference*")) + glob.glob(os.path.join(d, "data", "**", "reference*"), recursive=True):
            bad(f"{pid}: reference leaked under data/ ({p})")
        ev = open(os.path.join(d, "eval.py"), encoding="utf-8").read()
        if "__main__" not in ev:
            bad(f"{pid}: eval.py missing __main__ guard")

# 3. judge cache determinism preconditions -----------------------------------
cache_path = os.path.join(ROOT, "problems", "_shared", "judge_cache.jsonl")
if os.path.exists(cache_path):
    keys = set()
    n = 0
    with open(cache_path, encoding="utf-8") as f:
        for i, line in enumerate(f):
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
                k = rec["k"]
            except Exception as e:  # noqa: BLE001
                bad(f"judge_cache line {i+1} unparseable: {e}")
                continue
            if k in keys:
                bad(f"judge_cache duplicate key at line {i+1} (conflicting judgments possible)")
            keys.add(k)
            n += 1

# 4. env isolation: agent-side spawns strip judge credentials ----------------
solve_src = open(os.path.join(ROOT, "src", "inner", "solve.ts"), encoding="utf-8").read()
strips = len(re.findall(r'startsWith\("RSILAB_JUDGE"\)', solve_src))
if strips < 2:
    bad(f"solve.ts agent-side env strips found {strips}/2 (run_python + start_job)")
tpl = open(os.path.join(ROOT, "problems", "_shared", "quiz_eval_template.py"), encoding="utf-8").read()
if "__main__" not in tpl:
    bad("quiz_eval_template.py missing __main__ guard (regression)")

# 5. knowledge base integrity -------------------------------------------------
kb_path = os.path.join(ROOT, "knowledge", "nodes.jsonl")
kb_n = 0
if os.path.exists(kb_path):
    ids = set()
    for i, line in enumerate(open(kb_path, encoding="utf-8")):
        if not line.strip():
            continue
        try:
            kn = json.loads(line)
            if kn["id"] in ids:
                bad(f"knowledge duplicate id {kn['id']}")
            ids.add(kn["id"])
            if not kn["text"].strip() or not kn["tags"]:
                bad(f"knowledge node {kn['id']}: empty text or tags")
            if kn["scope"] not in ("generic", "regional") or kn["status"] not in ("active", "probation", "retired"):
                bad(f"knowledge node {kn['id']}: bad scope/status")
            kb_n += 1
        except Exception as e:  # noqa: BLE001
            bad(f"knowledge line {i+1} unparseable: {e}")
else:
    bad("knowledge/nodes.jsonl missing")

# 6. model profiles (unified calling layer data) -------------------------------
prof_path = os.path.join(ROOT, "config", "model-profiles.json")
try:
    profs = json.load(open(prof_path, encoding="utf-8"))
    for mid, pr in profs.get("models", {}).items():
        if "reasoning" not in pr or "endpoint" not in pr or "vision_raw_api" not in pr:
            bad(f"model profile {mid}: missing required keys")
    sys.path.insert(0, os.path.join(ROOT, "problems", "_shared"))
    import model_client as _mc

    _lvl, _extra, _note = _mc.resolve_thinking("dsv4f", "max")
    if _extra.get("thinking_budget") != 16384:
        bad("model_client dsv4f max must map to thinking_budget=16384")
except Exception as e:  # noqa: BLE001
    bad(f"model profiles / model_client broken: {e}")

if fail:
    print("STRUCT_FAIL")
    for m in fail[:20]:
        print(" -", m)
    sys.exit(1)
print(f"STRUCT_OK ({checked} quiz chunks, {n} cache entries, {strips} env strips, {kb_n} knowledge nodes)")
