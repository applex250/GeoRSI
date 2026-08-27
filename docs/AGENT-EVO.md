# Agent Evolution Status

## Historical Run

`runs/agent-evo4-iter1` contains a three-generation Agent-track run over six
training tasks (`geona_01`, `geona_02`, `gbx_001`, `gbx_005`, `gabench_54`,
`gab_03`) and two held-out tasks (`geona_09`, `gbx_006`). The run reached a
held-out mean of `0.8500` for the accepted generation-1 champion, but its
automated verdict was `CRASHY/ESCALATE` because two later evaluations were not
clean:

- `geona_01`: one candidate episode ran for 944 seconds without a submission
  (`no submission produced`). Other baseline and verification episodes for the
  same task did submit successfully.
- `gabench_54`: the candidate had `public=1.0`, but the private LLM judge ended
  with an empty visible response after retries.

The historical champion and held-out score remain useful evidence, but the run
is not treated as a clean three-generation success.

## Fixes and Targeted Rechecks

1. The inner loop now gives open analysis tasks an explicit first-pass contract:
   produce a valid best-effort artifact and call `submit` in the first turn.
2. The shared judge now sends `reasoning_effort=low` by default for reasoning
   models. This prevents the judge from consuming its visible output budget on
   hidden reasoning and returning an empty verdict. The setting is overrideable
   with `RSILAB_JUDGE_REASONING_EFFORT`.
3. Re-running `geona_01` with the first-pass contract produced:
   `fitness=0.6000`, `bestPublic=0.6000`, `submits=2`, `turns=1`, 244 seconds.
4. Re-evaluating the existing `gabench_54` public=1 submission with the fixed
   judge produced `0.8000` using `hy3` at low effort and `0.9000` using
   `z-ai/glm-5.3-flash` at low effort. Both runs had `artifacts=1/1`.

These are targeted rechecks, not a replacement for a fresh three-generation
evolution run. The next full run should use the fixed judge, the first-pass
contract, isolated lane caches, and the existing crash/verdict checks.

## Current Boundary

The system now has evidence that Agent tasks can improve from a baseline and
that the two observed failure mechanisms are diagnosable. It does not yet have
a clean, repeated multi-seed Agent evolution result proving that the gain is
durable across the full task pool.

## Full-Pool Curriculum (大课表, planned 2026-08-27)

The Agent pool is 236 open tasks: `geona_01–93`, `gabench_01–57`, `gab_01–50`,
`gbx_001–036`. A full evolution pass over every task per generation is not
feasible in one sitting (mean episode ≈ 400 s in `agent-evo4-iter1`; 236 tasks
× 2 suite passes × 3 generations ≈ 200+ h serial), so the curriculum proceeds
in three waves with a gate between each. All waves run serially (gateway
first-turn latency is unstable under concurrency), with per-wave isolated
`RSILAB_KB_PATH` and `RSILAB_JUDGE_CACHE`, judge `hy3` at low reasoning
effort, and the open-task first-pass contract already active in `solve.ts`.

### Wave 1 — curriculum core (evolution, ~112 episodes ≈ 12 h overnight)

- 16 train tasks (4 per family) + 4 held-out tasks (1 per family), all fresh
  IDs never used as train or held-out in `agent-evo4-iter1`
  (which consumed `geona_01/02/09`, `gbx_001/005/006`, `gabench_54`, `gab_03`):
  - geona train `03/17/31/45`, held-out `geona_59`
  - gabench train `05/19/33/47`, held-out `gabench_51`
  - gab train `07/19/31/43`, held-out `gab_49`
  - gbx train `003/011/019/027`, held-out `gbx_033`
- `generations=3`, `proposals=3`, `survivors=1`, inner `mimo-v2.5`,
  outer `hy3` — same shape as `agent-evo4-iter1`
- Config: `config/agent-evo5-wave1.json` (checked in with this plan)

### Wave 2 — transfer exam (no evolution, ~28 episodes ≈ 3 h)

- The Wave-1 champion scaffold runs exam-only over a fresh stratified slice of
  24 tasks (6 per family, again excluding all previously used IDs).
- Purpose: does the evolved scaffold transfer to unseen tasks at all, without
  the evolution loop's selection pressure inflating the number?

### Wave 3 — full-pool rollout (~236 episodes ≈ 26 h, batched by family)

- The final champion runs exam-only over all 236 tasks in four family batches
  (`geona`, `gabench`, `gab`, `gbx`), spread across nights; each batch emits
  its own RESULTS.md.
- Purpose: the first per-family capability table for the whole Agent pool,
  which becomes the baseline for every later intervention (RAG, model swaps).

### Gates (between waves, enforced by `scripts/run_verdict.py`)

1. Wave 1 must end CLEAN (no `CRASHY/ESCALATE`): every episode submits, judge
   returns a parseable verdict, champion change requires a verified win.
2. Held-out mean must not fall more than 0.05 below the previous champion's
   held-out mean at any accepted champion change.
3. Wave 2 transfer mean must be ≥ the Wave-1 baseline-suite mean − 0.05; a
   larger drop means the champion overfit its train slice and Wave 3 is
   postponed in favor of a second Wave-1-style rotation.
4. Any wave hitting >2 no-submission episodes pauses the campaign until the
   first-pass contract failure mode is analyzed (episode logs go to
   `runs/<wave>/diag/`).
