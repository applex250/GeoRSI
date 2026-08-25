"""GeoBenchX -> GeoRSI problems builder (tool-chain solution + reject semantics).

Each selected task becomes one problem:
  problems/gbx_<NNN>/
    statement.md      task text + dataset catalogs + tool vocabulary + contract
    data/             UNION of datasets referenced by all selected tasks
                      (identical footprint in every problem -> no per-problem leak;
                      feasibility must be judged from the catalog text itself)
    reference/        reference.json (reference_solutions steps) - judge-only input
    eval.py           reject tasks: deterministic (correct rejection = 1.0);
                      real tasks: LLM judge match score (0/1/2 -> 0/0.5/1, cached)
    problem.json      overrides (long scripts, judge, .gisenv python)

Control questions (empty reference, 5 of 202) are excluded: the benchmark
itself does not score their answers.

Usage:
  python scripts/gbx_build.py --n-real 8 --n-reject 4 --suite gbx
"""
import argparse
import ast
import json
import os
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "benchmarks", "GeoBenchX", "benchmark_set", "tasks_and_reference_solutions.json")
TOOLS_PY = os.path.join(ROOT, "benchmarks", "GeoBenchX", "geobenchx", "tools.py")
DATA_ROOT = os.path.join(ROOT, "benchmarks", "GeoBenchX", "data")
MAX_FILE_MB = 60
MAX_TOTAL_MB = 500

# arg key -> catalog name inside tools.py
LOADERS = {
    "load_data": ("dataset", "DATA_CATALOG", "StatData"),
    "load_geodata": ("geodataset", "GEO_CATALOG", "Geodata"),
    "get_raster_path": ("rasterdataset", "RASTER_CATALOG", "Geodata"),
}

TOOLS_TABLE = """| function | what it does |
|---|---|
| load_data(dataset, output_dataframe_name) | load a statistical dataset from DATA_CATALOG into a pandas DataFrame |
| load_geodata(geodataset, output_geodataframe_name) | load vector geodata from GEO_CATALOG into a GeoDataFrame |
| get_raster_path(rasterdataset) | resolve the path of a raster dataset from RASTER_CATALOG |
| get_raster_description(rasterdataset) | raster metadata (crs, bounds, nodata, dtype) |
| analyze_raster_overlap(raster1, raster2) | overlap statistics between two rasters |
| get_values_from_raster_with_geometries(rasterdataset, geodataframe, statistics, nodataval) | zonal statistics of a raster over geometries |
| merge_dataframes(dataframe_name, geodataframe_name, statkey, geokey, output_dataframe_name) | join statistical + geospatial tables on key columns |
| get_unique_values(dataframe_name, column_name) | unique values of a column (e.g. exact country/region spellings) |
| filter_categorical(dataframe_name, filters, output_dataframe_name) | keep rows matching categorical values |
| filter_numerical(dataframe_name, query, output_dataframe_name) | keep rows matching a numerical query expression |
| calculate_column_statistics(dataframe_name, column_name) | count/min/max/mean/std of a column |
| create_buffer(geodataframe_name, buffer_size, output_geodataframe_name) | buffer zones around geometries |
| make_choropleth_map(dataframe_name, mappingkey, legendtext, colormap) | choropleth map of a column |
| filter_points_by_raster_values(rasterdataset, geodataframe_name, filter_condition, ...) | sample raster at points and filter by threshold |
| select_features_by_spatial_relationship(input_geodataframe, related_geodataframe, spatial_predicates, ...) | spatial join/selection (intersects, within, ...) |
| calculate_line_lengths(geodataframe_name, output_column_name) | line feature lengths in km (UTM) |
| calculate_columns(output_column_name, operation, ...) | column arithmetic (multiply/divide/add/subtract) |
| scale_column_by_value(geodataframe_name, column_name, operation, scale_factor) | scale a column by a constant |
| make_heatmap(geodataframe_name, heat_column, heat_map_ws) | interactive heatmap of point data |
| visualize_geographies(geodataframe_name, ...) | draw geodata layers with custom styling |
| get_centroids(geodataframe_name, output_column_name) | polygon centroids |
| plot_contour_lines(rasterdataset, interval) | contour lines from a raster |
| generate_contours_display(rasterdataset, interval) | contour generation via GDAL |
| make_bivariate_map(x, y, ...) | bivariate choropleth of two variables |
| reject_task() | declare the task unsolvable with the available datasets/tools |
"""

