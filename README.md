# GeoRSI Lab

Self-evolving geoscience research system on the **pi agent harness**
(`@earendil-works/pi-coding-agent`). An outer evolution loop rewrites the
strategy of an inner research agent; the inner agent does real quantitative
geoscience (writes code, runs it, submits answers) and is scored against
hidden truth. See `docs/DESIGN.md` for the original design rationale and
`docs/ARCHITECTURE-REVIEW.md` for the current convergence target, audit
findings, and generalization roadmap. The architecture is maintained as four
focused Mermaid views in `docs/georsi-context.mmd`, `docs/georsi-runtime.mmd`,
`docs/georsi-episode.mmd`, and `docs/georsi-security.mmd`; the older editable
Drawio overview remains at `docs/georsi-architecture.drawio`. See
`docs/ARCHITECTURE-VIEWS.md` for dependency rules.

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

On Windows, the default execution backend is **Sandboxie-Plus app-level
isolation**. Each episode gets a fresh box and an absolute exchange workspace
under `%TEMP%\\GeoRSI\\episodes\\<run-id>\\<episode-id>`. The repository,
private-truth root, credential files/registry locations, and network are closed
inside that box. `host-audit` is an explicit compatibility backend only; it is
not an OS sandbox and is never an automatic fallback from strict mode.

## Gateway models (fixed support list)

Verified 2026-08-28 and pinned in `src/config.ts` (`SUPPORTED_MODELS`);
`loadConfig` rejects anything else. Per-model reasoning-parameter quirks,
vision bits and stability notes live in **`config/model-profiles.json`** —
the machine-readable single source of truth consumed by `src/models.ts`
(`resolveThinking` clamps/translates thinking levels per model) and by the
Python side (`problems/_shared/model_client.py`). The human view with probe
methodology and role assignments is **`docs/MODELS.md`**.

| model | endpoint | route | API | ctx / max-out | role |
|---|---|---|---|---|---|
| `mimo-v2.5` | zen | direct | chat/completions | 1m / 128k | inner researcher; heavy fallback |
| `mimo-v2.5-pro` | emooo (`api.emooo.cc`) | direct | chat/completions | 1m / 128k | temporary inner candidate; thinking minimal/low/medium/high/xhigh |
| `hy3` | zen | direct | chat/completions | 256k / 128k | outer proposer (**default**) |
| `z-ai/glm-5.3-flash` | openrouter | direct | chat/completions | 1m / 131k | current quiz/agent inner candidate; mandatory reasoning |
| `minimax/minimax-m3:free` | openrouter | direct | chat/completions | 1m / 131k | free fallback; fast and multimodal |
| `ox-alpha-free` / `stealth/ox-alpha` | retired | — | — | — | historical aliases; rejected at config load |
| `muse-spark-1.2-contributor` | zen | **proxy** | **responses** | — | region-locked; auto-proxy via undici `EnvHttpProxyAgent` when selected |
| `dsv4f` | **campus local** | direct | chat/completions | 256k / 64k | free local deepseek; server downtime is normal — preflighted at boot, fails fast with a switch hint |

`mimo-v2.5-pro` is a temporary external provider route. Set
`RSILAB_EMOOO_API_KEY` in the process environment before selecting it; the key
is intentionally not stored in `config.json`, source, or benchmark files. The
provider is configured with the live-tested `chat/completions` endpoint and
z.ai-style request shape (`thinking: {type: "enabled", clear_thinking: false}`
plus `reasoning_effort`; `off` sends `thinking: {type: "disabled"}`). A ready,
non-secret temporary config is `config/emooo-mimo-pro.json`. It sets the inner and
outer reasoning levels explicitly; valid config values are `off`, `minimal`,
`low`, `medium`, `high`, `xhigh`, and `max` (the provider profile clamps or
rejects unsupported values before a request is sent).

```powershell
$env:RSILAB_EMOOO_API_KEY="<temporary-key>"
$env:RSILAB_REQUEST_MAX_TOKENS="8192"  # optional for long emooo turns
npm run smoke -- --config config/emooo-mimo-pro.json
```

If a long model turn writes the canonical `solutions/<problem>.json` but ends
before emitting `submit`, the driver can route that workspace-only candidate
through the same public evaluator; the episode records this as
`submissionRecovery: "candidate-file-driver"`. This does not read private truth
or bypass the normal guard/cleanup path.

