#!/usr/bin/env python3
"""Build a deterministic, stratified GeoRSI curriculum config.

The evolution loop is intentionally evaluated on a fixed manifest. This tool
creates that manifest's problem list before a run, stratifying by public task
metadata (genre) and reserving unseen tasks for a held-out exam. It never reads
private truths or benchmark reference answers.

Example:
  python scripts/make_curriculum.py \
    --config config/geo-base.json \
    --output config/geology-curriculum.json \
    --train-per-genre 4 --heldout-per-genre 1 --seed 20260830
"""
import argparse
import json
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_specs(path: Path):
    raw = json.loads(path.read_text(encoding="utf-8"))
    specs = list(raw.get("problems", []))
    suite_name = raw.get("problems_file")
    if isinstance(suite_name, str):
        suite_path = path.parent / suite_name
        if suite_path.exists():
            suite = json.loads(suite_path.read_text(encoding="utf-8"))
            specs.extend(suite.get("problems", []))
    out, seen = [], set()
    for spec in specs:
        if not isinstance(spec, dict) or not isinstance(spec.get("id"), str):
            continue
        pid = spec["id"].strip()
        if not pid or pid in seen:
            continue
        seen.add(pid)
        out.append(dict(spec, id=pid))
    return raw, out


def genre_for(pid: str, spec: dict) -> str:
    if isinstance(spec.get("genre"), str) and spec["genre"].strip():
        return spec["genre"].strip()
    problem = ROOT / "problems" / pid / "problem.json"
    if problem.exists():
        try:
            metadata = json.loads(problem.read_text(encoding="utf-8"))
            if isinstance(metadata.get("genre"), str) and metadata["genre"].strip():
                return metadata["genre"].strip()
        except (OSError, json.JSONDecodeError):
            pass
    return re.split(r"[_-]", pid, maxsplit=1)[0].lower() or "general"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, help="public base config JSON")
    ap.add_argument("--output", required=True, help="new run config JSON")
    ap.add_argument("--train-per-genre", type=int, default=4)
    ap.add_argument("--heldout-per-genre", type=int, default=1)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--inner-model")
    ap.add_argument("--quiz-inner-model")
    ap.add_argument("--generations", type=int)
    args = ap.parse_args()
    if args.train_per_genre < 1 or args.heldout_per_genre < 0:
        raise SystemExit("train-per-genre must be >=1 and heldout-per-genre must be >=0")

    base_path = (ROOT / args.config).resolve() if not Path(args.config).is_absolute() else Path(args.config).resolve()
    raw, specs = load_specs(base_path)
    groups = {}
    for spec in specs:
        groups.setdefault(genre_for(spec["id"], spec), []).append(spec)

    rng = random.Random(args.seed)
    selected = []
    for genre in sorted(groups):
        pool = list(groups[genre])
        # Explicit held-out records are never promoted into training.
        train_pool = [p for p in pool if not p.get("heldout")]
        explicit_holdout = [p for p in pool if p.get("heldout")]
        rng.shuffle(train_pool)
        rng.shuffle(explicit_holdout)
        train = train_pool[: args.train_per_genre]
        remaining = train_pool[args.train_per_genre :]
        heldout = explicit_holdout + remaining[: args.heldout_per_genre]
        selected.extend([{k: v for k, v in p.items() if k != "heldout"} for p in train])
        selected.extend([dict(p, heldout=True) for p in heldout])

    if not selected or not any(p.get("heldout") for p in selected):
        raise SystemExit("curriculum selected no held-out problem; increase the source pool or heldout-per-genre")

    out = {k: v for k, v in raw.items() if k not in ("problems", "problems_file")}
    out["problems"] = selected
    if args.inner_model:
        out["inner_model"] = args.inner_model
    if args.quiz_inner_model:
        out["quiz_inner_model"] = args.quiz_inner_model
    if args.generations is not None:
        if args.generations < 1:
            raise SystemExit("generations must be >=1")
        out["generations"] = args.generations
    out["curriculum"] = {
        "source": str(base_path.relative_to(ROOT)) if base_path.is_relative_to(ROOT) else str(base_path),
        "seed": args.seed,
        "train_per_genre": args.train_per_genre,
        "heldout_per_genre": args.heldout_per_genre,
        "genres": sorted({genre_for(p["id"], p) for p in selected}),
    }
    output = (ROOT / args.output).resolve() if not Path(args.output).is_absolute() else Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    train_n = sum(1 for p in selected if not p.get("heldout"))
    hold_n = len(selected) - train_n
    print(f"wrote {output}: {train_n} train + {hold_n} held-out across {len(groups)} genres")


if __name__ == "__main__":
    main()
