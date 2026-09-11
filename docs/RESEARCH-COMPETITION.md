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

New live campaigns are Luna-only and derive every model fact from one config
block. The `research_gateways` registry carries the endpoint/protocol facts and
ALL resilience parameters (probe attempts/backoff, session retries);
`research_model.gateway` is the single switch field:

```jsonc
"research_model": { "gateway": "alsl", "model": "gpt-5.6-luna", "thinking_level": "high", ... },
"research_gateways": {
  "alsl":  { "provider": "alsl", "base_url": "https://ai.alsl.xyz/v1", "api": "openai-responses",
             "max_tokens_field": "max_completion_tokens", "credential_env": "GEORSI_RESEARCH_API_KEY",
             "fallback": "none", "thinking_evidence": "provider-observed",
             "resilience": { "probe_attempts": 10, "session_retries": 10, ... } },
  "geili": { "provider": "geiliapi", "base_url": "https://sub.geiliapi.com/v1", "api": "openai-completions",
             "thinking_evidence": "requested-only", ... }
}
```

Switch atomically (validate-then-write, prints the canonical policy
fingerprint):

```bash
npm run research:gateway -- --list
npm run research:gateway -- alsl
```

The credential is environment-only (per-gateway `credential_env` names the
slot, currently `GEORSI_RESEARCH_API_KEY`):

```powershell
$env:GEORSI_RESEARCH_API_KEY="<rotated-key>"
```

`thinking_evidence: provider-observed` gateways show reasoning echoes in
receipts (independently checkable); `requested-only` routes are honestly
recorded as not competition-grade. The active alsl policy fingerprint is
`eccdf947cc216870b293280a`.

A key shown in a transcript, terminal argument, screenshot, or log is exposed
and must be revoked. GeoRSI has no key-file fallback. Switching the research
model or gateway means editing `research_model`; executor, attestation,
judge, benchmark, and verdict code must stay provider-neutral.

Before a live campaign:

```bash
python scripts/research_probe.py
```

The alsl route is production-verified end-to-end (catalog, tool loop, usage,
provider-observed xhigh thinking, PiHarness): see
`runs/luna-smoke-021c-host` (7/7 nodes, clean verdict, scienceScore 0.975).
Competition packages persist the `modelPolicy` and its canonical fingerprint;
the independent verdict re-validates receipts against that policy.

The fixed task/weight/repetition protocol is declared in
`config/research-benchmark-manifest.json` and mirrored by the typed
`RESEARCH_BENCHMARK_MANIFEST` contract. Stage-A contains exactly five public
representative tasks; Stage-B supplies explicit family coverage; `poro_perm` is
reserved for held-out. Development runs use the unfrozen manifest. Before any
held-out run, freeze the manifest and record its fingerprint; the held-out
runner must reject an unfrozen or changed manifest. The two repetitions are
paired by repetition key, and a candidate can only be promoted under the
quality-first `0.01` score-band/token policy.

## Research node executor

`src/research/research-node-executor.ts` is the production WorkGraph adapter. It
creates one bounded Pi session per node and fails closed unless the runtime
matches the `research_model` policy exactly (`provider/model/api`,
gateway-resolved — currently the `alsl` gateway:
`alsl/gpt-5.6-luna/openai-responses`) with requested/effective thinking.
It disables Pi built-in and exchange file tools; the model sees only explicit,
TypeBox-bound `ScientificToolRegistry` adapters plus bounded artifact/submission
capture tools. Context is node/dependency scoped and fingerprinted. Per-role
output caps are applied to the session model, exact assistant/API calls in tool
loops are receipted, and the scheduler enforces their combined usage.

## Context memory

Node context is split into a pushed static map and a pulled dynamic memory:

every node's initial `ContextPack` carries a mandatory `graph` block listing
the full work graph (id/kind/dependencies) with `YOU ARE HERE` and downstream
markers. Dynamic state and upstream content are pulled through the read-only
`context-recall` tool (`src/research/context-memory.ts`): `{list:true}` returns
work-graph progress plus a catalog of committed node memory (submission
summaries, decisions, verification profiles, artifacts with evidence ids);
structured filters address `node`/`field`; deterministic lexical search ranks
blocks (ascii words + CJK bigrams); and `{evidenceId}` fetches verified full
content from the CAS store. Memory is written exclusively by the executor when
a node submission is committed — the model cannot write memory — and the tool
is capability-gated under `context-memory`, available in every research family.
LLM-generated compaction is deliberately not used for memory: pi's compaction
has no content mapping and would bypass receipted model calls.

