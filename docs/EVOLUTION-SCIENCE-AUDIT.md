> **状态：审计记录。** 进化环 driver 已落地（`npm run research:evolve`，#79）；本文的因果性纪律仍适用。

# Self-evolution / AI-for-science / geology quality audit

Date: 2026-08-30
Repository baseline: `4e61343 fix: harden isolation lifecycle and evaluation`

## Scope

The audit covered the complete path from model routing and prompt construction
through the RSI proposal/critique/selection loop, episodic memory and RAG,
quantitative geology tasks, GIS/agent benchmarks, public/private/held-out
metrics, artifact graders, resume state, and competition operation. No paid
model calls or credentials were used. The three attempted external review lanes
were unavailable because the shared OpenAI service returned HTTP 503
`account_share_recovering`; the findings below are therefore parent-side static
and local-data analysis, not a claim that those reviews completed.

## Confirmed defects and fixes in this round

### P0 — fixed-denominator learning could accept an all-failed candidate

`src/metrics.ts:8-17` intentionally returns zero for an all-null fixed
denominator. `src/rsi_eval.ts` previously used that zero directly as a valid
scaffold mean. If every episode failed before producing a fitness, a fresh run
could record `bestFitness=0`, and a candidate could satisfy the `mean != null`
check in `src/rsi.ts`.

Fix: `src/rsi_eval.ts:137` now requires at least one non-null fitness before a
scaffold evaluation is eligible; partial failure still uses the fixed weighted
denominator, while all-failed evaluation is `null` and cannot become a
champion.

### P0 — GIS artifact checks accepted arbitrary host paths

The generated `gab` and `gabench` graders accepted any existing path in
`output_files`, including absolute paths and traversal paths. This could award
artifact credit for a file outside the episode workspace and was especially
unsafe in `host-audit` mode.

Fix: `scripts/gab_build.py:125-139`, `scripts/gabench_build.py:72-86`, and all
existing generated `problems/gab_*/eval.py` and `problems/gabench_*/eval.py` now
require a relative path whose realpath remains under the episode workspace and
whose target is a regular file above the minimum size.

### P0 — new hidden reference files were not detected

The old manifest hashed files that existed at creation but did not detect a new
file added under an existing `reference/` directory. That is a grading-integrity
hole in explicit host-audit mode.

Fix: `src/guard.ts:167-213` records both each protected file hash and a stable
reference-directory listing fingerprint, including an explicit `<missing>`
state. New, removed, or renamed reference files now invalidate the episode.

## P1 — fixed in this round

- **Insufficient public scientific prior.** The seed scaffold contained only
  generic instructions. `src/scaffold.ts:16-82` now supplies immutable,
  genre-routed public playbooks for seismology, hydrology, climatology,
  petrophysics, GIS, quizzes, and general science. They contain methods, units,
  diagnostics, and calibration rules, never benchmark answers.
- **Scoped metadata lost on replacement.** `src/scaffold.ts:153-158` now
  preserves `{genres}` when replacing an existing scoped tip.
- **Evolution prompt bloat and poisoning.** Scaffold prompts/tips/domain notes
  are bounded at `src/scaffold.ts:14-17, 169-177, 190-207`; evolved material is
  labeled as a hypothesis and appears after the immutable playbook.
- **Duplicate/no-op proposals wasted evaluations.** `src/rsi.ts:253-285` now
  fingerprints child scaffolds and rejects duplicate or no-op children before
  critique/evaluation.
- **Public-score ties discarded the newest candidate.**
  `src/inner/solve.ts:1019` now retains the newest answer on a tied public score,
  which matters for quantized quiz scores where a later answer can generalize
  better to private data.
- **Advisory gateway failures could abort otherwise valid long runs.**
  `src/goal.ts` and `src/outer/critique.ts` now degrade to deterministic
  criteria/zero critic votes; actual episode/evaluator errors remain visible and
  cannot become a valid score.
