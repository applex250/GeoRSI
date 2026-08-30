"""GABench (geox-lab, 57 GIS-execution tasks) -> GeoRSI problems builder.

Each benchmark.csv row becomes one problem:
  problems/gabench_<NN>/
    statement.md   Task + Data Description + Drawing Style + submit contract
                   (Toolchain JSON / Result / Layers stay HIDDEN - they are the
                   grading reference, never shown to the agent)
    data/          the dataset/* files this task references (copied flat)
    reference/     toolchain.json + result.txt + layers.txt (judge-only)
    eval.py        artifact-presence hard check + cached LLM judge vs the
                   hidden reference (no oracle: the reference toolchains are
                   ArcGIS-style operations we cannot execute)

Usage: python scripts/gabench_build.py [--n 57] [--suite gabench]
"""
import argparse
import csv
import json
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "benchmarks", "GABench", "benchmark", "benchmark.csv")
DATA_SRC = os.path.join(ROOT, "benchmarks", "GABench", "dataset")
SHARED = os.path.join(ROOT, "problems", "_shared")
MAX_FILE_MB = 400
GIS_PYTHON_CMD = os.environ.get("GEORSI_GIS_PYTHON", r"F:\GeoRSI\venvs\gis\Scripts\python.exe")

STATEMENT = """# {domain}

## Task
{task}

## Data
{data}

## Expected deliverable style
{style}

## How to submit
1. Analyze the data with python (write scripts, run_python; use start_job for
   anything longer than a couple of minutes). geopandas / rasterio / scipy are
   available in the python environment.
2. Produce the output artifact(s) the task asks for (figures as PNG, derived
   layers as geojson/tif) in the workspace root, with descriptive filenames.
3. Call the submit tool with a JSON object EXACTLY of this shape:
   {{
     "key_values": {{"<descriptive label>": <number>, ...}},
     "output_files": ["<filename you created>", ...],
     "summary": "<2-4 sentences: method and main findings>"
   }}

## Grading
Your produced artifacts are checked for existence/non-degeneracy, and your
method + results are compared against an expert reference solution (tool
chain, expected product, cartographic style). Method correctness matters more
than pixel-exact styling.
"""

EVAL_PY = '''"""GABench eval: artifact checks + cached LLM judge vs hidden reference."""
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
    present = 0
    for f in out_files:
        path = safe_artifact_path(ws, f)
        if path and os.path.isfile(path) and os.path.getsize(path) > 1024:
            present += 1

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
'''


def referenced_datasets(row):
    """dataset/<name> references from Data Description + Toolchain JSON."""
    blob = row.get("Data Description", "") + " " + row.get("Toolchain JSON", "")
    return sorted(set(re.findall(r"dataset/([A-Za-z0-9_.\-]+)", blob)))


def main(n, suite):
    index = {}
    for dirpath, _dirs, files in os.walk(DATA_SRC):
        for f in files:
            index.setdefault(f.lower(), os.path.join(dirpath, f))

    rows = list(csv.DictReader(open(SRC, encoding="utf-8-sig")))[:n]
    problems = []
    skipped = []
    for i, row in enumerate(rows, 1):
        rid = int(row["ID"])
        pid = f"gabench_{rid:02d}"
        pdir = os.path.join(ROOT, "problems", pid)
        os.makedirs(os.path.join(pdir, "data"), exist_ok=True)
        os.makedirs(os.path.join(pdir, "reference"), exist_ok=True)

        missing, total_mb = [], 0.0
        for name in referenced_datasets(row):
            src = index.get(name.lower())
            if not src:
                missing.append(name)
                continue
            # shapefiles are useless without sidecars: pull stem.* siblings
            stem = os.path.splitext(name)[0]
            family = [name]
            if name.lower().endswith(".shp"):
                family += [f for f in os.listdir(DATA_SRC)
                           if f.lower().startswith(stem.lower() + ".") and f.lower() != name.lower()]
            for fname in family:
                fsrc = index.get(fname.lower()) or os.path.join(DATA_SRC, fname)
                if not os.path.exists(fsrc):
                    continue
                mb = os.path.getsize(fsrc) / 1e6
                if mb > MAX_FILE_MB:
                    missing.append(f"{fname}({mb:.0f}MB)")
                    continue
                dst = os.path.join(pdir, "data", fname)
                if not os.path.exists(dst):
                    shutil.copyfile(fsrc, dst)
                total_mb += mb

        with open(os.path.join(pdir, "statement.md"), "w", encoding="utf-8") as f:
            f.write(STATEMENT.format(
                domain=row["Domain"].strip(),
                task=row["Task Description"].strip(),
                data=row["Data Description"].strip(),
                style=row["Drawing Style"].strip(),
            ))
        with open(os.path.join(pdir, "statement_task.txt"), "w", encoding="utf-8") as f:
            f.write(row["Task Description"].strip())
        with open(os.path.join(pdir, "reference", "toolchain.json"), "w", encoding="utf-8") as f:
            f.write(row.get("Toolchain JSON") or "[]")
        with open(os.path.join(pdir, "reference", "result.txt"), "w", encoding="utf-8") as f:
            f.write(row.get("Result", "").strip())
        with open(os.path.join(pdir, "reference", "layers.txt"), "w", encoding="utf-8") as f:
            f.write(row.get("Layers", "").strip())
        ref_all = (
            "EXPERT TOOLCHAIN:\n" + (row.get("Toolchain JSON") or "") +
            "\nEXPECTED PRODUCT(S): " + (row.get("Result", "")) +
            "\nINTERMEDIATE LAYERS: " + (row.get("Layers", ""))
        )
        with open(os.path.join(pdir, "reference", "reference.txt"), "w", encoding="utf-8") as f:
            f.write(ref_all)
        with open(os.path.join(pdir, "eval.py"), "w", encoding="utf-8") as f:
            f.write(EVAL_PY)
        with open(os.path.join(pdir, "problem.json"), "w", encoding="utf-8") as f:
            json.dump({
                "genre": "gabench",
                "judge": True,
                "python_cmd": GIS_PYTHON_CMD,
                "max_turns": 25,
                "eval_cap": 3,
                "episode_timeout_s": 3600,
                "script_timeout_s": 300,
                "job_timeout_s": 7200,
                "eval_timeout_s": 900,
            }, f, indent=2)
        problems.append({"id": pid})
        flag = f" | MISSING DATA: {missing[:3]}" if missing else ""
        print(f"{pid}: {row['Domain'][:28]:<28} data {total_mb:5.0f}MB{flag}")
        if missing:
            skipped.append(pid)

    suite_path = os.path.join(ROOT, "config", f"{suite}.problems.json")
    with open(suite_path, "w", encoding="utf-8") as f:
        json.dump({"suite": suite, "problems": problems}, f, indent=2)
    print(f"\nbuilt {len(problems)} problems ({len(skipped)} with missing data) -> {suite_path}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=57)
    ap.add_argument("--suite", default="gabench")
    a = ap.parse_args()
    main(a.n, a.suite)
