# Stage 2: real autonomous workspace tasks

The normal composer now starts a real `research-agent` task. The separately
labelled demo remains available for visual review. Run `start-workspace.cmd` and
open `/workspace`. Task URLs include `?run=...`, so refreshing restores the task.

## Execution

The workspace adapter uses the existing `ResearchScheduler`, WorkGraph state
machine, hash-chained `ResearchEventLedger`, content-addressed evidence store
and audited `DirectHostComputePort`. The configured ALSL Luna high model plans
a validated dependency graph, executes bounded tool loops, writes the report,
and critiques the result. If further work is needed it creates another graph,
retaining completed evidence. Defaults are 3 rounds and 60 total model calls;
`GEORSI_WORKSPACE_ROUNDS` and `GEORSI_WORKSPACE_MODEL_CALLS` override these on
the backend. The report includes the final review and any unresolved limits.

This adapter is host-development execution inside Docker. It does not claim
competition eligibility or statistically paired promotion of a global champion.
The existing `research-live`, `research-evolve` and `rsi` tracks are preserved.

Tools include Crossref scholarly search, bounded public HTTP source retrieval,
and audited Python analysis. Private-network URLs are rejected. Retrieved files
are available to later Python calls. Uploaded PDF, CSV/Excel, GeoTIFF and GeoJSON
files are stored as hashed evidence and receive bounded previews. Model-written
Python runs with sanitized environment variables and the existing execution
policy checks. This remains the existing host-audit trust model, not an OS sandbox.

## HTTP additions

| Method | Path under `/api/v1` | Purpose |
| --- | --- | --- |
| POST | `/uploads?name=<filename>` | Raw streamed file, maximum 100 MB; returns upload ID, name, size and SHA-256 |
| POST | `/research-requests` | `{ question, uploadIds: [] }`; immediately starts a real task and returns its ID |
| GET | `/research-runs/:id/request` | Original question and attached file metadata |
| GET | `/research-runs/:id/directions` | Supplemental directions with queued/applied states |

The existing feedback endpoint queues directions for `research-agent`; they
enter the next model node without interrupting the current call. Finished runs
reject new feedback. The existing stop endpoint supports this mode. A maximum
of two child tasks may run concurrently through the new endpoint.

Snapshots include `workspace.phase`, `iteration`, `iterations`, model-call and
token totals. The existing workflow, logs, evidence, report and SSE resources
serve real data. Logs accept `tail=<bytes>` to read the most recent output.
Evidence and computation workspaces are persisted under ignored `runs` folders
via Docker volumes. Refreshing/leaving the browser does not stop the process.
Container termination still interrupts execution; automatic restart/resume of
workspace campaigns is not implemented in this stage.

## Validation

`npm run workspace:selftest` runs offline inside Docker: streamed upload, invalid
request/extension checks, cycle and dependency checks, private URL rejection,
actual Python file computation, two graph rounds, queued feedback consumption,
report publication and ledger verification. Model replies are injected only
inside this selftest. Production always calls the configured model gateway.

Frontend validation remains user-driven as requested; build, type and HTTP
checks are performed before handoff.

Live integration record: `run_e78397696fb1` used the configured Luna high gateway
to analyze an uploaded three-row rainfall CSV. Four nodes completed, Python
computed and independently checked the mean of 100, 120 and 140 as 120, and a
direction submitted during execution was consumed by a later node and included
in the report. Report reads returned HTTP 200; post-completion feedback returned
409. Crossref returned a real search result. PDF, XLSX, GeoJSON and GeoTIFF
preview dependencies were also exercised in the container. The offline test
separately verifies the two-round replanning path.