- **One broken problem aborted a whole suite.** `src/rsi_eval.ts:82-126` and
  `src/exam.ts:104-145, 245-279` convert per-problem execution exceptions into
  explicit null-fitness records, retaining the fixed denominator and allowing
  the rest of a campaign to finish diagnostically.
- **Evaluation process inherited ambient provider credentials.**
  `src/bench/eval.ts:205-221` starts from `sanitizeSandboxEnvironment` and adds
  back only the private truth or judge capability required by that evaluator.
  Agent processes still never receive those values.
- **Out-of-range evaluator scores were accepted.** `src/bench/eval.ts:247-255`
  now requires `0 <= ##SCORE## <= 1`.
- **Memory and RAG tie ordering was filesystem-dependent.**
  `src/memory.ts:101-113` and `src/retrieval.ts:79` now use stable tie-breakers;
  `src/retrieval.ts:93-99` exposes a corpus fingerprint for run evidence.
- **Durable episode evidence lacked public trajectory and retrieval identity.**
  `src/inner/solve.ts:148-157, 1307-1328` records public score history,
  knowledge version, retrieved document IDs, corpus version, and quiz coverage.

## P1/P2 capability additions

- `src/task-profile.ts` centralizes task taxonomy, private-truth/judge semantics,
  and preferred model role for evaluation and routing.
- `src/process-env.ts` separates credential/proxy sanitization from the Windows
  Sandboxie adapter; `src/budget.ts` separates token accounting from model
  transport; `applyProblemRuntimeOverride()` removes unchecked Config casts.
- `scripts/make_curriculum.py` creates a deterministic stratified train/held-out
  config using only public task metadata. It avoids training on explicit held-out
  IDs and records the seed/selection parameters in the generated config.
- `config/geology-competition.json` is a ready-to-review core geology profile:
  four quantitative training tasks, `poro_perm` held out, RAG enabled, strict
  Sandboxie, multi-proposal evolution, and longer task budgets.
- `docs/COMPETITION-RUNBOOK.md` documents model routing, curriculum construction,
  scientific workflows, honest score optimization, evidence handling, and
  residual limitations.

## Proxy-metric limitations (not silently fixed)

- `geona` primarily scores ordered API names/actions and response keywords;
  `scripts/geona_build.py:150-176` does not prove that a real API execution
  succeeded.
- `gab` and `gabench` combine numeric/artifact checks or LLM judging; a correct
  textual summary or non-degenerate file is not proof of scientifically valid
  GIS output.
- `gbx` uses a tool-chain judge and can reward a correct reported chain even
  when the local execution artifact is limited.
- LLM-as-judge results are deterministic only relative to the cache/model/prompt;
  they are not human-calibrated truth.
- A single model episode per task is not a stable ranking. The prior emooo
  geology result remains a pilot and `poro_perm` showed a large train/held-out
  gap.

## Deferred security/OS risks

- Sandboxie is an app-level boundary, not a VM or kernel isolation boundary.
- Same-user Windows pathname TOCTOU races are reduced by canonical/reparse
  checks and background file-tool exclusion but are not eliminated without
  handle-relative native I/O.
- Power loss, kernel failure, or externally forced termination can leave stale
  Sandboxie/WFP state; the next strict run fails closed and requires inspection.
- No paid multi-seed campaign was run in this quality pass.

## Validation status

The changed implementation has passed the complete validation gates for this
round:

- `npm run check`: passed, including typecheck, selftests, TUI/control tests,
  structure checks, verdict checks, and Python compilation.
- Sequential default and external-GIS `npm run sandboxie:selftest`: both
  `SANDBOXIE_OK`; concurrent invocation was intentionally refused by the WFP
  lease, and the final state was restored to `DefaultBox` only with no lease.
- Curriculum generation and `config/geology-competition.json` parse checks:
  passed.
- Generated `gab`/`gabench` grader compilation: passed.
- `npm audit --omit=dev --registry=https://registry.npmjs.org`: 0 vulnerabilities.
- Diff and tracked-tree secret scans: passed; no provider config was added.

No paid model call, credential read, commit, or push was performed in this
optimization round.