STATEMENT = """# GeoBenchX task {tid}

## Task
{task_text}

## Your toolkit (solution vocabulary)
Solutions are expressed as an ordered chain of tool calls. You do NOT call these
tools directly — you work with python (run_python / start_job; geopandas,
rasterio, pandas available) on the local files listed in the catalogs below,
then REPORT the chain you followed using this vocabulary:

{tools}

## Available datasets (catalogs)
The catalogs below are the complete list of datasets that exist. A task that
needs data not listed here cannot be solved with the toolkit and must be
rejected (see How to submit).

DATA_CATALOG (statistical tables, `data/StatData/`):
{data_catalog}

GEO_CATALOG (vector geodata, `data/Geodata/`):
{geo_catalog}
{raster_catalog_block}
## How to work
1. Decide whether the task is a geospatial task solvable with the catalog
   datasets and the toolkit above.
   - Not a geospatial task / does not need the provided datasets: just answer it
     directly (steps = [], reject = false).
   - Geospatial but NOT solvable with the available datasets or tools: submit
     reject = true (this is a valid, correct outcome — do not force an answer).
2. If solvable: actually do the analysis with python on the local files
   (inspect them, compute, produce any figure the task asks for). The datasets
   for the catalog live under `data/StatData/` and `data/Geodata/`
   (shapefile sidecar files are included).
3. Call the submit tool with a JSON object EXACTLY of this shape:
   {{
     "steps": [{{"function_name": "<tool>", "arguments": {{...}}}}, ...],
     "reject": false,
     "answer": "<the direct answer to the question, 1-3 sentences with key numbers>",
     "summary": "<method + main results, 2-4 sentences>"
   }}
   For a rejection: {{"steps": [], "reject": true, "reason": "<what is missing>"}}

## Grading
Your reported chain is compared against expert reference solutions for this
task: same datasets and tool usage with correct results scores full; right
approach with minor discrepancies scores partial; wrong data/tools or a forced
answer where rejection was correct scores zero. A correct rejection scores
full. The public score only checks that your submission is well-formed.
"""

EVAL_PY = '''"""GeoBenchX eval (auto-generated).
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
'''


def parse_catalogs():
    """Extract DATA/GEO/RASTER catalog dicts from tools.py without importing it."""
    tree = ast.parse(open(TOOLS_PY, encoding="utf-8").read())
    cats = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id in ("DATA_CATALOG", "GEO_CATALOG", "RASTER_CATALOG"):
                    cats[t.id] = ast.literal_eval(node.value)
    missing = {"DATA_CATALOG", "GEO_CATALOG", "RASTER_CATALOG"} - set(cats)
    if missing:
        raise SystemExit(f"catalog parse failed: {missing}")
    return cats


def index_data_files():
    """basename -> path for every file under the data package (case-insensitive)."""
    index = {}
    if not os.path.isdir(DATA_ROOT):
        return index
    for dirpath, _dirs, files in os.walk(DATA_ROOT):
        for f in files:
            if f == "package.zip":
                continue
            index.setdefault(f.lower(), os.path.join(dirpath, f))
    return index


def task_datasets(task, catalogs):
    """(catalog_name, dataset_name) referenced by the task's reference solution."""
    steps = task["reference_solutions"][0].get("steps", []) if task["reference_solutions"] else []
    out = set()
    for s in steps:
        fn = s.get("function_name")
        if fn in LOADERS:
            key, cat, _sub = LOADERS[fn]
            ds = s.get("arguments", {}).get(key)
            if ds:
                out.add((cat, ds))
    return out


def classify(task):
    steps = task["reference_solutions"][0].get("steps", []) if task["reference_solutions"] else []
    if not steps:
        return "control"
    if steps[0].get("function_name") == "reject_task":
        return "reject"
    return "real"


def catalog_md(cat):
    return "\n".join(f"- `{k}` -> `{v}`" for k, v in cat.items())


