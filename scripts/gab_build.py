"""GeoAnalystBench -> GeoRSI problems builder (oracle-comparison mode).

Each CSV row becomes one problem:
  problems/gab_<id>/
    statement.md        Task + Instruction + Domain Knowledge + Data description
                        + the agent answer contract (key_values/output_files/summary)
    data/               the exact data files the row references (copied from
                        benchmarks/GABench/dataset — same data package; reference
                        code lives OUTSIDE data/ so the agent never sees it)
    reference/          solution.py (CodeString) + workflow.txt — oracle only
    eval.py             three-level chain: oracle numbers -> file check -> judge
    problem.json        overrides (long scripts, jobs, judge fallback)

Usage:
  python scripts/gab_build.py --n 10            # first 10 tasks
  python scripts/gab_build.py --n 50 --suite gab
"""
import argparse
import csv
import json
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "benchmarks", "GeoAnalystBench", "dataset", "GeoAnalystBench.csv")
GAB_DATA = os.path.join(ROOT, "benchmarks", "GABench", "dataset")
SHARED = os.path.join(ROOT, "problems", "_shared")
MAX_DATA_MB = 300
GIS_PYTHON_CMD = os.environ.get("GEORSI_GIS_PYTHON", r"F:\GeoRSI\venvs\gis\Scripts\python.exe")

STATEMENT = """# {task}

## Instruction
{instruction}

## Domain knowledge
{knowledge}

## Data
{datadesc}

## How to submit
1. Analyze the data with python (write scripts, run_python; use start_job for
   anything longer than a couple of minutes).
2. Produce the outputs the instruction asks for (figures/maps as files).
3. Call the submit tool with a JSON object EXACTLY of this shape:
   {{
     "key_values": {{"<descriptive label>": <number>, ...}},
     "output_files": ["<filename you created>", ...],
     "summary": "<2-3 sentences: method and main findings>"
   }}
   key_values: every important numeric result you computed, with clear labels.
   output_files: the figures/maps you saved (relative filenames).

## Grading
Your key numeric results are compared against an expert reference (labels do
not need to match; values matter, small tolerance). Output files must exist.
"""

