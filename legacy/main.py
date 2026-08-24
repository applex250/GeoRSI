"""RSI lab entry point.

Runs a recursive self-improvement loop on problems/quake_b:
  outer loop: propose scaffold edits -> apply -> evaluate child episodes
  inner loop: LLM agent writes/executes python until it submits an answer

Usage:
    python main.py            # full run from config.json
    python main.py --smoke    # 1 generation x 1 proposal (fast sanity check)
    python main.py --gens 2   # override generation count
"""

import argparse
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

import rsi.evolve as evo  # noqa: E402
from rsi.llm import TOKENS, make_client  # noqa: E402
from rsi.models import Scaffold  # noqa: E402
from rsi.solve import solve  # noqa: E402

PROBLEM_DIR = os.path.join(ROOT, "problems", "quake_b")

INITIAL_SYSTEM_PROMPT = (
    "You are a careful scientific research agent solving a quantitative "
    "geoscience task.\n"
    "Method:\n"
    "1. Think before coding: state what you know and what you need to estimate.\n"
    "2. Write ONE fenced python block per reply and run it; inspect the real output.\n"
    "3. Validate your estimator against the reference catalog whose true value is given.\n"
    "4. Never report a number you did not compute in executed code.\n"
    "5. Finish by writing your final answer file exactly as the task instructs."
)


def load_api_key(root):
    key = os.environ.get("RSILAB_API_KEY", "").strip()
    if key:
        return key
    p = os.path.join(root, "api_key.txt")
    if os.path.exists(p):
        return open(p, encoding="utf-8").read().strip()
    raise SystemExit("no API key: set RSILAB_API_KEY or write api_key.txt")


def evaluate(client, cfg, scaffold_dict, statement, tag, verbose=False):
    """One inner episode. Returns (fitness | None, error | None, seconds)."""
    ws = os.path.join(ROOT, "workspace", "runs", tag)
    os.makedirs(ws, exist_ok=True)
    log = print if verbose else (lambda m: None)
    t0 = time.time()
    try:
        fitness, err = solve(
            client, cfg["inner_model"], scaffold_dict, statement, ws,
            os.path.join(PROBLEM_DIR, "eval.py"),
            solution_file=os.path.join("solutions", "quake_b.json"),
            max_turns=cfg["max_turns"], log=log,
        )
    except Exception as e:
        return None, f"{type(e).__name__}: {e}", time.time() - t0
    return fitness, err, time.time() - t0


def run(cfg, gens=None, smoke=False):
    statement = open(os.path.join(PROBLEM_DIR, "statement.md"), encoding="utf-8").read()
    client = make_client(cfg["base_url"], load_api_key(ROOT),
                         routes=cfg.get("routes"))

    out_dir = os.path.join(ROOT, "output")
    os.makedirs(out_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    journal_path = os.path.join(out_dir, f"run-{stamp}.jsonl")
    journal = open(journal_path, "a", encoding="utf-8")

    def rec(kind, **kw):
        row = {"kind": kind, "ts": time.strftime("%H:%M:%S")}
        row.update(kw)
        journal.write(json.dumps(row, ensure_ascii=False) + "\n")
        journal.flush()

    n_gen = 1 if smoke else (gens or cfg["generations"])
    n_prop = 1 if smoke else cfg["proposals"]
    budget = int(cfg.get("cost_cap_tokens", 2000000))
    stag_limit = int(cfg.get("stagnation_limit", 3))

    print(f"RSI lab | inner={cfg['inner_model']} outer={cfg['outer_model']} "
          f"gens={n_gen} props/gen={n_prop}")
    rec("start", inner_model=cfg["inner_model"], outer_model=cfg["outer_model"],
        generations=n_gen)

    champ = Scaffold(system_prompt=INITIAL_SYSTEM_PROMPT, tips=[], generation=0)
    print("\n[gen 0] baseline episode ...")
    fit, err, dt = evaluate(client, cfg, champ.to_dict(), statement,
                            f"g0-baseline-{stamp}", verbose=smoke)
    print(f"[gen 0] baseline fitness={fit} err={err} ({dt:.0f}s, {TOKENS['total']} tok)")
    rec("episode", generation=0, role="champion", fitness=fit, error=err,
        secs=round(dt), tokens=TOKENS["total"])

    best = fit if fit is not None else -1.0
    stagnation = 0

    for gen in range(1, n_gen + 1):
        print(f"\n===== GENERATION {gen}/{n_gen} =====")
        winners = []

        for k in range(n_prop):
            if TOKENS["total"] > budget:
                print("  token budget exhausted; stopping.")
                journal.close()
                return champ, best
            angle = evo.ANGLES[(gen + k) % len(evo.ANGLES)]
            feedback = "" if fit is None else f"champion fitness {fit:.3f}"
            print(f"  [propose {k + 1}/{n_prop}] angle={angle}")
            try:
                prop = evo.propose(client, cfg["outer_model"], champ.to_dict(), angle,
                                   feedback=feedback)
            except Exception as e:
                print(f"    -> propose failed: {type(e).__name__}: {str(e)[:150]}")
                rec("proposal", generation=gen, angle=angle, valid=False,
                    error=f"{type(e).__name__}: {str(e)[:200]}")
                continue
            if prop is None:
                print("    -> invalid proposal, skipped")
                rec("proposal", generation=gen, angle=angle, valid=False)
                continue
            mech = prop["mechanism"][:100]
            print(f"    -> {mech}")
            child = Scaffold.from_dict(evo.apply_edits(champ.to_dict(), prop["edits"]))
            child.generation = gen
            cfit, cerr, cdt = evaluate(client, cfg, child.to_dict(), statement,
                                       f"g{gen}-p{k + 1}-{stamp}", verbose=smoke)
            print(f"    -> child fitness={cfit} err={cerr} ({cdt:.0f}s)")
            rec("proposal", generation=gen, angle=angle, valid=True,
                mechanism=prop["mechanism"], expected_delta=prop["expected_delta"],
                fitness=cfit, error=cerr, secs=round(cdt),
                tokens=TOKENS["total"], tips=list(child.tips))
            if cfit is not None:
                winners.append((cfit, child))

        if not winners:
            stagnation += 1
            print(f"  no valid children (stagnation {stagnation}/{stag_limit})")
        else:
            winners.sort(key=lambda x: x[0], reverse=True)
            top_fit, top_child = winners[0]
            if top_fit > best:
                print(f"  *** NEW CHAMPION {best:.4f} -> {top_fit:.4f} ***")
                best, champ, stagnation = top_fit, top_child, 0
                champ.save(os.path.join(out_dir, f"champion-g{gen}.json"))
            else:
                stagnation += 1
                print(f"  champion keeps {best:.4f} (stagnation {stagnation}/{stag_limit})")

        if stagnation >= stag_limit:
            print("  stagnation limit reached; early stop.")
            break

    champ.save(os.path.join(out_dir, f"champion-final-{stamp}.json"))
    print(f"\nDONE best_fitness={best:.4f} tokens={TOKENS['total']}")
    print(f"journal: {journal_path}")
    journal.close()
    return champ, best


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="RSI self-evolution runner")
    ap.add_argument("--config", default=os.path.join(ROOT, "config.json"))
    ap.add_argument("--gens", type=int, default=None)
    ap.add_argument("--smoke", action="store_true", help="tiny fast sanity run")
    args = ap.parse_args()
    with open(args.config, encoding="utf-8") as fh:
        CFG = json.load(fh)
    run(CFG, gens=args.gens, smoke=args.smoke)