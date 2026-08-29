"""AutoLoop verdict extractor: turn a finished rsi run into a machine decision.

Reads runs/<name>/ artifacts (state.json, episodes/*/episode.json, heldout,
log) and prints a JSON verdict:
  verdict: CHAMPION | CLEAN_NEGATIVE | CRASHY | REGRESSION | BROKEN
  next_action: STOP_SUCCESS | RETRY | STOP_NEGATIVE | ESCALATE

Crash taxonomy (drives the autoloop fix table):
  premature-submit  quiz episode with <50% answers submitted (fitness crater)
  stall             zero artifacts produced (model behavioral failure)
  eval-err          fitness null / eval-side failure
"""
import glob
import json
import os
import re
import sys

BS = chr(92)


def load(path):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return None


def answers_count(ws):
    try:
        return len(json.load(open(os.path.join(ws, "answers.json"), encoding="utf-8")))
    except Exception:
        return 0


def classify_episode(ws, rec):
    if rec.get("fitness") is None:
        return "eval-err"
    f = rec["fitness"]
    n = answers_count(ws)
    if n and n < 50 and (f is None or f < 0.5):
        return "premature-submit"
    return None


def expected_heldout(manifest):
    if not manifest:
        return []
    problems = [p for p in manifest.get("problems", []) if p.get("heldout")]
    repeats = max(1, int(manifest.get("config", {}).get("episodes_per_problem", 1) or 1))
    expected = []
    for repeat in range(repeats):
        for problem in problems:
            name = problem["id"] if repeats == 1 else f"r{repeat + 1}-{problem['id']}"
            expected.append((name, float(problem.get("weight", 1) or 1), problem["id"]))
    return expected


def compute_heldout(root, manifest):
    expected = expected_heldout(manifest)
    rows = []
    missing = []
    for name, weight, problem_id in expected:
        path = os.path.join(root, "heldout", name, "episode.json")
        rec = load(path)
        valid = bool(rec and rec.get("problemId") == problem_id and rec.get("fitness") is not None)
        if not valid:
            missing.append(name)
        rows.append(((float(rec["fitness"]) if valid else 0.0), weight))
    total_weight = sum(weight for _, weight in rows)
    mean = round(sum(value * weight for value, weight in rows) / total_weight, 4) if total_weight > 0 else None
    return mean, bool(expected) and not missing, missing


def main(run):
    root = os.path.join("runs", run)
    state = load(os.path.join(root, "state.json"))
    manifest = load(os.path.join(root, "run-manifest.json"))
    if not state:
        print(json.dumps({"run": run, "verdict": "BROKEN", "next_action": "ESCALATE", "why": "no state.json"}))
        return
    if not manifest:
        print(json.dumps({"run": run, "verdict": "BROKEN", "next_action": "ESCALATE", "why": "no run-manifest.json"}))
        return
    baseline = state["fitnessHistory"][0] if state["fitnessHistory"] else None
    best = state.get("bestFitness")
    accepts = []
    try:
        with open(os.path.join(root, "board.jsonl"), encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                rec = json.loads(line)
                if rec.get("kind") == "accept":
                    accepts.append(rec)
    except Exception:
        pass
    # Seed scaffolds may already contain tips. Only an explicit accept record
    # proves that this run changed the champion; presence of tips is not proof.
    champion_changed = bool(accepts)

    crashes = []
    for p in glob.glob(os.path.join(root, "episodes", "*", "episode.json")) + glob.glob(os.path.join(root, "heldout", "*", "episode.json")):
        rec = load(p)
        if not rec:
            continue
        kind = classify_episode(os.path.dirname(p), rec)
        if kind:
            crashes.append({"episode": os.path.basename(os.path.dirname(p)), "fitness": rec["fitness"], "kind": kind})

    heldout, heldout_complete, missing_heldout = compute_heldout(root, manifest)
    for name in missing_heldout:
        crashes.append({"episode": name, "fitness": None, "kind": "missing-heldout"})

    tokens = 0
    for p in glob.glob(os.path.join(root, "episodes", "*", "episode.json")) + glob.glob(os.path.join(root, "heldout", "*", "episode.json")):
        rec = load(p)
        if rec:
            tokens += rec.get("tokens") or 0

    log = ""
    try:
        log = open(os.path.join("runs", run + ".log"), encoding="utf-8").read()
    except Exception:
        pass
    guard = len(re.findall(r"COMPROMISED", log))

    # decision logic
    # completion dominance: a run that VERIFIABLY improved the champion AND
    # finished its held-out exam is a success story regardless of individual
    # weak episodes (they are recorded in crashes for diagnosis, not verdict)
    # later challengers scoring low are FAILED ATTEMPTS, not capability loss:
    # the verified champion is retained by design. Generalization gate =
    # heldout must stay within 0.15 of the training baseline.
    if champion_changed and heldout_complete and heldout is not None and baseline is not None and heldout >= baseline - 0.15:
        print(json.dumps({
            "run": run, "verdict": "CHAMPION", "next_action": "STOP_SUCCESS",
            "baseline": baseline, "best": best, "champion_changed": True,
            "accepts": len(accepts),
            "history": [round(f, 4) for f in state["fitnessHistory"]],
            "heldout": heldout, "heldout_complete": heldout_complete, "guard_violations": guard, "tokens": tokens,
            "diagnosed_episodes": crashes,
        }, ensure_ascii=False, indent=1))
        return

    if crashes:
        kinds = {c["kind"] for c in crashes}
        verdict = "CRASHY"
        # premature-submit has an in-repo fix (coverage gate); stall needs probes
        next_action = "RETRY" if kinds <= {"premature-submit"} else "ESCALATE"
    elif champion_changed:
        verdict = "CHAMPION"
        next_action = "STOP_SUCCESS"
    else:
        # challengers above baseline but verification never cleared the bar =
        # plateau at ceiling, not regression. Near-miss (within striking
        # distance) earns one more roll under the same config.
        # history records champion values per gen; challenger means live in
        # board.jsonl episode records - those are the real near-miss signal
        challenger_means = []
        try:
            for _line in open(os.path.join(root, "board.jsonl"), encoding="utf-8"):
                if not _line.strip():
                    continue
                try:
                    _r = json.loads(_line)
                except Exception:
                    continue
                if _r.get("kind") == "episode" and _r.get("role") == "challenger" and _r.get("fitness") is not None:
                    challenger_means.append(float(_r["fitness"]))
        except FileNotFoundError:
            pass
        near_miss = baseline is not None and any(m >= baseline + 0.005 for m in challenger_means)
        if not champion_changed and baseline is not None and best is not None and best >= baseline:
            verdict = "PLATEAU_NEAR_MISS"
            next_action = "RETRY"
        elif near_miss:
            verdict = "CLEAN_NEGATIVE"
            next_action = "RETRY"
        else:
            verdict = "CLEAN_NEGATIVE"
            next_action = "STOP_NEGATIVE"

    out = {
        "run": run,
        "verdict": verdict,
        "next_action": next_action,
        "baseline": baseline,
        "best": best,
        "champion_changed": champion_changed,
        "accepts": len(accepts),
        "history": [round(f, 4) for f in state["fitnessHistory"]],
        "heldout": heldout,
        "heldout_complete": heldout_complete,
        "guard_violations": guard,
        "tokens": tokens,
        "crashes": crashes,
    }
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