EVAL_PY = '''"""GeoAnalystBench oracle eval (auto-generated).
Chain: run the hidden reference solution -> extract its printed numbers ->
match the agent's key_values within tolerance -> plus output-file existence.
Falls back to the cached LLM judge when the oracle cannot run or yields no
numbers, or when the agent submitted only a summary.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "_shared"))


def floats_from_text(text):
    vals = []
    for m in re.finditer(r"-?\\d+\\.\\d+(?:[eE][-+]?\\d+)?", text):
        try:
            v = float(m.group())
            if abs(v) > 1e-9:
                vals.append(v)
        except ValueError:
            pass
    # de-duplicate close values (prints often repeat a number)
    uniq = []
    for v in vals:
        if not any(abs(v - u) / max(abs(u), 1e-9) < 1e-6 for u in uniq):
            uniq.append(v)
    return uniq


def run_reference(timeout_s):
    """Run the hidden reference solution in a sandbox with the same data."""
    with tempfile.TemporaryDirectory() as td:
        os.makedirs(os.path.join(td, "dataset"), exist_ok=True)
        for d in ("pred_results", "output", "results"):
            os.makedirs(os.path.join(td, d), exist_ok=True)
        for dirpath, _dirs, files in os.walk(os.path.join(HERE, "data")):
            rel = os.path.relpath(dirpath, os.path.join(HERE, "data"))
            for f in files:
                dst_dir = os.path.join(td, "dataset") if rel == "." else os.path.join(td, "dataset", rel)
                os.makedirs(dst_dir, exist_ok=True)
                shutil_copy(os.path.join(dirpath, f), os.path.join(dst_dir, f))
        try:
            r = subprocess.run(
                [sys.executable, os.path.join(HERE, "reference", "solution.py")],
                cwd=td, capture_output=True, text=True, timeout=timeout_s,
            )
        except Exception:
            return None, []
        if r.returncode != 0:
            return None, []
        return floats_from_text(r.stdout or ""), os.listdir(td)


def shutil_copy(a, b):
    import shutil
    shutil.copyfile(a, b)


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

    if a.split == "public":
        # calibration signal only: contract validity, never the oracle numbers
        ok = isinstance(sub, dict) and (
            (isinstance(sub.get("key_values"), dict) and len(sub["key_values"]) > 0)
            or len(str(sub.get("summary", ""))) > 40
        )
        print(f"##SCORE##{1.0 if ok else 0.0}")
        print(json.dumps({"public": "format_validity"}))
        return

    key_values = sub.get("key_values") if isinstance(sub.get("key_values"), dict) else {}
    out_files = sub.get("output_files") if isinstance(sub.get("output_files"), list) else []
    summary = str(sub.get("summary", ""))

    ref_vals, _files = run_reference(900)
    if ref_vals:
        agent_vals = [float(v) for v in key_values.values() if isinstance(v, (int, float))]
        matched = 0
        used = set()
        for rv in ref_vals:
            for i, av in enumerate(agent_vals):
                if i in used:
                    continue
                if abs(av - rv) / max(abs(rv), 1e-9) <= 0.05:
                    matched += 1
                    used.add(i)
                    break
        num_score = matched / max(1, len(ref_vals))
        ws = os.path.dirname(os.path.dirname(os.path.abspath(a.submission)))  # agent workspace
        present = 0
        for f in out_files:
            path = safe_artifact_path(ws, f)
            if path and os.path.isfile(path) and os.path.getsize(path) > 1024:
                present += 1
        file_score = present / max(1, len(out_files)) if out_files else 0.0
        score = 0.8 * num_score + 0.2 * file_score if agent_vals else max(0.0, num_score - 0.2)
        print(f"##SCORE##{max(0.0, min(1.0, score)):.4f}")
        print(json.dumps({"mode": "oracle", "ref_numbers": len(ref_vals), "matched": matched,
                          "files_present": f"{present}/{len(out_files)}"}))
        return

    # judge fallback (cached -> deterministic across re-evals)
    if not os.environ.get("RSILAB_JUDGE_KEY"):
        print("##SCORE##0"); print(json.dumps({"error": "no oracle, no judge creds"})); return
    import judge as judge_mod
    ref = open(os.path.join(HERE, "reference", "workflow.txt"), encoding="utf-8").read()
    score, reason = judge_mod.score_0_1(
        open(os.path.join(HERE, "statement_task.txt"), encoding="utf-8").read(),
        ref,
        json.dumps(sub, ensure_ascii=False)[:4000],
    )
    if score is None:
        print("##SCORE##0"); print(json.dumps({"error": f"judge unusable: {reason}"})); return
    print(f"##SCORE##{score:.4f}")
    print(json.dumps({"mode": "judge", "reason": reason[:160]}))


if __name__ == "__main__":
    main()
'''


def referenced_files(datadesc):
    return sorted(set(re.findall(r"dataset/([A-Za-z0-9_.\-]+)", datadesc)))


DATA_EXT = "geojson|shp|tif|csv|json|gpkg|nc|parquet"


def code_paths(code):
    """Data paths exactly as the reference code opens them, including subdirs.
    Captures 'dataset/a/b.geojson', 'benchmark/datasets/x.shp', bare 'f.csv'."""
    pats = [
        r"dataset/([\w/\-]+\.(?:" + DATA_EXT + r"))",
        r"benchmark/datasets/([\w/\-]+\.(?:" + DATA_EXT + r"))",
        r"([A-Za-z0-9_\-]+\.(?:" + DATA_EXT + r"))",
    ]
    found = set()
    for p in pats:
        found.update(re.findall(p, code))
    return sorted(found)


