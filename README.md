# GeoRSI Lab

Self-evolving geoscience research system on the **pi agent harness**
(`@earendil-works/pi-coding-agent`). GeoRSI has two tracks:

1. **Research pipeline（科研流水线，主轨）** — a typed scientific mission is
   executed as a dependency-checked WorkGraph: one bounded model session per
   node, content-addressed evidence, deterministic family verifiers, an
   event ledger, compute replay, and a three-layer scored package
   (`report.md` + `presentation.md` + `defense.json`). Every claim is bound
   to hashed evidence; every gate is auditable.
2. **Agent evolution track（进化轨）** — the classic outer loop that rewrites
   an inner agent's scaffold on a problem suite (`npm run rsi`, the `/research`
   chat extension, the TUI dashboard).

The research pipeline is driven three ways — the CLI (`npm run research:*`), the
**web workspace** (`web/` + `npm run api`, natural-language questions) and the
local HTTP API. All three hit the same engine, the same verifiers and the same
sealed package.

> **Status 2026-09-15** — the research pipeline runs end-to-end on real models:
> `runs/luna-smoke-021c-host` = 7/7 nodes, `RESEARCH_VERDICT_OK issues: []`,
> scienceScore **0.975**, all three deliverables node-authored. Execution
> backend defaults to **`host-audit`** (direct host execution, honestly recorded
> as `runMode=host-development` and **never competition-eligible**); the
> Sandboxie strict backend is fully implemented and re-enabled explicitly with
> `"execution_backend": "sandboxie"` (hardening iteration deferred, see
> `docs/HANDOFF.md`).
>
> **Newest round (2026-09-15):** the interactive workspace now runs on the same
> engine (tiers, rounds, review, directions), node budgets are planned up front
> and tightened live, and a store-only experience library is harvested from every
> sealed pack. A real run closed its literature node in 2 tool calls (~5 min) and
> produced a 5,143-character seven-section report. The workspace tier still has
> **no real-machine smoke record** — selftests only, as its own doc states.

## Research pipeline quickstart

```bash
npm install --ignore-scripts
npm run check                        # full free regression gate

# 1. free deterministic demo (no model calls, full 14-stage capstone package)
npm run research:demo
python scripts/research_verdict.py <run-name>

# 2. real research run (Luna xhigh via the configured gateway)
export GEORSI_RESEARCH_API_KEY=<key>          # environment only, never files
npm run research:live --silent -- \
  --config config/research-competition-luna.json \
  --mission config/research-mission-quant-smoke.json \
  --run-name luna-run-001
python scripts/research_verdict.py luna-run-001

# interrupted? resume from the checkpoint (plan/executor/compute receipts)
npm run research:live --silent -- --resume runs/luna-run-001

# 3. evolution loop: graph mutations as full mission runs, promotion on fitness
npm run research:evolve -- --candidates 2 --run-prefix evo-001

# 4. three-layer benchmark aggregation over <taskId>__rep<k> run dirs
npm run research:benchmark -- --runs-root runs/bench-001

# 5. gateway switching (atomic, validated, prints the policy fingerprint)
npm run research:gateway -- --list
npm run research:gateway -- alsl

# 6. experience store (store-only flywheel): backfill from every sealed package
npm run research:experience -- --all
```

## Web workspace tier

`web/` is a Next.js frontend; `npm run api` serves it on `127.0.0.1:8787` and the
frontend proxies `/api/research/*` through the same origin. A natural-language
question plus optional uploads becomes a **development-tier** run on the research
engine — same node executor, family verifiers, scheduler, ledger, CAS and
orchestrator as the competition path, with the interactive outer loop on top:

```bash
npm run api                     # API on 127.0.0.1:8787 (GEORSI_API_HOST / GEORSI_API_PORT)
cd web && npm run dev           # frontend on http://localhost:3000
```

1. the question is classified into a family and a **tier** — `simple` / `medium` /
   `complex`, each a subset of the family template so the graph always validates
   (`tieredStages`); `DEV_NODE_BUDGET` gives every node 20 min / 24 model calls /
   32 tool calls / 60k output tokens / 2 attempts, report ×2;
2. rounds (default 3, `GEORSI_WORKSPACE_ROUNDS`) run the scheduler and then a
   review critique; an incomplete round appends `r{N+1}-` nodes with the review's
   `next` as that round's focus;
3. mid-run feedback becomes a **direction** consumed by the next node; stop lands
   within ~1 s;
4. the run is sealed by the same orchestrator — report-only, `eligible=false`, no
   preflight (`unitTestsPassed=false`), citations rewritten into evidence links
   before the manifest hash is taken;
5. the pack is harvested into the experience library — **store only**, nothing
   routes on it yet.

