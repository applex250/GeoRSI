/**
 * GeoRSI CLI.
 *
 *   npx tsx src/run.ts selftest            # no-LLM unit tests of core logic
 *   npx tsx src/run.ts smoke               # 1 tiny live episode (quake_b, 2 turns)
 *   npx tsx src/run.ts exam [--scaffold path]  # full suite exam incl. held-out
 *   npx tsx src/run.ts research-demo [--run-name NAME] # deterministic full research package
 *   npx tsx src/run.ts research-live --config config/research-competition-luna.json --mission path/to/mission.json [--plan path/to/plan.json] --run-name NAME
 *   npx tsx src/run.ts rsi [--gens N] [--resume] [--run-name NAME]
 */
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConfig, researchModelConfigFingerprint, ROOT } from "./config.js";
import { selftest } from "./selftest.js";
import { runRsi } from "./rsi.js";
import { examHasValidTrainingResult, runExam } from "./exam.js";
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
		} else if (out._cmd === undefined) {
			out._cmd = a;
		} else if (out._extra === undefined) {
			out._extra = a;
		}
	}
	return out;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const cmd = String(args._cmd ?? "rsi");
	const cfg = loadConfig(args.config ? String(args.config) : undefined);

	if (cmd === "research-gateway") {
		// Unified gateway routing switch: one command flips research_model.gateway in the config
		// file; all endpoint/resilience/thinking-evidence settings come from the registered entry.
		const configPath = args.config ? String(args.config) : join(ROOT, "config", "research-competition-luna.json");
		const target = args.gateway ? String(args.gateway) : String(args._extra ?? "");
		const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
		const gateways = (raw.research_gateways ?? {}) as Record<string, unknown>;
		const names = Object.keys(gateways).sort();
		if (!target || args.list === true) {
			console.log(`registered gateways in ${configPath}:`);
			for (const name of names) {
				const entry = gateways[name] as Record<string, unknown>;
				console.log(`  ${name.padEnd(10)} provider=${String(entry.provider)} model=${String(entry.model)} api=${String(entry.api)} thinking_evidence=${String(entry.thinking_evidence ?? "(derived)")}`);
			}
			const current = (raw.research_model as Record<string, unknown> | undefined)?.gateway;
			console.log(`current gateway: ${current ?? "(explicit research_model, no gateway route)"}`);
			process.exit(0);
		}
		if (!gateways[target]) {
			console.error(`unknown gateway "${target}"; registered: ${names.join(", ") || "(none)"}`);
			process.exit(1);
		}
		raw.research_model = { gateway: target };
		// Validate the switched config fully parses (expansion + validation) before writing.
		const tempPath = `${configPath}.gateway-switch.tmp.json`;
		writeFileSync(tempPath, JSON.stringify(raw, null, 2) + "\n", { encoding: "utf8" });
		try {
			const switched = loadConfig(tempPath);
			if (!switched.research_model) throw new Error("expanded config has no research_model");
			const fp = researchModelConfigFingerprint(switched.research_model);
			renameSync(tempPath, configPath);
			console.log(`research gateway switched -> ${target}`);
			console.log(`  provider=${switched.research_model.provider} model=${switched.research_model.model} api=${switched.research_model.api}`);
			console.log(`  thinking_evidence=${switched.research_model.thinking_evidence ?? "provider-observed"} resilience=${JSON.stringify(switched.research_model.resilience)}`);
			console.log(`  policy fingerprint=${fp}${switched.research_model.thinking_evidence !== "provider-observed" ? "\n  NOTE: this route is NOT competition-eligible (thinking evidence below provider-observed)" : ""}`);
		} catch (error) {
			rmSync(tempPath, { force: true });
			throw error;
		}
		process.exit(0);
	}

	if (cmd === "selftest") {
		const ok = await selftest();
		process.exit(ok ? 0 : 1);
	}

	if (cmd === "research-demo") {
		const { runDeterministicResearchDemo } = await import("./research/demo.js");
		const runName = args["run-name"] ? String(args["run-name"]) : `research-demo-${Date.now()}`;
		const runDir = join(ROOT, "runs", runName);
		const result = await runDeterministicResearchDemo(runDir);
		console.log(`RESEARCH_DEMO_OK competitionEligible=${result.competitionScore.eligible} evidence=${result.evidence.length} claims=${result.claims.length} replay=${result.replay.passed ? "PASS" : "FAIL"} artifacts=${runDir}`);
		process.exit(result.replay.passed && result.computeReplay.passed ? 0 : 2);
	}

	if (cmd === "research-live") {
		const missionPath = args.mission ? String(args.mission) : "";
		if (!missionPath) {
			console.error("research-live requires --mission <mission.json>");
			process.exit(1);
		}
		const { runLunaResearchMissionFromFiles } = await import("./research/live.js");
		const runName = args["run-name"] ? String(args["run-name"]) : `research-live-${Date.now()}`;
		const runDir = join(ROOT, "runs", runName);
		const result = await runLunaResearchMissionFromFiles({
			cfg,
			missionPath,
			planPath: args.plan ? String(args.plan) : undefined,
			runDir,
			log: (message) => console.log(message),
		});
		console.log(`RESEARCH_LIVE_DONE eligible=${result.competitionScore.eligible} overall=${result.competitionScore.overall ?? "null"} replay=${result.replay.passed ? "PASS" : "FAIL"} computeReplay=${result.computeReplay.passed ? "PASS" : "FAIL"} artifacts=${runDir}`);
		process.exit(result.competitionScore.eligible ? 0 : 2);
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
				protectedFiles: [adhoc.truthPath],
				protectedRoots: [resolve(adhoc.problem.dir), resolve(dirname(adhoc.truthPath))],
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
		process.exit(examHasValidTrainingResult(report.results) ? 0 : 2);
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

function fatalExit(label: string, error: unknown): never {
	console.error(`${label}:`, error);
	process.exitCode = 1;
	// Explicit exit still emits the synchronous `exit` event, which is where
	// solveEpisode's last-resort Sandboxie cleanup is registered.
	process.exit(1);
}

process.once("uncaughtException", (error) => fatalExit("UNCAUGHT", error));
process.once("unhandledRejection", (error) => fatalExit("UNHANDLED", error));

main().catch((e) => fatalExit("FATAL", e));
