# Scope Tip Pilot

> **Metric-version caveat (2026-08-29):** this historical pilot ran with the legacy quiz private metric that scored all five items, including the two public dev items, despite the intended 2/3 terminology below. Current `private-only-v2` scores only `dev=false`; do not compare these values directly with new runs.

## Purpose

This is a controlled pilot for the hypothesis that task-scoped tips transfer
better than universal tips. It is a routing experiment, not a claim about the
absolute capability of the model.

## Protocol

- Date: 2026-08-27
- Inner model: `z-ai/glm-5.3-flash`
- Outer model: `hy3` (not exercised by standalone `exam` mode)
- Same task set for all arms: 5 StepGame, 5 MapQA, 5 K2 questions
- Public calibration: 2 questions per task; private-only: 3 questions per task
- `rag_enabled=false` for all arms
- `max_turns=4`, `eval_cap=2`, one episode per task
- MapQA used the task-selected supporting files (`--data-mode task`) rather
  than the full 5.5 MB entity table; this keeps the pilot bounded and is not a
  substitute for full-data MapQA evaluation
- Runs were serial because concurrent OpenRouter requests produced highly
  variable first-turn latency and obscured the scope comparison

The three arms differed only in scaffold tips:

| Arm | Scaffold | Tip policy |
|---|---|---|
| A | `scaffolds/scope-A-seed.json` | no tips |
| B | `scaffolds/scope-B-unscoped.json` | four universal tips |
| C | `scaffolds/scope-C-scoped.json` | three quiz tips scoped to quiz genres, one GIS tip scoped to GIS genres |

Pilot configs:

- `config/scope-pilot5-A-seed.json`
- `config/scope-pilot5-B-unscoped.json`
- `config/scope-pilot5-C-scoped.json`

## Results

| Arm | StepGame | MapQA | K2 | Mean | Run |
|---|---:|---:|---:|---:|---|
| A seed | 0.8000 | 0.2000 | 1.0000 | **0.6667** | `runs/scope-final-A-seed-glm/RESULTS.md` |
| B unscoped | 0.4000 | 0.2000 | 1.0000 | **0.5333** | `runs/scope-final-B-unscoped-glm/RESULTS.md` |
| C scoped | 0.8000 | 0.2000 | 1.0000 | **0.6667** | `runs/scope-final-C-scoped-glm/RESULTS.md` |

All nine episodes completed with non-null private fitness. The two earlier
100/60-question runs are excluded: they either used retired model aliases or
were stopped after the first episode became operationally unbounded.

## Interpretation

1. On this sample, scoped tips matched the no-tip seed arm; there is no
   evidence of a measurable scoped-tip gain.
2. The universal-tip arm was lower by 0.1334 mean fitness, but the pilot has
   one stochastic episode per task and only three private questions per task.
   This is a warning signal, not a statistically stable negative-transfer
   estimate.
3. The public calibration score was not a reliable predictor of private score
   on these tiny slices. It remains useful for steering within an episode, not
   for replacing held-out evaluation.
4. A larger follow-up should use multiple seeds and several independent slices
   while keeping each episode small enough to submit within the watchdog.

## Reproduction

The pilot slices can be regenerated from the checked-in source chunks with:

```text
python scripts/quiz_slice.py --source stepgame_c005 --target stepgame_scope_micro_5 --genre quiz-stepgame --public-count 2 --private-count 3 --private-offset 40 --max-turns 4 --eval-timeout-s 600
python scripts/quiz_slice.py --source mapqa_c005 --target mapqa_scope_micro_5 --genre quiz-mapqa --public-count 2 --private-count 3 --private-offset 40 --max-turns 4 --eval-timeout-s 600 --judge --data-mode task
python scripts/quiz_slice.py --source k2_c008 --target k2_scope_micro_5 --genre quiz-k2 --public-count 2 --private-count 3 --private-offset 40 --max-turns 4 --eval-timeout-s 600
```

Validate the generated metadata with `python scripts/struct_selftest.py`, and
run each config with its own `RSILAB_KB_PATH` and `RSILAB_JUDGE_CACHE`. Do not
merge the three lane KBs during the comparison. Supporting `data/` files are
ignored by the repository because benchmark data is regenerable; regenerate
the slices before running on a clean checkout.