Switch models at runtime from the research agent chat: `/research model`
(shows current + list), `/research model inner z-ai/glm-5.3-flash`,
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
    "job_poll_s": 30,             // driver poll interval while waiting
    "execution_policy": "audit",         // source checks; not a sandbox
    "execution_backend": "sandboxie",     // Windows strict backend
    "sandboxie_start_path": "C:\\Program Files\\Sandboxie-Plus\\Start.exe",
    "sandboxie_ini_path": "C:\\Program Files\\Sandboxie-Plus\\SbieIni.exe"

### Sandboxie-Plus execution boundary

`src/sandboxie.ts` is an adapter around the installed Sandboxie-Plus release;
GeoRSI does not reimplement file virtualization, process injection, or network
filtering. Before a strict episode starts it:

- creates a fresh ASCII-only box with `ConfigLevel=10` and `Enabled=y`;
- writes `ClosedFilePath` rules for the full repository/private roots and
  credential locations, plus `ClosedKeyPath` credential rules;
- opens only the expanded absolute exchange workspace for episode I/O;
- sets `AllowNetworkAccess=n`, `NetworkEnableWFP=y`,
  `NetworkAccess=*,Block`, then runs `Start.exe /reload`;
- temporarily enables and verifies global `[GlobalSettings] NetworkEnableWFP=y`
  when needed, then restores the exact pre-episode value during cleanup;
- queries the rules back, starts the Python wrapper with `/box:<name>`, and
  proves ownership with `/listpids` before allowing execution;
- runs a real probe against an unlisted repository file, private root, and
  `https://example.com`; any successful access fails closed;
- terminates the box, deletes its contents, removes its config section, reloads,
  and verifies the box is no longer enabled.

Two Sandboxie CLI details are intentional. `SbieIni query /boxes *` is the
valid enabled-box query; a bare `query /boxes` is not. The recurring
`invalid sandbox name parameter DefaultBox` message means the named section is
not active (`Enabled=y` is missing or not loaded), so strict code validates the
box before launch rather than falling back to `DefaultBox`. Likewise,
`delete_sandbox_silent` is a command token after `/box:<name>` and must **not**
be slash-prefixed. `/fcp` is not put on GeoRSI's outer root launch: in
Sandboxie's `Start.exe` parser that means “run the root outside and force only
future children,” which defeats root isolation. Normal child propagation from
the boxed root is retained; `/fcp` remains reserved for an explicitly
unboxed helper scenario.

`episode.json` records the backend, box name, exchange path, reload/read-back
status, probe results, verified PIDs, and cleanup result. Sandboxie is
**app-level isolation**, not a VM or a complete host-security boundary.

### GIS Python runtime under strict Sandboxie

GIS problems may override `python_cmd`, but strict Sandboxie accepts only an
interpreter or virtual environment whose resolved path is outside both
`F:/rsi-lab/` and `F:/rsi-lab-private/`. A repo-local `.gisenv/Scripts/python.exe`
is rejected **before the box is created**. GeoRSI never falls back to host Python
for this case: the episode fails closed. Install/copy the GIS venv to an
external path and point `python_cmd` there, or explicitly select `host-audit`
when compatibility with a repo-local venv is intentional; `host-audit` is not
an OS sandbox.

On Windows, an existing legacy venv can be copied once with:

```powershell
robocopy F:/rsi-lab/.gisenv F:/GeoRSI/venvs/gis /E /COPY:DAT /DCOPY:DAT
```

The benchmark builders also honor `GEORSI_GIS_PYTHON`; set it to the external
`Scripts/python.exe` before regenerating benchmark `problem.json` files.
## TUI dashboard (pi-tui)

`npm run tui` starts a fullscreen dashboard (built on `@earendil-works/pi-tui`)
and runs the evolution loop in the same process:

