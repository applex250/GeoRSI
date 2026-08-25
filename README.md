# GeoRSI Lab

Self-evolving geoscience research system on the **pi agent harness**
(`@earendil-works/pi-coding-agent`). An outer evolution loop rewrites the
strategy of an inner research agent; the inner agent does real quantitative
geoscience (writes code, runs it, submits answers) and is scored against
hidden truth. See `docs/DESIGN.md` for the full design rationale.

## The research agent (pi chat + `/research`)

From ANY folder (Windows Terminal / VS Code terminal recommended):

    F:\rsi-lab\agent.cmd          # (or agent.sh) — starts a NORMAL pi agent chat

You land in a regular pi coding-agent conversation. Then:

    /research start      scaffolds ./research/ in the current folder with
                         template files + an explanation of what goes where
                         (statement.md, data/, private_truth.txt, eval.py)
    /research run        after you fill them in: solves YOUR problem with the
                         lab's best strategy — progress streams into the chat
    /research evolve 3   registers the problem in the lab and runs the full
                         self-improvement loop on it (3 generations)
    /research model      show current inner/outer models + supported list;
                         /research model inner <id> or outer <id> switches
    /research think      expand the collapsed thinking of the last run into
                         the chat (white); /research think live toggles
                         streaming thinking expanded for the next run
    /research help

**Asking the chat about the research**: the main agent has two tools —
`research_status` (snapshot: active run, submissions/scores, recent events,
log/workspace paths) and `research_control` (pause/resume/stop/feedback).
Ask naturally ("研究进展如何？分析一下" / "让它先停一下" / "告诉它重点看稳健性")
and the agent calls the tools; it can also read `stream.log` itself for deep
analysis. All streaming stays in the bottom panel; the chat stays clean.

While a run streams, **the chat stays fully interactive** — the engine runs
detached from the command (pi awaits command handlers, so blocking would
freeze the editor). Keep chatting with the pi agent while the monitor panel
above the input box shows live research activity; thinking blocks collapse to
one gray summary line each (`▸ [#N] thinking …`) which is an OSC 8 hyperlink —
**click it to open the full stream.log in your editor**; tool calls
(`⚙ name(args)` / `↳ result`) and narration show in full; system lines are
red. Mid-run commands: `/research pause|resume|stop` (engine watches a
control file), `/research feedback <text>` (read by the next generation),
`/research status`.

Verified end-to-end: a fresh scaffolded problem (mean-magnitude estimation)
solved by the engine subprocess in 31s with fitness 1.0000
(`npm run extcheck` re-runs the whole flow).

