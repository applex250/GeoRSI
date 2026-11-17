#!/usr/bin/env python3
"""Small dependency-direction gate for the TypeScript architecture.

This is deliberately textual rather than a compiler plugin: it catches the
high-value forbidden edges without introducing a new build dependency. Keep it
strict and update it only when an architectural decision is recorded in
`docs/ARCHITECTURE-VIEWS.md`.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN = {
    "src/process-env.ts": ["sandboxie", "provider", "inner/", "tui/"],
    "src/budget.ts": ["provider", "sandboxie", "inner/", "tui/"],
    "src/task-profile.ts": ["provider", "sandboxie", "inner/", "tui/"],
    "src/inner/episode-contract.ts": ["provider", "sandboxie", "piharness"],
    "src/inner/prompt-policy.ts": ["provider", "sandboxie", "piharness", "bench/eval"],
    "src/inner/submission-policy.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:fs"],
    "src/inner/python-execution.ts": ["provider", "sandboxie", "piharness", "bench/eval"],
    "src/inner/background-jobs.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:fs", "node:child_process"],
    "src/inner/artifact-store.ts": ["provider", "sandboxie", "piharness", "bench/eval", "workspace-tools"],
    "src/isolation-probe.ts": ["provider", "sandboxie", "piharness", "inner/solve", "bench/eval"],
    "src/sandboxie-cli.ts": ["provider", "piharness", "inner/", "bench/eval", "node:fs"],
    "src/sandboxie-ini.ts": ["provider", "piharness", "inner/", "bench/eval", "node:fs", "node:child_process"],
    "src/sandboxie-lease.ts": ["provider", "piharness", "inner/", "bench/eval", "node:child_process"],
    "src/sandboxie-cleanup.ts": ["provider", "piharness", "inner/", "bench/eval", "node:"],
    "src/research/contracts.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/work-graph.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:fs", "node:child_process"],
    "src/research/decision-policy.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/failure-taxonomy.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/task-profile.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/event-ledger.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:child_process"],
    "src/research/evidence-store.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:child_process"],
    "src/research/environment-capture.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:fs", "node:child_process"],
    "src/research/artifact-manifest.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:fs", "node:child_process"],
    "src/research/replay.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:child_process"],
    "src/research/scheduler.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/tool-registry.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:fs", "node:child_process"],
    "src/research/context-manager.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:fs", "node:child_process"],
    "src/research/network-tools.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:fs", "node:child_process"],
    "src/research/value-evaluator.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/verifiers/base.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/verifiers/generic.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/verifiers/quantitative.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/verifiers/gis.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/verifiers/literature.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/deliverables.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    # Deterministic draft-shape layer: pure text/JSON transformation, no I/O, no runtime deps.
    "src/research/draft-normalizer.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/deliverable-store.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:child_process"],
    "src/research/strategy-bundle.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:fs", "node:child_process"],
    "src/research/strategy-edits.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/promotion.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/experience-miner.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/token-policy.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/research-evolution.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/scoring.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/orchestrator.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/runtime-attestation.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:fs", "node:child_process"],
    # Workspace tier + experience layer: pure modules stay pure; only extract/store/harvest do I/O.
    "src/research/graph-spec.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/report-links.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/model-resilience.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/mission-synthesizer.ts": ["provider", "sandboxie", "bench/eval", "node:fs", "node:child_process"],
    "src/research/run-budget.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/budget-report.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/experience/schema.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/experience/signature.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:fs", "node:child_process"],
    "src/research/experience/gates.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/experience/approval.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:"],
    "src/research/experience/extract.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:child_process"],
    "src/research/experience/store.ts": ["provider", "sandboxie", "piharness", "bench/eval", "node:child_process"],
    "src/bench/eval.ts": ["../sandboxie.js", "../provider.js", "../inner/"],
    "src/provider.ts": ["./bench/eval.js", "./inner/", "./rsi.js", "./tui/"],
}

errors = []
for rel, needles in FORBIDDEN.items():
    text = (ROOT / rel).read_text(encoding="utf-8")
    import_text = "\n".join(line for line in text.splitlines() if line.lstrip().startswith(("import ", "export ")))
    for needle in needles:
        if needle in import_text:
            errors.append(f"forbidden dependency {rel} -> {needle}")

solve = (ROOT / "src/inner/solve.ts").read_text(encoding="utf-8")
if "as Config" in solve:
    errors.append("inner/solve.ts still bypasses Config with an unchecked cast")

config = (ROOT / "src/config.ts").read_text(encoding="utf-8")
for required in ("ProblemRuntimeOverride", "applyProblemRuntimeOverride", "configuredModelIds"):
    if required not in config:
        errors.append(f"config.ts missing explicit seam: {required}")

rsi_eval = (ROOT / "src/rsi_eval.ts").read_text(encoding="utf-8")
for required in ("executeEpisode?: EpisodeExecutor", "evalCtx?: EvalContext"):
    if required not in rsi_eval:
        errors.append(f"rsi_eval.ts missing injectable application port: {required}")

exam = (ROOT / "src/exam.ts").read_text(encoding="utf-8")
for required in ("interface ExamPorts", "loadRuntime?:", "executeEpisode?: EpisodeExecutor", "evidenceStore?: ExamEvidenceStore"):
    if required not in exam:
        errors.append(f"exam.ts missing injectable application port: {required}")

if errors:
    for error in errors:
        print("ARCH_FAIL:", error)
    raise SystemExit(1)
print("ARCH_OK (policy seams and dependency direction)")