**Three-layer budget.** `planNodeBudget(kind)` fixes an envelope per node at
planning time (the guaranteed floor); the run ledger tracks actual usage against
what is left; `modulateNodeBudget` shrinks downstream nodes only after a >1.25
overrun — shrink-only, floor 50 %, synthesis/report/presentation/defense exempt.
The model sees the numbers, but only code enforces them. Surface:
`GET /research-runs/:id/budget`, a global budget bar, per-node four-dimension bars
and graph badges.

**Per-node activity.** Thinking/text stream, tool calls, token usage and **cache
hit rate** (`cached/(cached+input)`, null when the gateway reports no caching)
fold into `GET /research-runs/:id/nodes/:nodeId/activity`.

| variable | effect |
|---|---|
| `GEORSI_API_HOST` / `GEORSI_API_PORT` | bind address, default `127.0.0.1:8787`; a non-loopback host without a token warns loudly |
| `GEORSI_API_TOKEN` | shared token for every route except `/healthz`, `/readyz`, `/` |
| `GEORSI_WORKSPACE_ROUNDS` | review rounds, 1–5 (default 3) |
| `GEORSI_WORKSPACE_ENGINE=legacy` | fall back to the stage-2 self-contained agent (`GEORSI_WORKSPACE_MODEL_CALLS` applies only on that path) |
| `GEORSI_CROSSREF_MAILTO` | Crossref polite pool for literature search |
| `GEORSI_EXPERIENCE_ROOT` | redirect the experience store (selftests use a temp dir) |

Full contract: [`docs/API.md`](docs/API.md). Design and honesty notes:
[`docs/FRONTEND-STAGE-3.md`](docs/FRONTEND-STAGE-3.md).

A competition run directory contains the complete auditable package:
`mission.json plan.json events.jsonl claims.json evidence-index.json
environment.json runtime-attestation.json research-manifest.json replay.json
research-score.json package-seal.json report.md presentation.md defense.json`
(plus `compute_receipts.json` / `compute_requests.json` checkpoints that make
replay resumable across process sessions). Raw scripts and downloads live in a
content-addressed store under `%TEMP%/GeoRSI/evidence/<run>/`.

A workspace run is sealed the same way but is **report-only**: `report.md` without
`presentation.md` / `defense.json` (the deliverable gate judges the set the
mission requires), plus `workspace-state.json` (resume point),
`mission-synthesized.json` (how the question became a mission), `directions.jsonl`,
`control.json`, `report-round-N.md` and `experience.json`. `python
scripts/research_verdict.py <run-dir>` runs on it unchanged; the one expected
issue is `unit tests not attested`.

The system spec — WorkGraph, verifier families, honest eligibility gates, the
three-layer score, and promotion discipline — is
[`docs/RESEARCH-COMPETITION.md`](docs/RESEARCH-COMPETITION.md).

## Model & gateway configuration

One config block owns every model fact; code stays provider-neutral:

```jsonc
"research_model": {
  "gateway": "alsl",                    // single switch field → research_gateways
  "thinking_level": "high",             // competition policy pins xhigh
  ...
},
"research_gateways": {
  "alsl":   { "provider": "alsl",   "base_url": "https://ai.alsl.xyz/v1",
              "api": "openai-responses", "thinking_evidence": "provider-observed", ... },
  "geili":  { ... }
}
```

- `npm run research:gateway -- <name>` switches atomically (validate-then-write,
  prints the canonical policy fingerprint).
- `thinking_evidence: provider-observed` gateways show reasoning echoes in
  receipts; `requested-only` routes are honestly recorded as not
  competition-grade.
- Credentials are environment-only (`GEORSI_RESEARCH_API_KEY`; per-gateway
  `credential_env` entries name the slot). A key seen in a transcript,
  argument, or log is exposed and must be revoked. There is no key-file
  fallback.
- Probe before a campaign: `python scripts/research_probe.py`.

The human-view model registry (capabilities, history, retired routes) is
[`docs/MODELS.md`](docs/MODELS.md); the machine-readable profile lives in
`config/model-profiles.json`.

## Agent evolution track

> **Frozen (2026-09-14).** The classic loop is kept runnable from the CLI, the TUI
> and the `/research` chat extension, but receives no new features and is no
> longer creatable through the HTTP API (`mode: "rsi"` returns 400). The research
> pipeline's own evolution (`npm run research:evolve`, GraphSpec mutations) is the
> supported path forward.

From any folder, `F:\rsi-lab\agent.cmd` (or `agent.sh`) starts a normal pi chat
with the `/research` extension (`extensions/georsi.ts`):

    /research start      scaffold ./research/ templates for YOUR problem
    /research run        solve it with the lab's best strategy
    /research evolve 3   register + run 3 self-improvement generations
    /research model      show/switch inner/outer models
    /research status     snapshot: active run, submissions, recent events

While a run streams, the chat stays interactive; thinking blocks collapse to
clickable hyperlinks into `stream.log`; `/research pause|resume|stop|feedback`
control the engine. `npm run extcheck` re-runs the verified end-to-end flow.