Model-declared artifact IDs are not trusted. Accepted artifacts must be created
in the content-addressed evidence store or returned by a registered scientific
tool with verifiable CAS metadata. Quantitative, GIS, and literature verifier
inputs are persisted before deterministic verification, and family
attestations bind the sanitized input hash to canonical evidence hashes.

`src/research/sandboxie-compute.ts` defines the fail-closed compute port used
by Python/GIS tools with two backends:

- **`sandboxie`**: a valid receipt must prove the Sandboxie backend, PID
  ownership, expected network mode, zero exit, complete ordered cleanup, WFP
  restoration, and lease release. There is no host fallback.
- **`host-audit`（默认）**: direct host execution behind the same path fence and
  policy scan; receipts honestly record `networkIsolationEnforced=false` and
  the package is never competition-eligible. The deterministic selftest uses
  an injected fake port; it is not competition evidence.

Compute replay re-runs recorded scripts deterministically and compares
exit/stdout/stderr/result (figure bytes are excluded). The request map is
checkpointed to `compute_requests.json` so replay after a `--resume` can
re-run scripts recorded by earlier process sessions; failed attempts (the
model's self-correction loop) stay in the ledger as history but are excluded
from the replay set — package integrity is defined by the successful computes.

### Draft normalization and deliverable provenance

`src/research/draft-normalizer.ts` applies deterministic coercions (rename,
unwrap, renumber, re-derive) to model drafts BEFORE validation: purely formal
mismatches (field names, slide markers, container shapes) are repaired by code
with per-item coercion provenance in the ledger; coercion may never fabricate
questions, answers, or evidence ids. Rejection is reserved for substantive
failures. Packaged deliverables prefer the communication nodes' own artifacts
when they pass the same gates; the `deliverable-sources` ledger event records
`node|template` provenance per deliverable.

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

## Live competition entry point

After rotating the credential and exporting it only in the process environment,
run:

```bash
npm run research:live --silent -- --config config/research-competition-luna.json \
  --mission path/to/mission.json [--plan path/to/plan.json] \
  [--resume runs/<previous-run>] --run-name luna-run-001
```

Diagnostics (optional): `RSILAB_PROMPT_DIAG=1` writes per-node session JSONL
to `RSILAB_PROMPT_DIAG_DIR` (auto-pruned after 7 days unless
`RSILAB_PROMPT_DIAG_KEEP=1`).

The command first runs the deterministic `npm run check` preflight, then
resolves and authenticates the Luna provider. If the build, key, model identity,
thinking setting, backend, network mode, mission, or plan is invalid, it
exits before scheduling a research node. `--plan` is optional; without it the
graph is instantiated from the **family GraphSpec template**
(`familyGraphSpec(family, requiredStages)`): a mission's embedded
`requiredStages` pin the chain (the quant-smoke mission pins the 7 core
stages), otherwise the full family chain applies (quantitative includes
`data-audit`; literature includes `literature-search`). Communication stages
carry `budgetScale 2` (wall is a cap, not a target). `--resume <runDir>`
restores the persisted plan/executor state/compute receipts and re-registers
recorded compute requests for cross-session replay. A non-eligible or failed
package returns a nonzero exit code and must be inspected with
`scripts/research_verdict.py`.

### Evolution and benchmark tooling

```bash
npm run research:evolve -- --candidates 2 --run-prefix evo-001
# baseline + graph-mutation candidates (add/remove/merge/split) as full runs on
# the same seed; fitness = scienceScore/validRate; promotion via paired
# repetitions (host-development policy allows medium/high/xhigh; competition
# stays xhigh-only)

npm run research:benchmark -- --runs-root runs/bench-001
# aggregates <taskId>__rep<k> run dirs into benchmark-report.json; missing
# repetitions and ineligible runs count as ZERO and are listed — never skipped
```

The task-level data contracts (fixed seed/params per Stage-A task) live in
`config/research-benchmark-manifest.json`; competition missions must declare a
matching `mission.dataset` with a binding seed (TS gate + verdict
fingerprint cross-check).

## Free end-to-end demonstration

```bash
npm run research:demo
python scripts/research_verdict.py <demo-run-name>
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
