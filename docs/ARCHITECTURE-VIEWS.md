# GeoRSI Architecture Views

The old single-page diagram tried to show context, containers, episode flow, and
security boundaries at once. That made dependencies look like a single graph
and hid the trust boundary. The Mermaid files in this directory are now the
maintained source views:

- `georsi-architecture.mmd` — compact top-level loop.
- `georsi-context.mmd` — system context and external dependencies.
- `georsi-runtime.mmd` — stable runtime/container dependencies.
- `georsi-episode.mmd` — one RSI generation and one inner episode sequence.
- `georsi-security.mmd` — agent-controlled execution versus trusted grading.
- `georsi-architecture-legacy.mmd` — the former all-in-one graph, retained for comparison.
- `georsi-architecture.c4.json` — structured C4-style inventory.

## Dependency rules

1. `src/rsi.ts` coordinates generations; it should not implement Python tools,
   model-provider quirks, or grader semantics.
2. `src/rsi_eval.ts` evaluates a scaffold and stages learning; acceptance stays
   in the RSI loop.
3. `src/inner/solve.ts` owns one episode and only communicates with the
   evaluator through `EvalContext` and submission artifacts.
4. `src/provider.ts`, `src/models.ts`, and `src/piharness.ts` hide model/API
   differences from orchestration and episode code.
5. Public scores may guide the inner agent; private fitness may guide the outer
   selector, but private values must never be rendered into agent prompts.
6. `memory` is run-local and probationary. Held-out exams use an empty episodic
   store. Cross-run knowledge is explicitly active or probationary.
7. `src/sandboxie.ts` owns the Windows Sandboxie-Plus adapter: strict episodes
   use an absolute exchange workspace, closed repository/private/credential
   paths, WFP network blocking, `/reload` read-back, PID ownership probes, and
   terminate/delete/reload cleanup. Strict `python_cmd` values must resolve
   outside the repository/private roots; repo-local GIS venvs are rejected
   before box creation rather than falling back to host Python. Sandboxie is
   app-level isolation, not VM security. `host-audit` remains an explicit
   non-sandbox compatibility mode; strict failures never fall back to host Python.
8. The Python policy is defense-in-depth in both backends. `restricted` blocks
   common subprocess/network/native-extension imports, while the Sandboxie
   backend provides the OS-enforced app-level boundary.