def main(n_real, n_reject, suite, allow_raster):
    tasks = json.load(open(SRC, encoding="utf-8"))["tasks"]
    catalogs = parse_catalogs()
    index = index_data_files()

    def resolve(cat_name, ds):
        fname = catalogs[cat_name].get(ds)
        if not fname:
            return None, None
        path = index.get(fname.lower())
        return fname, path

    picked = []
    for t in tasks:
        if len(picked) >= n_real + n_reject:
            break
        kind = classify(t)
        if kind == "control":
            continue
        if kind == "reject":
            if sum(1 for p in picked if p[0] == "reject") < n_reject:
                picked.append((kind, t, set()))
            continue
        # real task: every referenced dataset must be present and within caps
        refs = task_datasets(t, catalogs)
        files = []
        ok = True
        for cat_name, ds in refs:
            if cat_name == "RASTER_CATALOG" and not allow_raster:
                ok = False
                break
            fname, path = resolve(cat_name, ds)
            if not path or os.path.getsize(path) > MAX_FILE_MB * 1_000_000:
                ok = False
                break
            siblings = [path]
            stem = os.path.splitext(fname)[0]
            if fname.lower().endswith(".shp"):
                siblings = [p for fl, p in index.items() if fl.startswith(stem.lower() + ".")]
            files.append((cat_name, siblings))
        if ok and refs:
            picked.append((kind, t, files))

    real = [p for p in picked if p[0] == "real"]
    if not real:
        raise SystemExit("no real tasks resolvable - is the data package unzipped under benchmarks/GeoBenchX/data?")

    # UNION of datasets across all selected tasks -> identical data/ per problem
    union = []
    seen = set()
    total = 0
    for _kind, _t, files in real:
        for cat_name, siblings in files:
            key = (cat_name, tuple(siblings))
            if key in seen:
                continue
            seen.add(key)
            for p in siblings:
                total += os.path.getsize(p)
            union.append((cat_name, siblings))
    if total > MAX_TOTAL_MB * 1_000_000:
        raise SystemExit(f"union data too large: {total/1e6:.0f} MB")

    raster_used = any(c == "RASTER_CATALOG" for c, _ in union)
    problems = []
    out_root = os.path.join(ROOT, "problems")
    for i, (kind, t, _files) in enumerate(picked, 1):
        tid = t["task_ID"].rsplit("_", 1)[-1]
        pid = f"gbx_{i:03d}"
        pdir = os.path.join(out_root, pid)
        os.makedirs(os.path.join(pdir, "data"), exist_ok=True)
        os.makedirs(os.path.join(pdir, "reference"), exist_ok=True)
        for cat_name, siblings in union:
            sub = LOADERS["load_geodata" if cat_name != "DATA_CATALOG" else "load_data"][2] if cat_name != "RASTER_CATALOG" else "Geodata"
            for p in siblings:
                dst = os.path.join(pdir, "data", sub, os.path.basename(p))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                if not os.path.exists(dst):
                    shutil.copyfile(p, dst)
        raster_block = ""
        if raster_used:
            raster_block = "\nRASTER_CATALOG (rasters, `data/Geodata/`):\n" + catalog_md(catalogs["RASTER_CATALOG"]) + "\n"
        with open(os.path.join(pdir, "statement.md"), "w", encoding="utf-8") as f:
            f.write(
                STATEMENT.format(
                    tid=tid,
                    task_text=t["task_text"].strip(),
                    tools=TOOLS_TABLE,
                    data_catalog=catalog_md(catalogs["DATA_CATALOG"]),
                    geo_catalog=catalog_md(catalogs["GEO_CATALOG"]),
                    raster_catalog_block=raster_block,
                )
            )
        with open(os.path.join(pdir, "reference", "reference.json"), "w", encoding="utf-8") as f:
            json.dump(
                {
                    "task_ID": t["task_ID"],
                    "task_text": t["task_text"],
                    "reference_solutions": [
                        {"steps": s.get("steps", [])} for s in (t["reference_solutions"] or [{}])
                    ],
                },
                f,
                ensure_ascii=False,
                indent=1,
            )
        with open(os.path.join(pdir, "eval.py"), "w", encoding="utf-8") as f:
            f.write(EVAL_PY)
        with open(os.path.join(pdir, "problem.json"), "w", encoding="utf-8") as f:
            json.dump(
                {
                    "genre": "geobenchx",
                    "judge": True,
                    "python_cmd": os.path.join(ROOT, ".gisenv", "Scripts", "python.exe"),
                    "max_turns": 30,
                    "eval_cap": 3,
                    "episode_timeout_s": 3600,
                    "script_timeout_s": 300,
                    "job_timeout_s": 7200,
                    "eval_timeout_s": 900,
                },
                f,
                indent=2,
            )
        problems.append({"id": pid})
        print(f"  {pid} [{kind}] {t['task_text'].strip()[:70]}")

    suite_path = os.path.join(ROOT, "config", f"{suite}.problems.json")
    with open(suite_path, "w", encoding="utf-8") as f:
        json.dump({"suite": suite, "problems": problems}, f, indent=2)
    print(f"\nbuilt {len(problems)} problems ({sum(1 for p in picked if p[0]=='reject')} reject) "
          f"with a shared union data set ({total/1e6:.0f} MB)")
    print(f"suite file: {suite_path}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-real", type=int, default=8)
    ap.add_argument("--n-reject", type=int, default=4)
    ap.add_argument("--suite", default="gbx")
    ap.add_argument("--allow-raster", action="store_true")
    a = ap.parse_args()
    main(a.n_real, a.n_reject, a.suite, a.allow_raster)
