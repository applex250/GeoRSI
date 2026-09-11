# GeoRSI competition and long-horizon science runbook

> **Scope（2026-09-11）**：本文覆盖 **agent 进化轨**（`npm run rsi` / TUI / 课程
> 曲线）的运行规程。**科研流水线轨（主轨）** 的系统规范与操作（`research:live`
> / `research:evolve` / `research:benchmark` / `research:gateway` / verdict）见
> `docs/RESEARCH-COMPETITION.md` 与 README 的 quickstart。两轨共用模型网关层
> （`research_gateways` + `research_model.gateway`）与诚实性基础设施。

This document describes the highest-scoring **honest** operating mode currently
supported by the repository. It is a runbook, not a promise of a leaderboard
rank: model quality, gateway stability, task distribution, and judge variance
remain empirical.

## 1. What the system optimizes

GeoRSI evolves a bounded scaffold rather than source code:

1. A public authored scientific playbook and the current scaffold are injected
   into an inner research agent.
2. The agent audits data, calibrates on the visible reference data, computes a
   candidate, and submits it for public feedback.
3. A fixed public/private protocol evaluates the resulting artifact. The inner
   agent sees only the public score; the outer selector receives private fitness
   after the Sandboxie box is gone.
4. The outer model proposes small hypotheses, a critique panel prunes them, and
   survivors are evaluated on a fixed training suite.
5. A challenger must beat the current champion on a fresh verification pass;
   accepted changes are retained as a new scaffold. The held-out exam is run
   only at the end with empty episodic memory.

A high training score without held-out transfer is overfitting, not successful
self-improvement. A `CHAMPION` verdict means the artifact gates passed; it does
not establish scientific causality for a particular tip or knowledge node.

## 2. Recommended model routing

**当前（2026-09-11）**：科研流水线轨为 Luna-only——唯一模型
`gpt-5.6-luna` @ alsl 网关（`research_model.gateway=alsl`），全部角色
（planner/节点执行/verifier 输入/报告/答辩）同模型；切换网关用
`npm run research:gateway`。历史多模型路由（下表）仅适用于 agent 进化轨的
旧配置，新 campaign 不得混用非 Luna 模型：

| role（agent 轨历史） | route | reason |
|---|---|---|
| outer goal/proposal/critique | `hy3`, low/medium | fast structured hypothesis generation |
| quantitative geology inner | `mimo-v2.5`, low/medium | verified long-context/tool-loop behavior |
| quiz batches | `z-ai/glm-5.3-flash`, low or max | measured as a strong quiz candidate |
| retired | `dsv4f` deep reasoning | harness fail-closed on unserializable `thinking_budget` — intentional |

完整模型档案（含 alsl/geili 网关事实与历史实测）见 `docs/MODELS.md`。
Run a fresh cheap probe before changing a route: `python scripts/research_probe.py`.

## 3. Build a stratified curriculum

Do not evolve on a single easy task. Create a fixed, reproducible mixture of
public task families and reserve unseen tasks as held-out:

```bash
python scripts/make_curriculum.py \
  --config config/geona.problems.json \
  --output config/geona-curriculum.json \
  --train-per-genre 8 \
  --heldout-per-genre 2 \
  --seed 20260830 \
  --generations 4
```

The tool uses only task IDs and public `problem.json` metadata. It never reads
`rsi-lab-private`, `answers.private.jsonl`, `reference/`, or an evaluator's
private truth. The resulting config is the run contract; do not edit it after a
run begins. `run-manifest.json` records the selected IDs, weights, config,
model-profile fingerprint, knowledge version, and RAG corpus version.

For a mixed campaign, build one curriculum per family and run them serially or
use a manually reviewed merged JSON. Do not run parallel strict Sandboxie
campaigns unless the global-WFP lease and per-lane knowledge/judge caches are
configured as documented; a stale lease deliberately blocks the next run.

## 4. Recommended long-horizon parameters

Start with a small rotation before an overnight run:

```json
{
  "generations": 4,
  "proposals": 3,
  "critics": 2,
  "survivors": 1,
  "max_turns": 16,
  "episode_timeout_s": 1800,
  "eval_cap": 4,
  "patience": 2,
  "stagnation_limit": 3,
  "episodes_per_problem": 1,
  "rag_enabled": true,
  "execution_backend": "sandboxie"
}
```

Increase `episodes_per_problem` to 2 only after a single-episode baseline is
healthy. It reduces selection noise but approximately doubles inner execution
cost. Increase `survivors` only when the suite is large enough to support the
extra evaluation budget. More generations do not compensate for a bad task
split or an untrusted grader.