```
┌ GeoRSI ─ rsi-20260827 · 1h23m │ inner z-ai/glm-5.3-flash / outer hy3
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
    npm run sandboxie:selftest             # real box + PID/path/network/cleanup probe
    npx tsx src/run.ts smoke               # one live episode on quake_b
    npx tsx src/run.ts exam               # full suite exam -> RESULTS.md
    npx tsx src/run.ts rsi --gens 4       # evolution run
    npx tsx src/run.ts rsi --resume       # continue an interrupted run

External-benchmark suites ship **without** their `data/` (gigabytes,
regenerable): rebuild any suite with the `scripts/*_build.py` commands above
after placing the source banks under `benchmarks/` (gitignored). Strict
Sandboxie requires GIS problems to use an interpreter/venv **outside** the
repository (for example `F:\\GeoRSI\\venvs\\gis\\Scripts\\python.exe`).
Repo-local `.gisenv/` overrides are rejected before box creation because the
whole repository is closed. Use `host-audit` explicitly only when a repo-local
venv is intentionally required; that mode is not an OS sandbox.

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

For a bounded routing pilot, `scripts/quiz_slice.py` creates deterministic
small slices from an existing chunk. The completed 2026-08-27 seed/unscoped/
scoped comparison is documented in [`docs/SCOPE-PILOT.md`](docs/SCOPE-PILOT.md).

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

Agent evolution coverage and the remaining `CRASHY/ESCALATE` boundary are
tracked in [`docs/AGENT-EVO.md`](docs/AGENT-EVO.md).

## Knowledge base (cross-run memory)

`knowledge/nodes.jsonl` stores lessons tagged with the regions/genres they
apply to; `src/knowledge.ts` routes active nodes to a deterministic,
char-budgeted lesson set injected into the inner prompt. Newly accepted
champion tips are staged as `probation` rather than silently becoming active.
Usage stats (`uses`/`wins`/fitness) update only after an episode ends. Use
`RSILAB_KB_INCLUDE_PROBATION=1` only for an explicit A/B pilot, and promote a
probation node after independent evidence with:

    python scripts/knowledge_add.py --promote <node-id>

The command requires at least 3 observations and a 0.8 private-fitness win
rate unless `--force` is supplied.

## Honesty infrastructure (anti reward-hacking)

GeoRSI now has two explicit Python backends:

- **strict `sandboxie`** (the Windows default): the agent runs through
  Sandboxie-Plus in a fresh per-episode box. The exchange workspace is outside
  the repository; the full repository/private roots, credential locations, and
  network are closed and checked by a real probe. If Sandboxie, `/reload`,
  rule read-back, PID ownership, or the probe fails, the episode fails closed —
  it never falls back to host Python.
- **`host-audit`**: an explicit compatibility mode for environments without
  Sandboxie. It keeps the existing path fence, execution-policy scan, manifest,
  and post-episode guard, but is not an OS sandbox.

Defense-in-depth remains enabled in both modes (`src/guard.ts`; asserted by
`npm run selftest`):

- **workspace fence**: `run_python`/`start_job` reject paths outside the
  exchange workspace, and official pi `read`/`write`/`edit`/`ls`/`grep`
  factories receive symlink-aware guarded operations;
- **protected manifest**: eval-side files (eval.py, gold answers, hidden
  references) are hashed before the episode; tampering fails the eval;
- **post-episode sweep**: agent-written artifacts and tool-call text are
  scanned for protected-path references; a breach marks the episode
  compromised (fitness → null);
- **credential stripping**: provider/judge credentials, proxy variables, and
  Python/Node path-injection variables never reach strict agent Python wrappers;
- **execution policy**: `execution_policy: "restricted"` blocks common
  subprocess/network/native-extension imports before launch; `"audit"` records
  warnings;
- **process cleanup**: foreground timeouts, background jobs, normal completion,
  uncaught/unhandled fatal errors, and the Node exit handler terminate the
  Sandboxie box and remove its config. An external hard kill of the Node process
  (`taskkill /F`, power loss, or kernel crash) cannot execute user-space cleanup;
  after such a kill, verify `SbieIni query /boxes "*"` and rerun the integration
  selftest before trusting the next run; strict execution never falls back to
  the host while cleanup is uncertain.

Sandboxie-Plus provides **app-level isolation**, not VM-level security. It does
not replace host hardening, a VM, resource governance, or an independent
trusted evaluator.

## Per-problem overrides

Each `problems/<id>/problem.json` may override config knobs for its suite
mechanism: `type: quiz`, `judge: true` (LLM-judged private split),
`python_cmd` (an external interpreter/venv is required by strict Sandboxie;
repo-local `.gisenv/` paths are rejected), `execution_backend` (usually
`sandboxie` or explicit `host-audit`), `execution_policy`,
`eval_timeout_s`, `max_turns`, `eval_cap`, episode/job timeouts. Overrides merge
over config.json and win; `npm run selftest` covers grader units, suite
structure, gold isolation and the model/guard layers (no LLM needed).

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
