# Frontend stage 1 — workspace visual review

Historical stage notes. Real submission and uploads are now available; see
[stage 2](FRONTEND-STAGE-2.md) for the current execution behavior.

On Windows, double-click **start-workspace.cmd** in the repository root.
It builds and starts the API and frontend, waits for healthy containers, checks
the HTTP endpoints and prints the addresses. Docker Desktop must be running.
The script automatically retries with a temporary public-image configuration
if the Docker Desktop credential helper fails; global configuration is preserved.
For command-line use: `powershell -File scripts/start-workspace.ps1`, or
`docker compose up -d --build georsi-api georsi-web`.
Open `http://localhost:3000/workspace`; the existing home page also links here.

This stage focuses on the research workspace presentation and interaction.
No real model call is started by the frontend. Existing research runs are read
from the API through a same-origin, read-only Next.js adapter.

## Review flow

1. Open the existing homepage and enter **研究工作台**.
2. Review the welcome page. Select an example question or type a question.
3. Add or drag PDF, CSV, XLS/XLSX, GeoTIFF or GeoJSON files. They remain local
   pending files in this stage (8 files maximum, 100 MB per file).
4. Click **用此问题演示**, or choose the explicitly labelled demonstration in
   the sidebar. No files are uploaded and no analysis of their content occurs.
5. Play, pause or replay the simulation. Zoom/pan the dependency graph and click
   a node to inspect its state, dependencies and attempt count.
6. Enter a supplemental direction during the demonstration; a labelled local
   acknowledgement appears. Real feedback delivery is deferred to stage 2.
7. Open the report panel, read the sample Markdown report and download it.
8. Switch to an actual historical API run to inspect its real graph, logs and
   available report. Historical runs refresh automatically.
9. Collapse the sidebar and try a narrow viewport. Report preview becomes an
   overlay on smaller screens. Reduced-motion preferences are respected.

## Stage boundary

Demo content is always labelled; it is never substituted for missing backend
responses. Ordinary submission shows the integration boundary explicitly.
The next stage connects natural-language input, real uploads and queued
direction updates to the existing self-evolution engine, and aggregates its
iteration/candidate records. Report completion ends the task.

Libraries: React Flow + Dagre for graph rendering/layout, SWR for server state,
react-dropzone for file selection, react-markdown + remark-gfm for reports,
and the existing Lucide icon set. No authentication or model/depth controls.

The interaction pass adds Radix UI Dialog (mobile sheets with focus trapping,
Escape/outside dismissal and focus restoration), Tabs (keyboard navigation),
Tooltip and Progress. Framer Motion animates desktop panel widths, task changes,
node state transitions, activity updates, supplemental messages and button press
feedback. CSS handles Radix sheet exit animations. Reduced-motion preferences
disable spatial/looping effects. The graph refits after panel resizing.

For this pass, review sidebar/report opening and closing, keyboard navigation
between activity/log tabs, clicking graph nodes, replaying the demo, and sending
demo supplements. Mobile sheets should close on Escape or backdrop click and
return focus to their trigger. These are user acceptance steps, not claims of
automated browser verification.

Layout revision: the center column now contains the question and workflow,
without a second activity/log section underneath. Click a node for the right
inspector's node tab, or **运行记录** in the graph footer for activity. Node,
activity, log and report tabs share the same inspector and scroll independently
from the graph. The history scrollbar is hidden while scrolling remains enabled.

Per the requested staged review process, browser visual validation belongs to
the user. Container build/type checking, health and HTTP checks are performed
before each handoff; no browser-based acceptance is claimed.
