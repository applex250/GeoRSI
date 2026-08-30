# GeoRSI long-horizon research competition mode

## Scope

The research runtime adds a typed scientific mission, a dependency-checked
WorkGraph, tool receipts, a hash-chained event ledger, content-addressed
evidence, deterministic verifiers, verify/compute replay, evidence-grounded
claims, an eight-slide presentation, and a 12-question defense package.

It targets quantitative geology, GIS/remote sensing, and literature/hypothesis
work. Laboratory equipment and wet/dry experiment control are intentionally
outside this MVP.

## Model policy

New live campaigns are Luna-only:

```text
provider = ai-pixel
model = gpt-5.6-luna
thinking = xhigh
fallback models = none
```

The ai-pixel credential is environment-only:

```powershell
$env:AI_PIXEL_API_KEY="<rotated-key>"
```

A key shown in a transcript, terminal argument, screenshot, or log is exposed
and must be revoked. GeoRSI has no ai-pixel key-file fallback.

Before a live campaign:

```bash
python scripts/ai_pixel_probe.py --mode all
```

The machine-readable model profile stays `unverified-ai-pixel` until Responses,
xhigh, streaming/tool-loop, usage, PiHarness, and Sandboxie probes pass.

The fixed task/weight/repetition protocol is declared in
`config/research-benchmark-manifest.json` and mirrored by the typed
`RESEARCH_BENCHMARK_MANIFEST` contract. Stage-A contains exactly five public
representative tasks; Stage-B supplies explicit family coverage; `poro_perm` is
reserved for held-out. Development runs use the unfrozen manifest. Before any
held-out run, freeze the manifest and record its fingerprint; the held-out
runner must reject an unfrozen or changed manifest. The two repetitions are
paired by repetition key, and a candidate can only be promoted under the
quality-first `0.01` score-band/token policy.

## Luna node executor

`src/research/luna-node-executor.ts` is the production WorkGraph adapter. It
creates one bounded Pi session per node and fails closed unless the runtime is
exactly `ai-pixel/gpt-5.6-luna` via Responses with requested/effective `xhigh`.
It disables Pi built-in and exchange file tools; the model sees only explicit,
TypeBox-bound `ScientificToolRegistry` adapters plus bounded artifact/submission
capture tools. Context is node/dependency scoped and fingerprinted. Per-role
output caps are applied to the session model, exact assistant/API calls in tool
loops are receipted, and the scheduler enforces their combined usage.

Model-declared artifact IDs are not trusted. Accepted artifacts must be created
in the content-addressed evidence store or returned by a registered scientific
tool with verifiable CAS metadata. Quantitative, GIS, and literature verifier
inputs are persisted before deterministic verification, and family
attestations bind the sanitized input hash to canonical evidence hashes.

`src/research/sandboxie-compute.ts` defines the fail-closed compute port used by
Python/GIS tools. A valid receipt must prove the Sandboxie backend, PID
ownership, expected network mode, zero exit, complete ordered cleanup, WFP
restoration, and lease release. There is no host fallback. The deterministic
selftest uses an injected fake port; it is not competition evidence.

## Network claim

`network_mode=blocked` remains the safe/default historical behavior.
`config/research-competition-luna.json` explicitly selects `open`: boxed Python
can reach the Internet, while repository, private truth, grader, and credential
paths remain closed. Open-mode evidence records `networkIsolationClaim=false`;
it must never be presented as network isolation. Open runs additionally deny
`.netrc`/`_netrc`, `.config`, gcloud/GitHub CLI, and common Chrome/Edge/Firefox
profiles. This enumeration is defense in depth, not a complete same-user
confidentiality boundary: an unlisted host file can remain readable. Claims
requiring stronger host confidentiality need a dedicated low-privilege Windows
identity or VM; Sandboxie remains app-level isolation.

## Free end-to-end demonstration

```bash
npm run research:selftest
npm run research:demo -- --run-name research-demo-001
python scripts/research_verdict.py research-demo-001
```

The deterministic demo makes no model call. It exercises all 14 capstone
stages, computes a small Aki b-value fixture and sensitivity table, emits a GIS
evidence artifact, and builds a complete research package. It is explicitly
`runMode=deterministic-demo`, uses a compute-replay test double, and is therefore
**not competition-eligible**; its purpose is to validate package mechanics.
Only a receipt-backed Luna xhigh run with verified Sandboxie cleanup and
Sandboxie compute replay can become competition-eligible.

## Research package

```text
mission.json
plan.json
events.jsonl
claims.json
evidence-index.json
environment.json
runtime-attestation.json
research-manifest.json
replay.json
research-score.json
package-seal.json
report.md
presentation.md
defense.json
```

Raw/untrusted scripts, downloads, and tool output live outside the repository
in a content-addressed store under `%TEMP%/GeoRSI/evidence/<run>/`. Trusted run
artifacts contain hashes and sanitized references.

## Three-layer score

Runtime is a non-compensable gate:

- unit/contract tests;
- complete trace and valid manifest;
- verify-only replay;
- compute replay;
- zero guard violations;
- verified cleanup;
- at least one valid result.

Eligible packages then score:

```text
task outcome             30%
method validity          20%
claim/evidence quality   15%
reproducibility          15%
scientific value         10%
report/presentation/Q&A  10%
```

Efficiency is quality-first. Strategy selection maximizes validity and score;
only candidates within 0.01 of the best score compete on tokens. Held-out tasks
are run after a StrategyBundle freezes and are not reused for iterative tuning.

## Strategy evolution

The evolved object is a bounded `StrategyBundle`, not source code. One
challenger changes exactly one component: scaffold, planner, recipe, verifier,
context, recovery, budget, or communication. Promotion requires at least two
paired repetitions on one manifest, Luna xhigh-only receipts, full replay and
cleanup, no valid-rate regression, score gain above 0.01, and no worst-family
regression beyond 0.05. Failed candidates remain probationary.

## Same-model judge limitation

When a benchmark cannot avoid an LLM judge, both candidate and judge use Luna
xhigh because no other model is funded. Such scores must be marked
`same-model-llm-judge-proxy` and `judgeIndependent=false`; they are not
independent scientific validation. Deterministic numeric, schema, artifact,
CRS, citation, and replay checks remain primary evidence.
