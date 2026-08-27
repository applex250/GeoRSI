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
