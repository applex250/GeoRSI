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
    "src/isolation-probe.ts": ["provider", "sandboxie", "piharness", "inner/solve", "bench/eval"],
    "src/sandboxie-cli.ts": ["provider", "piharness", "inner/", "bench/eval", "node:fs"],
    "src/sandboxie-ini.ts": ["provider", "piharness", "inner/", "bench/eval", "node:fs", "node:child_process"],
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

if errors:
    for error in errors:
        print("ARCH_FAIL:", error)
    raise SystemExit(1)
print("ARCH_OK (policy seams and dependency direction)")
