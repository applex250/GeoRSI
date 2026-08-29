/**
 * GeoRSI research extension for the pi agent.
 *
 * Load with:  pi -e <georsi-repo>/extensions/georsi.ts
 * (any cwd — the engine subprocess always runs from the GeoRSI repo root).
 *
 * Flow (exactly the requested interaction):
 *   1. you land in a NORMAL pi chat — code, files, shell, whatever
 *   2. /research start     -> scaffolds ./research/ in the CURRENT folder with
 *                             template files and explains what goes where
 *   3. you fill statement.md + data/ + private_truth.txt (eval.py works as-is
 *                             for numeric answers; edit for fancier grading)
 *   4. /research run       -> validates + solves YOUR problem with the lab's
 *                             best scaffold, streaming progress into the chat
 *   /research evolve N     -> registers the problem in the lab and runs the
 *                             full self-improvement loop on it for N gens
 *   /research help
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync, appendFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text, hyperlink } from "@earendil-works/pi-tui";
import { pathToFileURL } from "node:url";
import { SUPPORTED_MODELS, modelSpec } from "../src/config.js";
import chalk from "chalk";
import { Type } from "typebox";

const GEORSI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSX_CLI = join(GEORSI_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const RUN_TS = join(GEORSI_ROOT, "src", "run.ts");

// ---------------------------------------------------------------------------
// Scaffold templates (exported pure for the headless check)
// ---------------------------------------------------------------------------

export const STATEMENT_TEMPLATE = `# <your research question title>

## Data
- \`data/\` — <describe each dataset: file, columns, units, what it represents>
- \`data/reference_\` — optional: a reference dataset whose answer is KNOWN
  (the agent validates its pipeline on it before touching the main data)

## Task
1. <step-by-step what you want done: load, clean, method, estimate>
2. <which quantity to estimate / predict>
3. Validate the pipeline on the reference data if provided
4. Write the final answer via the submit tool:
   JSON \`{"answer": <number>}\`

## Grading
score = max(0, 1 - |answer - truth| / (0.25 * |truth|))  — edit eval.py to change.
`;

export const EVAL_TEMPLATE = `"""Score a submission against the private truth.

Works as-is for numeric answers: {"answer": <number>}.
Edit freely for other formats (keep the ##SCORE## marker line).
Usage: python eval.py --submission <path> --split public|private
"""
import argparse, json, os, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--submission", required=True)
    ap.add_argument("--split", default="private")
    a = ap.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    if a.split == "public":
        # put the REFERENCE truth here (a number the agent may know)
        truth = float(open(os.path.join(script_dir, "reference_truth.txt")).read().strip())
    else:
        truth_file = os.environ.get("RSILAB_PRIVATE_TRUTH",
                                    os.path.join(script_dir, "private_truth.txt"))
        truth = float(open(truth_file).read().strip())

    try:
        sub = json.load(open(a.submission))
        v = abs(float(sub["answer"]))
    except Exception as e:
        print("##SCORE##0"); print(json.dumps({"error": f"parse fail: {e}"})); return

    score = max(0.0, 1.0 - abs(v - truth) / (0.25 * abs(truth) + 1e-9))
    print(f"##SCORE##{score:.4f}")
    print(json.dumps({"fitness": round(score, 4), "answer": v, "truth": truth}))

if __name__ == "__main__":
    main()
`;

export function scaffoldResearch(dir: string): string[] {
	const created: string[] = [];
	const mk = (rel: string, content: string) => {
		const p = join(dir, rel);
		if (!existsSync(p)) {
			writeFileSync(p, content);
			created.push(rel);
		}
	};
	mkdirSync(join(dir, "data"), { recursive: true });
	mk("statement.md", STATEMENT_TEMPLATE);
	mk("eval.py", EVAL_TEMPLATE);
	mk("private_truth.txt", "# single number: the true answer for the MAIN data (agent never sees this)\n42\n");
	mk("reference_truth.txt", "# single number: the true answer for the REFERENCE data (public, agent may see it)\n");
	mk("data/PUT_YOUR_DATASETS_HERE.txt",
		"Put your dataset files here (CSV etc). Describe each file in statement.md.\n" +
			"A reference_* dataset with known answer is optional but improves quality.\n");
	return created;
}

export interface ValidationResult {
	ok: boolean;
	errors: string[];
	warnings: string[];
}

export function validateResearch(dir: string): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	if (!existsSync(join(dir, "statement.md"))) errors.push("statement.md missing (still the template path? run /research start)");
	if (!existsSync(join(dir, "eval.py"))) errors.push("eval.py missing");
	const st = existsSync(join(dir, "statement.md")) ? readFileSync(join(dir, "statement.md"), "utf8") : "";
	if (st.includes("<your research question title>")) errors.push("statement.md is still the unfilled template");
	if (!existsSync(join(dir, "private_truth.txt"))) warnings.push("private_truth.txt missing — private scoring will fail");
	else if (readFileSync(join(dir, "private_truth.txt"), "utf8").trim().startsWith("#"))
		warnings.push("private_truth.txt still has only a comment — put the real number there");
	if (!existsSync(join(dir, "reference_truth.txt"))) warnings.push("reference_truth.txt missing — public grading will fail");
	else if (readFileSync(join(dir, "reference_truth.txt"), "utf8").trim().startsWith("#"))
		warnings.push("reference_truth.txt still has only a comment — put the public reference answer there");
	const dataDir = join(dir, "data");
	if (!existsSync(dataDir) || readdirSafe(dataDir).length === 0)
		warnings.push("data/ is empty — the agent will have nothing to analyze (fine for pure-theory questions)");
	return { ok: errors.length === 0, errors, warnings };
}

function readdirSafe(p: string): string[] {
	try {
		return readdirSync(p).filter((f) => !f.startsWith("PUT_YOUR"));
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Subprocess: run the GeoRSI engine CLI, stream stdout lines back
// ---------------------------------------------------------------------------

interface SpawnResult {
	code: number;
	tail: string[];
}

export function runEngine(
	args: string[],
	onLine: (line: string) => void,
): Promise<SpawnResult> {
	return new Promise((resolveP) => {
		const child = spawn(process.execPath, [TSX_CLI, RUN_TS, ...args], {
			cwd: GEORSI_ROOT,
			env: { ...process.env, PYTHONIOENCODING: "utf-8" },
			windowsHide: true,
		});
		const tail: string[] = [];
		const eat = (d: Buffer) => {
			for (const line of d.toString("utf8").split(/\r?\n/)) {
				if (!line.trim()) continue;
				onLine(line);
				tail.push(line);
				if (tail.length > 20) tail.shift();
			}
		};
		child.stdout.on("data", eat);
		child.stderr.on("data", eat);
		child.on("error", (e) => resolveP({ code: 1, tail: [...tail, `spawn failed: ${e.message}`] }));
		child.on("close", (code) => resolveP({ code: code ?? 1, tail }));
	});
}

/** Register the problem into the lab (problems/<id>/ + private truth) for evolve. */
function registerInLab(dir: string, idHint: string): { id: string; warnings: string[] } {
	const warnings: string[] = [];
	const id = idHint.replace(/[^a-z0-9_-]+/gi, "_").toLowerCase() || "research";
	const dst = join(GEORSI_ROOT, "problems", id);
	mkdirSync(join(dst, "data"), { recursive: true });
	copyFileSync(join(dir, "statement.md"), join(dst, "statement.md"));
	copyFileSync(join(dir, "eval.py"), join(dst, "eval.py"));
	const referenceTruth = join(dir, "reference_truth.txt");
	if (existsSync(referenceTruth)) {
		copyFileSync(referenceTruth, join(dst, "reference_truth.txt"));
	} else {
		warnings.push("reference_truth.txt is missing; public grading cannot validate the registered problem");
	}
	// copy datasets (skip the placeholder)
	for (const f of readdirSafe(join(dir, "data"))) {
		try {
			copyFileSync(join(dir, "data", f), join(dst, "data", f));
		} catch {
			warnings.push(`could not copy data/${f}`);
		}
	}
	// private truth -> outside the lab tree
	const truthSrc = join(dir, "private_truth.txt");
	const truthDir = join(GEORSI_ROOT, "..", "rsi-lab-private");
	if (existsSync(truthSrc)) {
		try {
			mkdirSync(truthDir, { recursive: true });
			copyFileSync(truthSrc, join(truthDir, `${id}.txt`));
		} catch {
			warnings.push("could not copy private truth into rsi-lab-private");
		}
	}
	return { id, warnings };
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

const RESEARCH_DIR = () => join(process.cwd(), "research");

const INSTRUCTIONS = [
	"GeoRSI auto-research scaffold is ready in ./research/:",
	"",
	"  research/statement.md       ← WRITE YOUR PROBLEM HERE (replace the template)",
	"                                describe: data files, task steps, what to estimate",
	"  research/data/              ← PUT YOUR DATASETS HERE (CSV/JSON...)",
	"                                optional: reference_* data with a KNOWN answer",
	"  research/private_truth.txt  ← THE TRUE ANSWER for the main data (one number;",
	"                                under Windows strict Sandboxie the agent cannot see",
	"                                this file; host-audit is compatibility-only, not confidentiality.",
	"  research/eval.py            ← grading script; works as-is for {\"answer\": number}",
	"                                submissions; edit the formula for other formats",
	"  research/reference_truth.txt← truth of the reference dataset (public/visible)",
	"",
	"When done, send:  /research run        (solve once with the lab's best strategy)",
	"            or:   /research evolve 3   (self-improvement loop, 3 generations)",
].join("\n");

// ---------------------------------------------------------------------------
// Engine display state machine (exported for headless tests)
// ---------------------------------------------------------------------------

export interface EngineDisplay {
	pushLine: (line: string) => void;
	flushThinking: () => void;
	/** path of the current run's stream.log (set from SYS|stream lines) */
	lastStreamLog: string;
	/** when true, thinking streams expanded (white) instead of collapsed */
	liveExpanded: boolean;
}

export function createEngineDisplay(
	append: (lines: string[]) => void,
	setLabel: (label: string) => void,
): EngineDisplay {
	let thinkChars = 0;
	let thinkPreview = "";
	let thinkBlockNo = 0;
	const d: EngineDisplay = {
		lastStreamLog: "",
		liveExpanded: false,
		flushThinking(): void {
			if (thinkChars > 0) {
				thinkBlockNo += 1;
				const label =
					`▸ [#${thinkBlockNo}] thinking (${thinkChars} chars): ${thinkPreview.slice(0, 70)}${thinkChars > 70 ? "…" : ""}` +
					`  (click: full log · /research think)`;
				// OSC 8 hyperlink: a real mouse click opens stream.log in the default
				// editor (pi-tui has no in-component click events; this is the one
				// click path terminals give us)
				const shown = d.lastStreamLog
					? hyperlink(chalk.gray(label), pathToFileURL(d.lastStreamLog).href)
					: chalk.gray(label);
				append([shown]);
				thinkChars = 0;
				thinkPreview = "";
			}
		},
		pushLine(line: string): void {
			if (line.startsWith("THINK|")) {
				const t = line.slice(6);
				thinkChars += t.length;
				if (thinkPreview.length < 80) thinkPreview += (thinkPreview ? " " : "") + t;
				setLabel(`thinking… ${thinkPreview.slice(0, 50)}`);
				if (d.liveExpanded) append([chalk.white(`· ${t}`)]);
				return; // collapsed mode accumulates without transcript entries
			}
			d.flushThinking(); // any other line closes the thinking block
			if (line.startsWith("SYS|stream: ")) {
				d.lastStreamLog = line.slice("SYS|stream: ".length).trim();
				return; // bookkeeping only
			}
			if (line.startsWith("TEXT|")) {
				setLabel(line.slice(5).slice(0, 60));
				append([chalk.white(line.slice(5))]);
			} else if (line.startsWith("TOOLC|")) {
				const [name, argsSum] = line.slice(6).split("|");
				setLabel(`tool ${name}`);
				append([chalk.cyan(`⚙ ${name}(${argsSum ?? ""})`)]);
			} else if (line.startsWith("TOOLR|")) {
				const [name, status, ...rest] = line.slice(6).split("|");
				setLabel(`tool ${name} done`);
				append([chalk.cyan(`↳ ${name} ${status === "err" ? chalk.red("ERROR") : "→"} ${rest.join("|").slice(0, 180)}`)]);
			} else {
				const t = line.startsWith("SYS|") ? line.slice(4) : line;
				setLabel(t.slice(0, 60));
				append([chalk.red(t)]);
			}
		},
	};
	return d;
}

/**
 * Create the run directory and the (empty) control file the engine will
 * watch. Must run BEFORE the engine spawns — fs.watchFile cannot watch a file
 * that never exists, and the engine only creates the dir itself later.
 */
export function prepareRunPaths(runName: string): { runDir: string; controlPath: string } {
	const runDir = join(GEORSI_ROOT, "runs", runName);
	mkdirSync(runDir, { recursive: true });
	const controlPath = join(runDir, "control.json");
	writeFileSync(controlPath, "");
	return { runDir, controlPath };
}

export default function georsiExtension(pi: ExtensionAPI): void {
	pi.registerEntryRenderer("georsi-log", (entry) => {
		const lines = (entry.data as { lines?: string[] }).lines ?? [];
		return new Text(lines.join("\n"), 1, 0);
	});

	// ---- chat-facing tools: let the MAIN agent answer questions about the
	// research run and control it conversationally ---------------------------
	const stripAnsiExt = (s: string): string =>
		s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x1b]*(\x07|\x1b\\)/g, "");

	/** Human-readable snapshot of the research run (tool result). */
	const buildStatusText = (): string => {
		const parts: string[] = [];
		if (activeRun) {
			parts.push(
				`run: ${activeRun.runName} (${activeRun.mode} mode) — RUNNING`,
				`current activity: ${stripAnsiExt(liveLabel) || "working"}`,
			);
		} else {
			parts.push("no run is currently active");
		}
		// recent submissions from the stream log (public scores)
		const logPath = display.lastStreamLog;
		if (logPath && existsSync(logPath)) {
			try {
				const lines = readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean);
				const submits = lines.filter((l) => l.startsWith("TOOLR|submit|"));
				if (submits.length > 0) {
					parts.push(
						`submissions so far (${submits.length}): ` +
							submits
								.slice(-5)
								.map((l) => {
									const m = /public score ([\d.]+)/.exec(l);
									return m ? m[1] : "?";
								})
								.join(", "),
					);
				}
				const turns = lines.filter((l) => /^\[.*\] turn \d+/.test(l.replace(/^SYS\|/, "")) || l.startsWith("SYS|") && l.includes("turn ")).length;
				if (turns > 0) parts.push(`agent turns so far: ~${turns}`);
				parts.push(`recent activity (last 8 events):`);
				parts.push(
					...lines
						.slice(-8)
						.map((l) => "  " + stripAnsiExt(l.replace(/^(SYS|THINK|TEXT|TOOLC|TOOLR)\|/, "[$1] ")).slice(0, 150)),
				);
				parts.push(`full log for deep analysis: ${logPath}`);
				parts.push(
					`agent workspace (analysis code it wrote): ${join(dirname(logPath))}`,
				);
			} catch {
				/* log unreadable — skip */
			}
		}
		parts.push(
			activeRun
				? `control: ask me to pause/resume/stop the research, or give feedback for its next step — I will use the research_control tool. Slash commands work too: /research pause|resume|stop|feedback|status`
				: `start a run with /research run (or /research evolve N); last artifacts live under ${join(GEORSI_ROOT, "runs")}`,
		);
		return parts.join("\n");
	};

	pi.registerTool({
		name: "research_status",
		label: "Research status",
		description:
			"Current GeoRSI auto-research status: active run, current activity, submission scores, recent events, and paths to the full log/workspace. Call this whenever the user asks about the automated research (进展/状态/在做什么/分析当前情况), then answer conversationally — you may also read the log file yourself for deeper analysis.",
		parameters: Type.Object({}),
		execute: async () => ({
			content: [{ type: "text" as const, text: buildStatusText() }],
			details: {},
		}),
	});

	pi.registerTool({
		name: "research_control",
		label: "Research control",
		description:
			"Control the running GeoRSI research: pause / resume / stop (graceful, saves state) or send feedback text that the next generation reads. Use when the user asks to pause/stop/resume the research or steer its direction.",
		parameters: Type.Object({
			action: Type.Union([Type.Literal("pause"), Type.Literal("resume"), Type.Literal("stop"), Type.Literal("feedback")]),
			text: Type.Optional(Type.String({ description: "feedback text (required for action=feedback)" })),
		}),
		execute: async (_id, params) => {
			if (params.action === "feedback") {
				const text = (params.text ?? "").trim();
				if (!text) {
					return { content: [{ type: "text" as const, text: "feedback action needs text" }], details: {} };
				}
				const fbDir = activeRun?.runDir ?? join(GEORSI_ROOT, "runs", "rsi-live");
				const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
				appendFileSync(join(fbDir, "FEEDBACK.md"), `\n[chat ${stamp}] ${text}\n`);
				pushLog(`feedback: ${text}`);
				return {
					content: [{ type: "text" as const, text: `feedback recorded${activeRun ? " — the next generation will read it" : " (no active run; kept for the next one)"}` }],
					details: {},
				};
			}
			if (!activeRun) {
				return { content: [{ type: "text" as const, text: "no active run to control" }], details: {} };
			}
			writeFileSync(activeRun.controlPath, JSON.stringify({ action: params.action, ts: new Date().toISOString() }));
			pushLog(`control: ${params.action}`);
			const hint =
				params.action === "pause" ? "pausing at the next safe point"
				: params.action === "resume" ? "resuming"
				: "stopping gracefully after the current episode (resumable)";
			return { content: [{ type: "text" as const, text: `${params.action} sent — ${hint}` }], details: {} };
		},
	});

	// ---- live display state (spinner widget above editor) ------------------
	const SPIN_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]; // reused from HeaderPanel
	let spinIdx = 0;
	let spinTimer: ReturnType<typeof setInterval> | null = null;
	let liveLabel = "";
	let liveCtx: ExtensionCommandContext | null = null;
	// pi rebuilds extension contexts as sessions/turns change; the ctx captured
	// by a command handler goes stale (assertActive throws). Event handlers get
	// a fresh ctx every time, so keep the latest one for widget updates.
	let latestCtx: { ui: { setWidget: (k: string, c: string[] | undefined, o?: unknown) => void }; notify?: (m: string) => void } | null = null;
	// rolling tail of recent activity for the persistent monitor panel
	const monitorLines: string[] = [];
	const MONITOR_MAX = 9; // +1 header = pi's 10-line widget cap
	const remember = (line: string): void => {
		if (!line) return;
		monitorLines.push(line.length > 200 ? line.slice(0, 200) : line);
		if (monitorLines.length > MONITOR_MAX) monitorLines.shift();
	};
	const widgetContent = (): string[] => [
		chalk.cyan.bold(`⠄ georsi ${activeRun ? `· ${activeRun.mode} · ${activeRun.runName}` : ""} ${SPIN_FRAMES[spinIdx]!} ${liveLabel || ""}`),
		...monitorLines,
	];
	const widgetCtx = () => latestCtx ?? liveCtx;
	const PANEL_PLACEMENT = { placement: "belowEditor" as const };
	const refreshWidget = (): void => {
		try {
			widgetCtx()?.ui.setWidget("georsi-live", activeRun ? widgetContent() : undefined, PANEL_PLACEMENT);
		} catch {
			/* stale context — the next event refresh will retry */
		}
	};
	const startSpinner = (ctx: typeof liveCtx): void => {
		liveCtx = ctx;
		refreshWidget();
		if (!spinTimer) {
			spinTimer = setInterval(() => {
				spinIdx = (spinIdx + 1) % SPIN_FRAMES.length;
				refreshWidget();
			}, 140);
		}
	};
	const stopSpinner = (final?: string): void => {
		if (spinTimer) {
			clearInterval(spinTimer);
			spinTimer = null;
		}
		if (final) remember(final);
		try {
			widgetCtx()?.ui.setWidget("georsi-live", final ? [chalk.green(`✓ ${final}`)] : undefined, PANEL_PLACEMENT);
		} catch {
			/* stale */
		}
		liveCtx = null;
		liveLabel = "";
	};

	// the run currently driven by this chat (set during run/evolve)
	let activeRun: { runName: string; runDir: string; controlPath: string; mode: "solve" | "evolve" } | null = null;

	// ---- transcript entries (state machine in the exported factory above) --
	// Research streaming does NOT touch the main transcript anymore: every
	// classified line (already colored by the factory) lands in the bottom
	// monitor panel only. The chat stays clean for real conversation.
	const display = createEngineDisplay(
		(lines) => {
			for (const l of lines) remember(l);
			refreshWidget();
		},
		(label) => {
			liveLabel = label;
		},
	);
	const pushEngineLine = display.pushLine;
	const flushThinking = display.flushThinking;
	const getStreamLog = (): string => display.lastStreamLog;
	const setLiveExpanded = (v: boolean): void => {
		display.liveExpanded = v;
	};
	const isLiveExpanded = (): boolean => display.liveExpanded;
	// milestones also go to the panel (red), never the transcript
	const pushLog = (line: string): void => {
		flushThinking();
		remember(chalk.red(line));
		refreshWidget();
	};

	// fresh contexts from pi lifecycle events (the command ctx goes stale)
	const captureCtx = (c: unknown): void => {
		if (c && typeof c === "object" && "ui" in (c as object)) latestCtx = c as typeof latestCtx;
	};
	try {
		pi.on("session_start", (_ev, ctx) => captureCtx(ctx));
		pi.on("turn_start", (_ev, ctx) => captureCtx(ctx));
		pi.on("session_info_changed", (_ev, ctx) => captureCtx(ctx));
		pi.on("message_start", (_ev, ctx) => captureCtx(ctx));
	} catch {
		/* events unavailable in this pi version — widget falls back to liveCtx */
	}

	/** Detached engine run: called with void from the command handler. */
	const executeResearchRun = async (dir: string, isEvolve: boolean, gens: number): Promise<void> => {
		const runName = `research-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
		const { runDir, controlPath } = prepareRunPaths(runName);
		activeRun = { runName, runDir, controlPath, mode: isEvolve ? "evolve" : "solve" };
		refreshWidget();
		let res: SpawnResult | null = null;
		let temporaryConfig: string | null = null;
		try {
			if (isEvolve) {
				const reg = registerInLab(dir, "research_" + Date.now().toString(36));
				for (const w of reg.warnings) pushLog(`warn: ${w}`);
				const cfg = JSON.parse(readFileSync(join(GEORSI_ROOT, "config.json"), "utf8")) as { problems: unknown[] };
				cfg.problems = [{ id: reg.id }];
				const tmpCfg = join(GEORSI_ROOT, "config", `research-${reg.id}.json`);
				temporaryConfig = tmpCfg;
				writeFileSync(tmpCfg, JSON.stringify(cfg));
				res = await runEngine(
					["rsi", "--config", tmpCfg, "--gens", String(gens), "--run-name", runName, "--control", controlPath],
					(l) => pushEngineLine(l),
				);
			} else {
				const champion = join(GEORSI_ROOT, "runs", "rsi-live", "champion_scaffold.json");
				res = await runEngine(
					[
						"exam",
						"--problem-dir",
						dir,
						"--run-name",
						runName,
						"--control",
						controlPath,
						...(existsSync(champion) ? ["--scaffold", champion] : []),
					],
					(l) => pushEngineLine(l),
				);
			}
		} catch (e) {
			pushLog(`engine error: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			if (temporaryConfig) rmSync(temporaryConfig, { force: true });
			flushThinking();
			const finalLine = res?.tail.find((l) => l.includes("RESEARCH RESULT") || l.includes("DONE best="));
			stopSpinner(finalLine?.replace(/^(SYS|)\|?/, "") ?? "done");
			activeRun = null;
		}
		if (!res) {
			pushLog("engine crashed before producing output — see the log entries above");
			return;
		}
		const final = res.tail.find((l) => l.includes("RESEARCH RESULT") || l.includes("DONE best=")) ?? res.tail[res.tail.length - 1] ?? "(no output)";
		try {
			widgetCtx()?.ui?.setWidget;
			(latestCtx as { ui?: { notify?: (m: string) => void } } | null)?.ui?.notify?.(
				res.code === 0 ? `✓ georsi finished: ${final.replace(/^SYS\|/, "")}` : `georsi finished with issues (exit ${res.code})`,
			);
		} catch {
			/* notify unavailable — the log entry carries the result */
		}
		pushLog(final.replace(/^(SYS|)\|?/, ""));
		pushLog(`full artifacts: ${join(GEORSI_ROOT, "runs")} (episodes/, board.jsonl, RESULTS.md)`);
	};

	pi.registerCommand("research", {
		description: "GeoRSI: start | run | evolve N | pause/resume/stop | feedback <t> | think | model | status | help",
		handler: async (args, ctx) => {
			const [sub, ...rest] = args.trim().split(/\s+/);
			const dir = RESEARCH_DIR();
			switch ((sub ?? "help").toLowerCase()) {
				case "start": {
					const created = scaffoldResearch(dir);
					ctx.ui.notify(created.length ? `created ${created.length} files under ./research/` : "./research/ already scaffolded");
					pi.appendEntry("georsi-log", { lines: INSTRUCTIONS.split("\n") });
					return;
				}
				case "pause":
				case "resume":
				case "stop": {
					// mid-run control via the engine's control file
					if (!activeRun) {
						ctx.ui.notify(`no active run — start one with /research run or /research evolve`);
						return;
					}
					const action = sub!.toLowerCase() as "pause" | "resume" | "stop";
					writeFileSync(activeRun.controlPath, JSON.stringify({ action, ts: new Date().toISOString() }));
					const hint =
						action === "pause" ? "pausing at the next safe point (episode/turn boundary)"
						: action === "resume" ? "resuming"
						: "stopping gracefully after the current episode (state saved; resumable)";
					ctx.ui.notify(`✓ ${action} sent — ${hint}`);
					pushLog(`control: ${action}`);
					return;
				}
				case "feedback": {
					// steer the NEXT generation of a running evolve (or record intent)
					const text = rest.join(" ").trim();
					if (!text) {
						ctx.ui.notify("usage: /research feedback <what to focus on next>");
						return;
					}
					const fbDir = activeRun?.runDir ?? join(GEORSI_ROOT, "runs", "rsi-live");
					const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
					appendFileSync(join(fbDir, "FEEDBACK.md"), `\n[chat ${stamp}] ${text}\n`);
					ctx.ui.notify(`✓ feedback recorded${activeRun ? " — read by the next generation" : " (no active run; noted for the next one)"}`);
					pushLog(`feedback: ${text}`);
					return;
				}
				case "status": {
					ctx.ui.notify(
						activeRun
							? `${activeRun.mode} · ${activeRun.runName} · ${liveLabel || "working"} (panel below shows the stream; /research pause|resume|stop)`
							: "no active run — the monitor panel below shows the last result",
					);
					refreshWidget();
					return;
				}
				case "run":
				case "evolve": {
					const v = existsSync(dir) ? validateResearch(dir) : { ok: false, errors: ["./research/ not found — run /research start first"], warnings: [] };
					if (!v.ok) {
						ctx.ui.notify(`cannot start: ${v.errors.join("; ")}`);
						return;
					}
					if (activeRun) {
						ctx.ui.notify(`a run is already active (${activeRun.runName}) — /research stop it first`);
						return;
					}
					for (const w of v.warnings) pushLog(`warn: ${w}`);
					const isEvolve = sub === "evolve";
					const gens = isEvolve ? Number(rest[0] ?? 3) : 0;
					ctx.ui.notify(
						`${isEvolve ? `evolving (${gens} generations)` : "solving"} started in the background — chat stays usable; /research status · pause · stop`,
					);
					pushLog(`── georsi engine: ${isEvolve ? `evolve x${gens}` : "single solve"} ──`);
					// CRITICAL: pi awaits command handlers inside the prompt
					// pipeline, so a handler that awaits a multi-minute engine
					// run freezes the chat input. Return immediately and run
					// detached; streaming continues via appendEntry + widget.
					startSpinner(ctx);
					void executeResearchRun(dir, isEvolve, gens);
					return;
				}
				case "think": {
					// /research think        -> expand ALL thinking of the last run (white)
					// /research think live   -> toggle: stream future thinking expanded
					if (rest[0]?.toLowerCase() === "live") {
						setLiveExpanded(!isLiveExpanded());
						ctx.ui.notify(
							`live thinking display: ${isLiveExpanded() ? "EXPANDED (white, every line)" : "collapsed (summary lines)"} — applies to the next /research run`,
						);
						return;
					}
					if (!getStreamLog() || !existsSync(getStreamLog())) {
						ctx.ui.notify("no thinking recorded yet — run /research run first");
						return;
					}
					const rawBlocks: { lines: string[]; closed: boolean }[] = [];
					for (const l of readFileSync(getStreamLog(), "utf8").split(/\r?\n/)) {
						if (l.startsWith("THINK|")) {
							if (rawBlocks.length === 0 || rawBlocks[rawBlocks.length - 1]!.closed) rawBlocks.push({ lines: [], closed: false });
							rawBlocks[rawBlocks.length - 1]!.lines.push(l.slice(6));
						} else if (rawBlocks.length > 0) {
							rawBlocks[rawBlocks.length - 1]!.closed = true;
						}
					}
					const valid = rawBlocks.filter((b) => b.lines.length > 0);
					if (valid.length === 0) {
						ctx.ui.notify("the last run produced no thinking blocks");
						return;
					}
					for (const [i, b] of valid.entries()) {
						const lines = b.lines;
						pi.appendEntry("georsi-log", {
							lines: [
								chalk.gray(`▾ thinking block #${i + 1} (${lines.length} lines) — expanded`),
								...lines.slice(0, 40).map((l) => chalk.white(`  ${l}`)),
								...(lines.length > 40 ? [chalk.gray(`  … ${lines.length - 40} more lines in ${getStreamLog()}`)] : []),
							],
						});
					}
					ctx.ui.notify(`expanded ${valid.length} thinking blocks from the last run`);
					return;
				}
				case "model": {
					const liveModels = SUPPORTED_MODELS.filter((model) => !model.retired);
					// /research model                -> show current + supported list
					// /research model inner <id>     -> set the researcher model
					// /research model outer <id>     -> set the evolver model
					const cfgPath = join(GEORSI_ROOT, "config.json");
					const cfgNow = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
					if (!rest[0] || rest[0] === "show") {
						pi.appendEntry("georsi-log", {
							lines: [
								`inner (researcher): ${cfgNow.inner_model}`,
								`outer (evolver):    ${cfgNow.outer_model}`,
								"",
								"supported models:",
								...liveModels.map(
									(m) => `  ${m.id.padEnd(28)} ${m.route === "proxy" ? "proxy " : "direct"}  ${m.note}`,
								),
								"",
								"switch: /research model inner <id>   |   /research model outer <id>",
								"takes effect on the next /research run or evolve",
							],
						});
						return;
					}
					const role = rest[0]!.toLowerCase();
					if (role !== "inner" && role !== "outer") {
						ctx.ui.notify(`usage: /research model [inner|outer] <id> — got "${rest[0]}"`);
						return;
					}
					const id = rest[1];
					if (!id) {
						ctx.ui.notify(`which model? choose: ${liveModels.map((m) => m.id).join(", ")}`);
						return;
					}
					const spec = modelSpec(id);
					if (!spec || spec.retired) {
						ctx.ui.notify(`unknown or retired model "${id}" — choose: ${liveModels.map((m) => m.id).join(", ")}`);
						return;
					}
					if (spec.endpoint === "local") {
						pushLog(`note: ${id} is the campus-local server — it must be running when you launch`);
					}
					if (spec.route === "proxy") {
						pushLog(`note: ${id} routes via the env proxy (needs HTTPS_PROXY set)`);
					}
					cfgNow[`${role}_model`] = id;
					writeFileSync(cfgPath, JSON.stringify(cfgNow, null, "\t") + "\n");
					ctx.ui.notify(`✓ ${role} model -> ${id} (effective on next run)`);
					pushLog(`model switched: ${role}=${id}`);
					return;
				}
				case "help":
				default:
					pi.appendEntry("georsi-log", {
						lines: [
							"/research start    scaffold ./research/ in the current folder (templates + instructions)",
							"/research run      validate + solve your problem once (best lab strategy)",
							"/research evolve N register the problem + run the self-improvement loop for N generations",
						"/research model [inner|outer] <id>   show or switch engine models",
						"/research think [live]              expand last run thinking / toggle live display",
							"",
							...INSTRUCTIONS.split("\n").slice(2),
						],
					});
					return;
			}
		},
	});
}
