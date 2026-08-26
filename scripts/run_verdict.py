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


def main(run):
    root = os.path.join("runs", run)
    state = load(os.path.join(root, "state.json"))
    if not state:
        print(json.dumps({"run": run, "verdict": "BROKEN", "next_action": "ESCALATE", "why": "no state.json"}))
        return
    baseline = state["fitnessHistory"][0] if state["fitnessHistory"] else None
    best = state.get("bestFitness")
    champion_changed = bool(state["champion"].get("tips")) or (best != baseline and best is not None and baseline is not None and best > baseline)

    crashes = []
    for p in glob.glob(os.path.join(root, "episodes", "*", "episode.json")) + glob.glob(os.path.join(root, "heldout", "*", "episode.json")):
        rec = load(p)
        if not rec:
            continue
        kind = classify_episode(os.path.dirname(p), rec)
        if kind:
            crashes.append({"episode": os.path.basename(os.path.dirname(p)), "fitness": rec["fitness"], "kind": kind})

    heldout = None
    hres = load(os.path.join(root, "RESULTS.md").replace("RESULTS.md", "RESULTS.md"))  # placeholder
    for p in glob.glob(os.path.join(root, "heldout", "*", "episode.json")):
        rec = load(p)
        if rec and rec.get("fitness") is not None:
            heldout = rec["fitness"]

    tokens = 0
    for p in glob.glob(os.path.join(root, "episodes", "*", "episode.json")):
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
    if crashes:
        kinds = {c["kind"] for c in crashes}
        verdict = "CRASHY"
        # premature-submit has an in-repo fix (coverage gate); stall needs probes
        next_action = "RETRY" if kinds <= {"premature-submit"} else "ESCALATE"
    elif champion_changed:
        verdict = "CHAMPION"
        next_action = "STOP_SUCCESS"
    elif len(state["fitnessHistory"]) >= 2 and max(state["fitnessHistory"][1:]) <= baseline + 0.001:
        verdict = "CLEAN_NEGATIVE"
        next_action = "STOP_NEGATIVE"
    else:
        verdict = "REGRESSION"
        next_action = "ESCALATE"

    out = {
        "run": run,
        "verdict": verdict,
        "next_action": next_action,
        "baseline": baseline,
        "best": best,
        "champion_changed": champion_changed,
        "history": [round(f, 4) for f in state["fitnessHistory"]],
        "heldout": heldout,
        "guard_violations": guard,
        "tokens": tokens,
        "crashes": crashes,
    }
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