def normalize_paths(code):
    """Reference code reads via '/dataset/x', 'dataset/x' or 'benchmark/datasets/x'.
    The oracle sandbox lays files out under ./dataset/ — rewrite all three."""
    code = code.replace("'/dataset/", "'dataset/").replace('"/dataset/', '"dataset/')
    code = code.replace("benchmark/datasets/", "dataset/")
    return code


def main(n, suite):
    rows = list(csv.DictReader(open(SRC, encoding="utf-8-sig")))
    problems = []
    for row in rows[:n]:
        rid = row["id"].strip()
        pid = f"gab_{int(rid):02d}"
        pdir = os.path.join(ROOT, "problems", pid)
        os.makedirs(os.path.join(pdir, "data"), exist_ok=True)
        os.makedirs(os.path.join(pdir, "reference"), exist_ok=True)

        missing = []
        copied = []
        wanted = referenced_files(row.get("Dataset Description", "")) + code_paths(row["CodeString"])
        # index the GABench data package by basename (it is mostly flat)
        index = {}
        for dirpath, _dirs, files in os.walk(GAB_DATA):
            for f in files:
                index.setdefault(f, os.path.join(dirpath, f))
        for rel in sorted(set(wanted)):
            base = os.path.basename(rel)
            src = index.get(base)
            if src and os.path.getsize(src) < MAX_DATA_MB * 1_000_000:
                # preserve the code's subpath layout AND shapefile siblings
                siblings = [base]
                if base.lower().endswith(".shp"):
                    stem = os.path.splitext(base)[0]
                    siblings = [f for f in index if f.startswith(stem + ".")]
                for sib in siblings:
                    dst = os.path.join(pdir, "data", os.path.dirname(rel), sib)
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.copyfile(index[sib], dst)
                copied.append(rel)
            else:
                missing.append(rel)

        with open(os.path.join(pdir, "statement.md"), "w", encoding="utf-8") as f:
            f.write(
                STATEMENT.format(
                    task=row["Task"].strip(),
                    instruction=row["Instruction"].strip(),
                    knowledge=row["Domain Knowledge"].strip(),
                    datadesc=row["Dataset Description"].strip(),
                )
            )
        with open(os.path.join(pdir, "statement_task.txt"), "w", encoding="utf-8") as f:
            f.write(row["Task"].strip() + "\n" + row["Instruction"].strip())
        with open(os.path.join(pdir, "reference", "solution.py"), "w", encoding="utf-8") as f:
            f.write(normalize_paths(row["CodeString"]))
        with open(os.path.join(pdir, "reference", "workflow.txt"), "w", encoding="utf-8") as f:
            f.write(row["Human Designed Workflow"])
        with open(os.path.join(pdir, "eval.py"), "w", encoding="utf-8") as f:
            f.write(EVAL_PY)
        with open(os.path.join(pdir, "problem.json"), "w", encoding="utf-8") as f:
            json.dump(
                {
                    "genre": "geoanalyst",
                    "judge": True,
                    "python_cmd": GIS_PYTHON_CMD,
                    "max_turns": 25,
                    "eval_cap": 3,
                    "episode_timeout_s": 3600,
                    "script_timeout_s": 300,
                    "job_timeout_s": 7200,
                    "eval_timeout_s": 1500,
                },
                f,
                indent=2,
            )
        problems.append({"id": pid})
        print(f"  {pid}: {row['Task'].strip()[:60]} | data {len(copied)} copied, {len(missing)} missing"
              + (f" {missing[:3]}" if missing else ""))
    with open(os.path.join(ROOT, "config", f"{suite}.problems.json"), "w", encoding="utf-8") as f:
        json.dump({"suite": suite, "problems": problems}, f, indent=2)
    print(f"suite: config/{suite}.problems.json ({len(problems)} problems)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10)
    ap.add_argument("--suite", default="gab")
    a = ap.parse_args()
    main(a.n, a.suite)