The default prompt provides `georsi_science.py` in each exchange workspace.
It contains public, dependency-light implementations of Aki b-value, Gumbel
return level, OLS slope, and log-linear prediction. Agents must validate these
helpers on the visible reference data; they must not treat constants in a
statement as the answer to the main data.

## 5. Run protocol

Before any paid run:

```bash
npm run check
npm run sandboxie:selftest
python scripts/struct_selftest.py
npm audit --omit=dev --registry=https://registry.npmjs.org
```

Choose a fresh name. Never delete or overwrite a previous manifest to make a
run look cleaner:

```bash
npx tsx src/run.ts rsi \
  --config config/geona-curriculum.json \
  --run-name geona-curriculum-20260830
```

After completion:

```bash
python scripts/run_verdict.py geona-curriculum-20260830
npx tsx src/run.ts exam \
  --config config/geona-curriculum.json \
  --scaffold runs/geona-curriculum-20260830/champion_scaffold.json \
  --run-name geona-curriculum-20260830-exam
```

Treat `CRASHY`, `BROKEN`, missing held-out records, guard violations, or a
large train-to-held-out drop as a stop signal. Diagnose first; do not rerun
repeatedly until a favorable score appears. The verdict script counts missing
held-out tasks in the fixed weighted denominator.

## 6. Scientific task recipe

For quantitative geology, the scaffold should cause the agent to follow this
sequence:

1. Define the estimand, units, assumptions, and target output schema.
2. Audit file names, columns, row counts, missing values, duplicates, ranges,
   units, and whether the target lies inside the observed domain.
3. Run the method on the visible reference dataset and compare with the stated
   reference behavior. Keep full precision until final serialization.
4. Run the main analysis using a standard estimator appropriate to the data:
   Aki MLE with a tested completeness threshold; Gumbel/EV1 MLE or L-moments;
   OLS with autocorrelation-aware uncertainty; or log-space regression for
   permeability.
5. Perform a sensitivity check: nearby threshold/model choices, bootstrap or
   analytical uncertainty, residual diagnostics, or an independent formula.
6. Submit a complete artifact early, then spend remaining submissions only on
   a specific, evidence-backed correction.

For GIS tasks, additionally verify CRS and axis order, use a projected CRS for
metric operations, keep shapefile sidecars together, inspect geometry validity
and row counts, and check that every requested output file is non-degenerate.
The generated artifact graders are partly proxy metrics; an existing PNG or a
matching tool-chain string is not proof that a scientific map is correct.

## 7. Evidence and self-evolution discipline

- Candidate memory contains public-only observations and remains probationary.
- Cross-run knowledge is active only after explicit validation. `wins` is
  co-exposure telemetry, not a causal effect estimate.
- A champion tip should be tested with an A/B or held-out comparison before
  promotion. Keep task-family scope narrow; a measured gain on one quiz family
  must not be injected into every geology/GIS task.
- Compare configurations using the same fixed task manifest, weights, model
  profile, request cap, and metric version. For stochastic gateways, use at
  least two independent repetitions before claiming a stable improvement.
- Store `RESULTS.md`, `episode.json`, `exam-report.json`, `run-manifest.json`,
  and the verdict together. These records include cleanup and isolation
  evidence without copying private truth into the repository.

## 8. Score-improvement priorities

In order of expected return:

1. Fix task routing and first-pass completion failures; a missing submission is
   a zero regardless of reasoning quality.
2. Improve public-reference calibration and exact output formatting; this is
   usually cheaper than adding generations.
3. Use family-scoped playbooks and RAG, then verify on unseen tasks.
4. Tune `eval_cap`, `patience`, and request caps from measured per-task curves;
   never assume more submissions improve score.
5. Add a second episode/repetition for selection stability only after the first
   pass completes reliably.
6. Use a new model route only in a controlled A/B baseline; a single lucky run
   is not a ranking.

No private truth, grader reference, judge cache, credential path, network
endpoint, or host file path may be used as a score shortcut. Strict Sandboxie
must remain enabled for production claims; `host-audit` is for diagnostics and
is not a confidentiality boundary.

## 9. Residual limitations

The project does not yet provide a VM/kernel boundary, eliminate every same-user
Windows TOCTOU race, or turn every GIS/LLM-judge proxy into a human-calibrated
scientific evaluation. External process kills and power loss can leave stale
Sandboxie/WFP state; recovery is intentionally fail-closed. New multi-seed,
paid model-quality results must be reported as experiments, not as guaranteed
performance.
