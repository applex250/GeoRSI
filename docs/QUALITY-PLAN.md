# GeoRSI quality remediation plan

Status: implemented and validated
Baseline: `master` at `2ed6a09` (2026-08-29)
Inputs: parent audit plus three independent read-only reviews (security/isolation, architecture/reliability, scientific evaluation/model quality).

## 1. Objectives and invariants

1. Keep Windows strict execution fail-closed: no Sandboxie, rule, probe, PID, cleanup, interpreter-boundary, or global-WFP failure may fall back to host Python.
2. Keep private grading unavailable to the inner agent and run private evaluation only after boxed processes are terminated.
3. Make lifecycle controls truthful: configured survivor, stop, timeout, resume, token, held-out, and report behavior must match runtime behavior.
4. Make evaluation claims honest and reproducible: private-only quiz scoring, weighted aggregation, exact expected-task denominators, immutable run evidence, and no success exit when every task failed.
5. Never persist runtime provider credentials in the repository; generated provider configuration must be ephemeral and cleaned.
6. Preserve the existing working controls: exchange-only Pi tools, credential environment stripping, box-rule read-back, live repo/private/network probes, manifest hashing, fixed-denominator training fitness, memory snapshots, and post-cleanup private scoring.

## 2. Approved implementation scope

### Phase A — security and grading integrity (release blockers)

A1. **Protect effective grading paths, including ad-hoc research.**
- Extend evaluation context with explicit protected grading files/roots.
- In strict episodes canonicalize and close the configured repo/private roots plus any external problem/truth roots.
- Probe every additional protected truth/file path before allowing agent execution.
- Include external truth files in the grading manifest.
- Acceptance: an ad-hoc truth outside both lab roots is denied by a real Sandboxie probe; lexical and canonical aliases are both closed.

A2. **Verify grader assets before use.**
- Check the manifest immediately before public and private evaluator launches; do not run a changed evaluator with private/judge credentials.
- Strict mode must also verify no undeclared boxed process remains before host evaluation. `host-audit` remains explicitly unable to provide a confidentiality guarantee; a mismatch still prevents execution.
- Keep the final post-episode verification as defense in depth.
- Acceptance: a changed `eval.py` is rejected before evaluator execution, and a strict foreground process cannot leave a writer alive across evaluator launch.

A3. **Serialize global WFP mutation across processes.**
- Add a cross-process, fail-closed lease held for the complete strict-box lifetime.
- Refuse a second strict episode while the lease owner is live; do not automatically reclaim a stale/crashed lease because abandoned boxes/global state require operator inspection. The error must identify the lease path and manual recovery/self-test requirement without exposing secrets.
- Release only after box termination/removal, reload, and global WFP restoration/read-back all succeed.
- Acceptance: a second box prepare fails while the first lease is active; normal cleanup releases it; a synthetic stale lease fails closed with actionable diagnostics.

A4. **Tighten process and file-tool lifecycle.**
- After a foreground command exits, require the complete box PID set to return to its pre-command baseline; terminate/fail closed on undeclared descendants.
- Reject reparse/symlink components in exchange tool paths and disable host file tools while declared background Python jobs are running.
- Expand common credential-store deny paths and credential-helper environment stripping.
- Acceptance: detached foreground descendants are detected; static/dangling reparse paths fail; file tools refuse operations during live background jobs.

A5. **Remove persistent provider credential artifacts.**
- Build `models.json` in a private random per-process temp directory outside the repository, include only providers whose credentials are available (and fail clearly when a selected/reachable route lacks one), initialize `ModelRuntime`, and delete the directory immediately afterward.
- Ensure all globally configured routed models needed by the run are composed before caching; do not silently break extension/task routing merely to reduce the temp file.
- Remove any legacy `config/pi-models.json` left locally; retain its gitignore entry for backward safety.
- Acceptance: runtime construction leaves no repository `pi-models.json`; temp cleanup runs on success and failure; an emooo-only selection does not require a Zen key.

### Phase B — orchestration and cost-control correctness

B1. **Make episode deadlines real.**
- Establish one deadline at episode start and pass only remaining time into each prompt/evaluator/job wait.
- Cleanup remains mandatory even after deadline expiry.
- Acceptance: a later turn cannot receive a fresh full episode timeout.

B2. **Propagate pause/stop and cancellation.**
- Pass `RunController` into every suite episode; stop before each repeat/problem and after the current episode.
- Mark incomplete candidate evaluations as cancelled and ineligible for champion acceptance while retaining missing tasks as zero in the fixed denominator.

