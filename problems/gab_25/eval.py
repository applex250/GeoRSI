"""GeoAnalystBench oracle eval (auto-generated).
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
    for m in re.finditer(r"-?\d+\.\d+(?:[eE][-+]?\d+)?", text):
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
        present = sum(
            1 for f in out_files
            if (path := safe_artifact_path(ws, f))
            and os.path.isfile(path)
            and os.path.getsize(path) > 1024
        )
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
