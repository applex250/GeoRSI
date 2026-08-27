/**
 * GeoRSI CLI.
 *
 *   npx tsx src/run.ts selftest            # no-LLM unit tests of core logic
 *   npx tsx src/run.ts smoke               # 1 tiny live episode (quake_b, 2 turns)
 *   npx tsx src/run.ts exam [--scaffold path]  # full suite exam incl. held-out
 *   npx tsx src/run.ts rsi [--gens N] [--resume] [--run-name NAME]
 */
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ROOT } from "./config.js";
import { selftest } from "./selftest.js";
import { runRsi } from "./rsi.js";
import { runExam } from "./exam.js";
import { SEED_SCAFFOLD, type Scaffold } from "./scaffold.js";
import { TOKENS } from "./provider.js";

function parseArgs(argv: string[]): Record<string, string | boolean | undefined> {
	const out: Record<string, string | boolean | undefined> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i]!;
		if (a.startsWith("--")) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next && !next.startsWith("--")) {
				out[key] = next;
				i += 1;
			} else {
				out[key] = true;
			}
		} else {
			out._cmd = a;
		}
	}
	return out;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const cmd = String(args._cmd ?? "rsi");
	const cfg = loadConfig(args.config ? String(args.config) : undefined);

	if (cmd === "selftest") {
		const ok = await selftest();
		process.exit(ok ? 0 : 1);
	}

	if (cmd === "smoke") {
		const { getPiRuntime } = await import("./provider.js");
		const { inner } = await getPiRuntime(cfg, ROOT);
		const { solveEpisode } = await import("./inner/solve.js");
		const { loadProblems, makeEvalContext } = await import("./bench/eval.js");
		const { openMemory } = await import("./memory.js");
		const smokeCfg = { ...cfg, max_turns: 3, eval_cap: 2, episode_timeout_s: 720 };
		const problems = loadProblems(smokeCfg, ROOT, false);
		const problem = problems[0]!;
		const runDir = join(ROOT, "runs", "smoke");
		const t0 = Date.now();
		const res = await solveEpisode({
			cfg: smokeCfg,
			problem,
			evalCtx: makeEvalContext(cfg, ROOT),
			scaffold: SEED_SCAFFOLD,
			model: inner,
			workspace: join(runDir, "episode"),
			memory: openMemory(runDir),
			tag: "smoke",
			log: (m) => console.log(m),
		});
		console.log(
			`\nSMOKE RESULT: fitness=${res.fitness ?? "null"} public=${res.bestPublic ?? "null"} ` +
				`submits=${res.submits} turns=${res.turns} tokens=${res.tokens} secs=${Math.round((Date.now() - t0) / 1000)} ` +
				`error=${res.error ?? "none"}`,
		);
		process.exit(res.fitness != null ? 0 : 2);
	}

	if (cmd === "exam") {
		// ad-hoc mode: solve ONE user-scaffolded problem from any directory
		// (used by the /research pi extension); bypasses the config suite
		if (args["problem-dir"]) {
			const problemDir = String(args["problem-dir"]);
			const { loadAdHocProblem } = await import("./bench/eval.js");
			const adhoc = loadAdHocProblem(problemDir);
			for (const w of adhoc.warnings) console.log(`WARN: ${w}`);
			let scaffold: Scaffold = SEED_SCAFFOLD;
			if (args.scaffold && existsSync(String(args.scaffold))) {
				scaffold = JSON.parse(readFileSync(String(args.scaffold), "utf8")) as Scaffold;
			}
			const { getPiRuntime } = await import("./provider.js");
			const { solveEpisode } = await import("./inner/solve.js");
			const { makeEvalContext } = await import("./bench/eval.js");
			const { openMemory } = await import("./memory.js");
			const { inner } = await getPiRuntime(cfg, ROOT);
			const evalCtx = {
				...makeEvalContext(cfg, ROOT),
				truthFile: () => adhoc.truthPath,
			};
			const runName = args["run-name"] ? String(args["run-name"]) : `research-${adhoc.problem.id}-${Date.now()}`;
			const runDir = join(ROOT, "runs", runName);
			mkdirSync(join(runDir, "episode"), { recursive: true });
			const streamLog = join(runDir, "episode", "stream.log");
			// stream protocol consumed by the /research extension:
			//   SYS|system line   THINK|reasoning line   TEXT|narration line
			//   TOOLC|name|args   TOOLR|name|ok|result-tail
			const out = (kind: "SYS" | "THINK" | "TEXT" | "TOOLC" | "TOOLR", text: string): void => {
				const line = `${kind}|${text}`;
				console.log(line);
				appendFileSync(streamLog, line + "\n");
			};
			// file control channel (pause/resume/stop between turns) — the pi
			// extension writes JSON commands here while the episode runs
			const { RunController } = await import("./loopctl.js");
			const controller = new RunController((m) => out("SYS", m));
			const controlPath = args.control ? String(args.control) : join(runDir, "control.json");
			controller.attachControlFile(controlPath);
			// coalesce model deltas into readable lines (newline / size / time)
			let buf = "";
			let bufKind: "thinking" | "text" = "text";
			let flushTimer: ReturnType<typeof setTimeout> | null = null;
			const flush = (force = false): void => {
				if (!buf) return;
				if (force || buf.includes("\n") || buf.length >= 160) {
					for (const l of buf.split(/\r?\n/)) {
						const t = l.trim();
						if (t) out(bufKind === "thinking" ? "THINK" : "TEXT", t);
					}
					buf = "";
				}
			};
			const onDelta = (kind: "thinking" | "text", delta: string): void => {
				if (kind !== bufKind) {
					flush(true);
					bufKind = kind;
				}
				buf += delta;
				flush();
				if (!flushTimer && buf) {
					flushTimer = setTimeout(() => {
						flushTimer = null;
						flush(true);
					}, 1500);
				}
			};
			const onToolEvent = (ev: { phase: "start" | "end"; tool: string; detail: string; isError?: boolean }): void => {
				flush(true);
				if (ev.phase === "start") out("TOOLC", `${ev.tool}|${ev.detail}`);
				else out("TOOLR", `${ev.tool}|${ev.isError ? "err" : "ok"}|${ev.detail}`);
			};
			out("SYS", `stream: ${streamLog}`);
			out("SYS", `[research] problem=${adhoc.problem.id} genre=${adhoc.problem.genre} scaffold=${args.scaffold ? "custom" : "seed"}`);
			const res = await solveEpisode({
				cfg,
				problem: adhoc.problem,
				evalCtx,
				scaffold,
				model: inner,
				workspace: join(runDir, "episode"),
				controller,
				memory: openMemory(runDir),
				tag: `research-${adhoc.problem.id}`,
				log: (m) => out("SYS", m),
				onAgentDelta: onDelta,
				onToolEvent,
			});
			out(
				"SYS",
				`RESEARCH RESULT: fitness=${res.fitness?.toFixed(4) ?? "null"} public=${res.bestPublic?.toFixed(4) ?? "null"} ` +
					`submits=${res.submits} turns=${res.turns} secs=${Math.round(res.secs)}${res.error ? ` error=${res.error}` : ""}`,
			);
			out("SYS", `artifacts: ${join(runDir, "episode")}`);
			process.exit(res.fitness != null ? 0 : 2);
		}
		const scaffoldPath = args.scaffold ? String(args.scaffold) : undefined;
		let scaffold: Scaffold = SEED_SCAFFOLD;
		let name = "seed";
		if (scaffoldPath && existsSync(scaffoldPath)) {
			scaffold = JSON.parse(readFileSync(scaffoldPath, "utf8")) as Scaffold;
			name = args.name ? String(args.name) : "custom";
		}
		const runName = args["run-name"] ? String(args["run-name"]) : `exam-${Date.now()}`;
		const report = await runExam(cfg, scaffold, name, join(ROOT, "runs", runName), (m) => console.log(m));
		console.log(`\nEXAM DONE: ${report.summary} (artifacts: runs/${runName}/RESULTS.md)`);
		process.exit(report.trainMean != null ? 0 : 2);
	}

	if (cmd === "tui") {
		if (args.replay) {
			const { runReplay } = await import("./tui/replay.js");
			const runDir = String(args.replay).replace(/\/+$/, "");
			const speed = args["replay-speed"] ? Number(args["replay-speed"]) : 350;
			await runReplay(runDir.startsWith("runs/") || runDir.includes("/") ? runDir : join(ROOT, "runs", runDir), speed);
			process.exit(0);
		}
		const { GeoTui } = await import("./tui/app.js");
		const runName = args["run-name"]
			? String(args["run-name"])
			: `rsi-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
		const resume = args.resume === true;
		const gens = args.gens ? Number(args.gens) : undefined;
		const app = new GeoTui({ cfg, runName, resume, gensOverride: gens });
		await app.start();
		// app.start() resolves when the run finishes; the TUI stays interactive
		// until the user quits (handled inside via Ctrl+C)
		process.exit(0);
	}

	if (cmd === "rsi") {
		const runName = args["run-name"]
			? String(args["run-name"])
			: `rsi-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
		const resume = args.resume === true;
		const gens = args.gens ? Number(args.gens) : undefined;
		// optional file control channel: another process (pi extension) can
		// pause/resume/stop this run by appending JSON to the control file
		const { RunController } = await import("./loopctl.js");
		const controller = new RunController((m) => console.log(`SYS|${m}`));
		const controlPath = args.control
			? String(args.control)
			: join(ROOT, "runs", runName, "control.json");
		mkdirSync(join(controlPath, ".."), { recursive: true });
		controller.attachControlFile(controlPath);
		let runCfg = cfg;
		if (args.scaffold && existsSync(String(args.scaffold))) {
			runCfg = { ...cfg, seed_scaffold: JSON.parse(readFileSync(String(args.scaffold), "utf8")) as Scaffold };
		} else if (args.scaffold) {
			console.warn(`[run] --scaffold path not found: ${args.scaffold} — starting from SEED_SCAFFOLD instead`);
		}
		const { state } = await runRsi({ cfg: runCfg, runName, resume, gensOverride: gens, controller });
		controller.detachControlFile();
		console.log(`champion generation=${state.generation} best=${state.bestFitness?.toFixed(4) ?? "—"} tokens=${TOKENS.total}`);
		process.exit(0);
	}

	console.error(`unknown command: ${cmd}`);
	process.exit(1);
}

main().catch((e) => {
	console.error("FATAL:", e);
	process.exit(1);
});