## Architecture

    outer loop (slow, evolves the agent — hy3)
      goal gate -> propose (think-first, <=3 edits) -> critique panel
      -> evaluate survivors on the training suite -> adversarial verify
      -> champion snapshot (atomic) -> memory reflection -> board append

    inner loop (fast, does the science — mimo-v2.5, a real pi agent session)
      tools: read/write/edit/ls/grep + run_python + submit(public score)
      stop: submission budget + patience + wall clock

    problems/ (geoscience suite, ##SCORE## protocol)
      quake_b (synthetic seismology) · quake_b_real (REAL USGS ComCat SoCal
      catalog, 76k events 1990-2024) · flood_rp (hydrology) ·
      climate_trend (climatology) · poro_perm (petrophysics, held-out)

Private truths live OUTSIDE this tree (`../rsi-lab-private/`), so agents cannot
reward-hack by reading them. Agents see only public (reference) scores; the
outer loop selects on private scores.

## Gateway models (fixed support list)

Verified 2026-08-24/25 and pinned in `src/config.ts` (`SUPPORTED_MODELS`);
`loadConfig` rejects anything else. Per-model reasoning-parameter quirks,
vision bits and stability notes live in **`config/model-profiles.json`** —
the machine-readable single source of truth consumed by `src/models.ts`
(`resolveThinking` clamps/translates thinking levels per model) and by the
Python side (`problems/_shared/model_client.py`). The human view with probe
methodology and role assignments is **`docs/MODELS.md`**.

| model | endpoint | route | API | ctx / max-out | role |
|---|---|---|---|---|---|
| `mimo-v2.5` | zen | direct | chat/completions | 1m / 128k | inner researcher (**default**; heavy reasoner) |
| `hy3` | zen | direct | chat/completions | 256k / 128k | outer proposer (**default**) |
| `ox-alpha-free` | zen | direct | chat/completions | 1m / 128k | fastest inner alternative |
| `stealth/ox-alpha` | openrouter | direct | chat/completions | 1m / 131k | free backup (429 under burst; reasoning mandatory; text+image+video raw API) |
| `muse-spark-1.2-contributor` | zen | **proxy** | **responses** | — | region-locked; auto-proxy via undici `EnvHttpProxyAgent` when selected |
| `dsv4f` | **campus local** | direct | chat/completions | 256k / 64k | free local deepseek; server downtime is normal — preflighted at boot, fails fast with a switch hint |

Switch models at runtime from the research agent chat: `/research model`
(shows current + list), `/research model inner ox-alpha-free`,
`/research model outer hy3` — effective on the next run.

Local server: `local_base_url` in config.json (default
`http://172.27.116.56:8080/v1`), key in `api_key_local.txt` (gitignored) or
`RSILAB_LOCAL_API_KEY`. Selecting muse routes gateway traffic through the env
proxy (`HTTPS_PROXY`, e.g. `http://127.0.0.1:7897`) while the local server
always stays direct (noProxy) — node's `NODE_USE_ENV_PROXY` does NOT work
here because importing pi replaces globalThis.fetch. Transient gateway
`network_error` bursts are absorbed by pi auto-retry hardened to 6 attempts
in the harness.

## Long computations (hours)

The inner agent has background jobs: `start_job(file)` spawns a script as a
detached process (log → `jobs/<name>.log`, status → `jobs/<name>.status.json`);
the EPISODE DRIVER waits for running jobs between turns — no turns burned, no
watchdog risk — and wakes the agent with the finished summary. `job_status`
and `kill_job` are available anytime; jobs are killed at episode end or when
they exceed `job_timeout_s`. Knobs in config.json:

    "script_timeout_s": 120,     // foreground run_python cap
    "job_timeout_s": 14400,      // background job hard cap (4h default)
    "episode_timeout_s": 900,    // raise this for long-job problems (e.g. 18000)
    "job_poll_s": 30             // driver poll interval while waiting

## TUI dashboard (pi-tui)

`npm run tui` starts a fullscreen dashboard (built on `@earendil-works/pi-tui`)
and runs the evolution loop in the same process:

```
┌ GeoRSI ─ rsi-20260824 · 1h23m │ inner ox-alpha-free / outer hy3
│ gen 2/4 │ champion 0.8678 │ stag 0/3 │ tokens 14.1M │ heldout — │ running
│ suite quake_b 0.960 │ flood_rp 0.950 │ climate_trend 0.700
│ ⠋ gen 2: eval survivor 1/1 — inject canonical estimators
├──────────────────────────────────────────────（scrolling event log）
│   ✓ [method upgrade] Aki MLE + L-moments tips (q=4, expect +0.05)
│   ★ NEW CHAMPION 0.7848 → 0.8678
│   submit #2/6 → public 0.9100 (best 0.9100)
├──────────────────────────────────────────────
│ › type feedback + Enter │ /help /pause /resume /stop /status
└ Ctrl+P pause · Ctrl+G help · Ctrl+C ×2 quit
```

- **feedback**: plain text + Enter appends to `runs/<name>/FEEDBACK.md`
  (read by the next generation's proposals) — steer a running evolution
- **Ctrl+P / /pause** halts the loop at the next safe point; **/stop** stops
  gracefully after the current episode (`--resume` continues later)
- quitting never loses state — all artifacts persist under `runs/<name>/`
- **replay** (zero LLM cost): `npm run tui -- --replay runs/rsi-live`
  renders a finished run's journal through the same dashboard
  (`--replay-speed 100` to accelerate)
- headless render tests: `npm run tuitest` (75 checks, no TTY needed); real-episode event-sink check: `npm run emitcheck`
- requires an interactive terminal (Windows Terminal / VS Code recommended);
  non-TTY starts are rejected with a hint to use `npm run rsi`

## Quick start

    npm install --ignore-scripts          # pi packages (pinned 0.84.2)
    python problems/<id>/gen.py --private ../rsi-lab-private   # (re)gen data
    npx tsx src/run.ts selftest           # no-LLM unit tests (grader/suite/guard/models)
    npx tsx src/run.ts smoke              # one live episode on quake_b
    npx tsx src/run.ts exam               # full suite exam -> RESULTS.md
    npx tsx src/run.ts rsi --gens 4       # evolution run
    npx tsx src/run.ts rsi --resume       # continue an interrupted run

External-benchmark suites ship **without** their `data/` (gigabytes,
regenerable): rebuild any suite with the `scripts/*_build.py` commands above
after placing the source banks under `benchmarks/` (gitignored). The GIS
problems use an isolated venv at `.gisenv/` (`python_cmd` override).

API key: `RSILAB_API_KEY` env var or `api_key.txt` (gitignored). Gateway and
models are configured in `config.json`; the pi provider file
(`config/pi-models.json`) is regenerated at boot.

## External benchmarks (A/B-tier integration)

`scripts/quiz_build.py` converts external question banks into **quiz-mode**
problems (one chunk = one problem; questions in `data/quiz.jsonl`, answers in
`answers.private.jsonl` — never copied to the agent; submission =
`answers.json` via the submit tool, eval_cap 2, unanswered = wrong). Suite
registers live in `config/<suite>.problems.json`; point `config.json`'s
`problems_file` at one to run it whole:

    python scripts/quiz_build.py --src earthse   --chunk 100 --suite earthse
    python scripts/quiz_build.py --src k2        --chunk 100 --suite k2
    python scripts/quiz_build.py --src mapqa     --chunk 60  --suite mapqa
    python scripts/quiz_build.py --src gkmc      --chunk 100 --suite gkmc
    python scripts/quiz_build.py --src stepgame  --chunk 100 --suite stepgame --limit 2000
    python scripts/quiz_build.py --src mgq       --chunk 60  --suite mgq

Judge/oracle problems (no quiz template):

    python scripts/gab_build.py --n 10          # GeoAnalystBench: oracle -> judge chain
    python scripts/gbx_build.py --n-real 8 --n-reject 4   # GeoBenchX: tool-chain judge,
                                                # correct rejection = deterministic 1.0

`problems/_shared/judge.py` is the cached LLM judge (same submission → same
score, disk cache keyed by model+prompt). Its credentials never reach the
agent's python subprocesses (`solve.ts` strips `RSILAB_JUDGE*`). Per-problem
knobs (max_turns, eval_cap, timeouts, judge, genre) live in each
`problems/<id>/problem.json`. `npx tsx src/run.ts selftest` asserts suite
structure, gold isolation and grader units (no LLM). See
`benchmarks/ANALYSIS.md` for per-benchmark status, grading semantics and the
honest boundaries (quiz fitness is knowledge-bounded; public-score probing
risk is mitigated, not eliminated).

## Knowledge base (cross-run memory)

`knowledge/nodes.jsonl` stores every proven lesson as a node tagged with the
regions/genres it applies to; `src/knowledge.ts` routes a problem's tags to a
deterministic, char-budgeted lesson set injected into the inner prompt (same
store version + problem ⇒ same injection). Usage stats (`uses`/`wins`/
fitness) update only after an episode ends and demote lessons that stop
paying; `scripts/knowledge_add.py` appends nodes manually.

## Honesty infrastructure (anti reward-hacking)

The protocol is no-sandbox by design — the agent gets real filesystem access
— so cheating is **detected, not prevented** (`src/guard.ts`; asserted by
`npm run selftest`):

- **workspace fence**: `run_python`/`start_job` resolve paths and reject
  anything outside the episode workspace (the old strip-dots regex let
  leading `../` through)
- **protected manifest**: eval-side files (eval.py, gold answers, hidden
  references) are hashed before the episode; tampering fails the eval
- **post-episode sweep**: everything the agent wrote/executed is scanned for
  references to protected paths (`answers.private`, judge cache,
  `rsi-lab-private`, any absolute reach into `problems/`) — a breach marks
  the episode compromised (fitness → null), keeping poisoned results out of
  champion selection and knowledge stats
- **credential stripping**: `RSILAB_JUDGE*` env vars never reach agent-run
  python subprocesses

## Per-problem overrides

Each `problems/<id>/problem.json` may override config knobs for its suite
mechanism: `type: quiz`, `judge: true` (LLM-judged private split),
`python_cmd` (e.g. the `.gisenv/` GIS venv), `eval_timeout_s`, `max_turns`,
`eval_cap`, episode/job timeouts. Overrides merge over config.json and win;
`npm run selftest` covers grader units, suite structure, gold isolation and
the model/guard layers (no LLM needed).

## Run artifacts (runs/<name>/)

- `board.jsonl` append-only journal (source of truth; crash-safe)
- `state.json` atomic snapshot (generation, champion, history) — resume point
- `champion_scaffold.json` current champion
- `variants/genN_vK.json` every proposal incl. pruned (audit)
- `leaderboard.md`, `FINDINGS.md` human-readable reports (regenerable)
- `episodes/`, `memory/memory.jsonl`, `RESULTS.md`, `FEEDBACK.md` (write to steer)

## Legacy

The original pure-Python prototype (custom reply/execute loop on the raw
OpenAI SDK) is archived under `legacy/`.