Headless: `npx tsx src/run.ts smoke` (one episode), `npx tsx src/run.ts exam`
(full suite), `npx tsx src/run.ts rsi --gens 4` (evolution), `npm run tui`
(fullscreen dashboard), `npm run tui -- --replay runs/<name>` (zero-cost replay).
Private truths live outside the tree (`../rsi-lab-private/`); public feedback
drives the inner agent, private-only fitness drives selection.

## Execution backends

- **`host-audit`（默认）** — direct host execution with the full path fence,
  execution-policy scan, manifest, guard sweep, receipts, and replay. It is
  honestly recorded as non-eligible; development and scoring run here.
- **`sandboxie`** — Sandboxie-Plus app-level box: fresh box per episode,
  closed repository/private/credential paths, network blocked with WFP
  read-back, PID ownership proof, real probe, complete ordered cleanup. Any
  failure fails closed (never a host fallback). See `src/sandboxie.ts` and
  `npm run sandboxie:selftest`. GIS problems require an interpreter/venv
  outside the repository under this backend.

## Documentation map

| doc | status | content |
|---|---|---|
| [`docs/API.md`](docs/API.md) | **current** | frontend integration: HTTP endpoints, request/response contracts, SSE, auth (`GEORSI_API_TOKEN`, loopback default), mode limitations |
| [`docs/FRONTEND-STAGE-3.md`](docs/FRONTEND-STAGE-3.md) | **current** | workspace tier on the research engine (tiers, honesty, engine additions) + experience layer (store only) |
| [`docs/RESEARCH-COMPETITION.md`](docs/RESEARCH-COMPETITION.md) | **current** | research pipeline system spec: WorkGraph, verifiers, scoring, eligibility |
| [`docs/COMPETITION-RUNBOOK.md`](docs/COMPETITION-RUNBOOK.md) | **current** | operations: campaigns, benchmark protocol, model routing |
| [`docs/MODELS.md`](docs/MODELS.md) | **current** | model registry: gateway policy, capability history |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | **current** | stage-by-stage chronology (§0 holds the 8 dated 2026-09 entries, newest first) + onboarding steps |
| [`docs/ARCHITECTURE-VIEWS.md`](docs/ARCHITECTURE-VIEWS.md) | **current** | dependency rules; Mermaid views (`docs/georsi-*.mmd`) |
| [`docs/DESIGN.md`](docs/DESIGN.md) | design rationale | original architecture intent (sandbox default has since flipped — see banner) |
| [`docs/ARCHITECTURE-REVIEW.md`](docs/ARCHITECTURE-REVIEW.md) | audit record | 2026-08 audit findings and remediations |
| [`docs/QUALITY-PLAN.md`](docs/QUALITY-PLAN.md) | plan record | quality-first promotion design (largely implemented) |
| [`docs/EVOLUTION-SCIENCE-AUDIT.md`](docs/EVOLUTION-SCIENCE-AUDIT.md) | audit record | evolution-loop scientific causality audit |
| [`docs/RAG.md`](docs/RAG.md) | future design | retrieval layer v0.1 (anti-contamination rules) |
| [`docs/AGENT-EVO.md`](docs/AGENT-EVO.md) | historical | agent-track evolution run status |
| [`docs/SCOPE-PILOT.md`](docs/SCOPE-PILOT.md) | historical | scoped-tip routing pilot (metric caveats inside) |
| [`docs/DOCKER.md`](docs/DOCKER.md) | ops | containerized evaluation environment |

## Honesty infrastructure

Non-negotiable invariants, enforced in code and re-checked by the independent
Python verdict (`scripts/research_verdict.py`):

- package validity is gated on unit tests, complete trace, verify + compute
  replay, zero guard violations, verified cleanup, and matched model policy;
- `host-audit` / `requested-only` thinking / failed isolation ⇒ `eligible=false`,
  no overall score — recorded, never hidden;
- the workspace tier is report-only by construction: `eligible=false`,
  `unitTestsPassed=false` (no preflight), and its pack is judged by the same
  independent Python verdict — the expected "unit tests not attested" is a
  recorded conclusion, not a defect;
- budgets are enforced in code only: the model can read its envelope, never raise
  it (shrink-only modulation with floors and protected kinds);
- the experience library is **store-only** — nothing routes on it in this stage,
  and deterministic demo firmware retires on arrival;
- evidence bytes served over the API are re-hashed (sha256) before being sent;
- model-declared artifact ids are untrusted: accepted artifacts must come from
  the CAS store or a registered tool with verifiable metadata;
- draft normalization (`src/research/draft-normalizer.ts`) repairs purely
  formal mismatches in code and emits per-item coercion provenance; it never
  fabricates content; rejection is reserved for substantive failures;
- deterministic draft gates (report sections/citations, 8 slides, ≥12 grounded
  defense items with category-relevant evidence) run at submission time.

## Legacy

The original pure-Python prototype is archived under `legacy/`.