B3. **Enforce survivor and token controls between calls.**
- Rank/slice critique survivors to `cfg.survivors`.
- Check the token cap before every outer call, problem/repeat, verification, and held-out episode; set/reset the global exhausted flag consistently.
- Document that one already-started request can overshoot the soft token cap, but no new request starts afterward.

B4. **Make resume/finalization idempotent and fresh run names safe.**
- Persist held-out completion, summary, and final token count in `state.json`.
- Resume skips an already completed held-out gate unless a future explicit rerun option is added.
- Refuse a nominally fresh run when durable artifacts already exist under the chosen run name.

B5. **Repair extension and CLI contracts.**
- `/research evolve` must copy/validate `reference_truth.txt`.
- Filter/reject retired model choices in the extension.
- Standalone exam exits nonzero when required training episodes have no valid fitness.

B6. **Persist safe episode evidence outside the exchange temp tree.**
- After cleanup, private grading, and guard checks, atomically copy the final `episode.json` and canonical submitted JSON into the requested run workspace. Do not copy arbitrary agent scripts/logs into the trusted repository tree.
- Keep `workspace` as the exchange location and add a durable-artifact path so reports/verdict tools can distinguish them.
- Acceptance: strict RSI/exam/held-out runs have the expected durable episode records, and interrupted/missing records remain visible as fixed-denominator failures.

B7. **Separate successful-score warnings from failures.**
- If a valid submission/private fitness exists but the model later ends with `stopReason=length` or another post-submit assistant error, preserve it as a warning rather than tagging the scientific result as a failed episode.
- Reports and memory learning must use `fitness == null` as the failure criterion while retaining warnings for reliability analysis.

### Phase C — evaluation and model-contract honesty

C1. **Separate quiz public calibration from private-only scoring.**
- Public scores `dev=true`; private scores only `dev=false`; optional all-item diagnostics must not drive selection.
- Version the changed metric in details/reports so historical all-item scores are not compared as if identical.
- Update generated statement wording and grader tests.
- Acceptance: changing dev answers cannot change private-only score and vice versa; unanswered private-only items remain in the denominator.

C2. **Use weights consistently.**
- Carry problem weights into standalone and held-out exam aggregation/reporting.
- Acceptance: weighted null failures produce the same result in training and exam paths.

C3. **Make automated verdict denominators exact.**
- Derive expected held-out episode IDs/repeats/weights from `run-manifest.json`; missing/malformed/duplicate records contribute failure and prevent success.

C4. **Make routed model and reasoning behavior fail closed.**
- Validate `quiz_inner_model` and all loaded per-problem routes before paid work; preflight all reachable selected routes.
- Preserve supported extended levels through `thinkingLevelMap`; reject profile translations requiring request fields the TS harness cannot emit rather than silently folding to a rejected level.
- Validate configured thinking-level strings instead of silently defaulting.
- Bound request token override to a positive integer and the model ceiling.

C5. **Make `eval_budget_hint` effective.**
- Render it as a soft submission target clamped to the hard `eval_cap`, or remove it. The approved choice is to render it.

C6. **Improve evidence artifacts and documentation honesty.**
- Emit standalone exam JSON evidence with config/scaffold/profile/problem metadata, weights, tokens, warnings, submission recovery, isolation cleanup, and exact result counts.
- Correct lifecycle diagrams and stale test counts.
- Label structural GIS/agent graders as proxy metrics rather than end-to-end scientific correctness.
- Reword selected-training improvements that lack held-out transfer as exploratory, not proven durable improvement.

C7. **Remove avoidable benchmark noise and causal overclaiming.**
- Fix the geology inline-option parser so abbreviations such as `EBSD)` cannot be mistaken for an option delimiter; add regression fixtures and build-time option validation.
- Relabel knowledge `wins` as exposure/co-occurrence telemetry in human output and prevent automatic promotion claims unless independent evidence is supplied. Preserve old JSON compatibility.

### Phase D — tests and gates

D1. Add deterministic self-tests for config validation, weighted exam aggregation, private-only quiz splits, survivor limiting, run-name/refinalization behavior, pre-eval integrity, token-cap helpers, routed models, request token bounds, durable strict-episode records, and report completeness.

D2. Extend real Sandboxie self-test for the WFP lease, external protected canary, detached foreground descendants, and cleanup/lease release.

D3. Add `npm run check` as the free aggregate gate: typecheck, selftest, TUI tests, structure test, and Python compilation. Keep real Sandboxie self-test separate because it mutates installed Sandboxie state.

D4. Final gates: `npm run check`, `npm run sandboxie:selftest`, `git diff --check`, tracked-secret scan, ignored credential-artifact check, enabled-box/WFP read-back, and parent final diff review.

## 3. Explicit non-goals / residual risks

- Do not claim VM/kernel isolation; Sandboxie remains an app-level boundary.
- Do not attempt a native Windows handle-relative filesystem rewrite in this pass. Reparse rejection plus no file tools during boxed background jobs is immediate mitigation; a hostile same-user external process can still create pathname races.
- Do not automatically recover stale WFP leases after a hard kill. Fail closed and require operator cleanup/self-test.
- Do not redesign all 143 GIS/agent graders in one pass. Add honest labels and validation guidance; task-specific artifact/numeric graders remain a dedicated future benchmark-hardening milestone.
- Do not perform paid model comparisons or rotate credentials during implementation.
- Do not commit or push without a new explicit user request.

## 4. Validation contract

Completion requires:

- No regression in strict Sandboxie setup, live deny probes, PID ownership, cleanup, or private-eval ordering.
- Every accepted P0/P1 item above is implemented or explicitly documented as residual with a fail-closed mitigation.
- No tracked or generated persistent plaintext provider file remains.
- Free regression suite passes with exact counts reported.
- Real Sandboxie suite passes and leaves only `DefaultBox` with global `NetworkEnableWFP` restored.
- Final report distinguishes implemented fixes, deferred benchmark-hardening, and remaining app-level/OS risks.

## 5. Plan review record

The parent performs two reviews before editing source:

1. **Security/correctness review (completed):** the first pass found four plan gaps: evaluator verification needed explicit process-quiescence language; the WFP lease needed stale-lock diagnostics; ephemeral provider composition had to preserve routed-model availability; and strict exchange-only artifacts made verdict/replay tools unable to see expected episodes. The plan now requires durable sanitized episode records plus these safeguards.
2. **Completeness/testability review (completed):** the second pass found that the plan did not distinguish valid scores with post-submit model failures, omitted the known geology option-parser defect, and left knowledge co-occurrence phrased too causally. B7 and C7 now cover those gaps. The pass also confirmed dependency order (security primitives before lifecycle/report changes), backward-compatible optional state/result fields, deterministic tests before live Sandboxie tests, and an explicit boundary around the deferred native-handle/GIS-grader redesign.

Implementation starts only after both reviews are recorded below and resulting revisions are incorporated.

## 6. Implementation disposition (2026-08-29)

Implemented in this worktree:

- A1–A5: ad-hoc/effective truth protection and probes, pre-eval manifests, cross-process WFP lease, foreground descendant detection, background/file-tool exclusion, reparse rejection, common credential deny/stripping, and ephemeral provider config.
- B1–B7: remaining-time prompt/eval/Python limits, controller propagation, survivor/token gates, finalization checkpoint, fresh-run-name refusal, extension contracts, durable sanitized episode evidence, and warnings separate from invalid fitness.
- C1–C7: `private-only-v2`, weighted exams, exact held-out verdict denominators, routed-model/preflight validation, fail-closed TS reasoning mapping, effective submission hint, evidence manifests, option-parser repair, and non-causal knowledge telemetry/promotion wording.
- D1–D3: expanded deterministic tests, real Sandboxie lease/canary/descendant tests, and `npm run check`.

Deferred exactly as non-goals rather than silently claimed complete:

- native Windows handle-relative file I/O that would eliminate every same-user TOCTOU race;
- dedicated low-privilege/VM execution boundary;
- task-by-task scientific redesign and human calibration of all GIS/LLM-judge proxy graders;
- new paid multi-seed model-quality experiments.

## 7. Final validation evidence

- `npm run check`: passed.
  - TypeScript typecheck passed.
  - `npm run selftest`: **124 passed, 0 failed**.
  - TUI/control suites: **75 passed, 0 failed**.
  - Structure test: `STRUCT_OK` (164 quiz chunks, 629 cache entries, 15 knowledge nodes).
  - Held-out verdict denominator test: `RUN_VERDICT_OK`.
  - Python compileall passed.
- `npm run sandboxie:selftest`: `SANDBOXIE_OK`, including external protected canary, concurrent/stale WFP lease refusal, foreground timeout/exception, declared background cleanup, detached-descendant rejection, box removal, WFP restoration, and lease release.
- External GIS interpreter Sandboxie self-test: `SANDBOXIE_OK` with `F:\\GeoRSI\\venvs\\gis\\Scripts\\python.exe`.
- Provider composition probe: correct inner/outer models resolved; no repository `config/pi-models.json` and no leftover `georsi-models-*` temp directory.
- `npm audit --omit=dev --registry=https://registry.npmjs.org`: 0 vulnerabilities.
- `git diff --check`, changed-diff secret scan, and tracked-tree secret scan passed.
- Final Sandboxie read-back: enabled boxes=`DefaultBox`; global `NetworkEnableWFP` restored to its original empty value; no WFP lease file remained.
