/**
 * Inner loop: one research episode on one problem.
 *
 * The agent works in a scratch workspace with file tools + run_python +
 * submit. `submit` runs the PUBLIC eval and returns the score, so the agent
 * iterates against visible feedback. The PRIVATE eval runs exactly once, at
 * episode end, on the best public submission — that number is the fitness
 * the outer loop selects on, and the agent never sees it.
 *
 * Stop discipline: submission budget cap (eval_cap) + patience (N submits
 * without public improvement) + per-prompt watchdogs; a wall-clock episode
 * cap is enforced by the caller refusing to issue further prompts.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { Config } from "../config.js";
import type { EvalContext, EvalResult, Problem } from "../bench/eval.js";
import { runEval } from "../bench/eval.js";
import { composeSystemPrompt, type Scaffold } from "../scaffold.js";
import { loadKnowledge, selectKnowledge, renderKnowledge, recordUsage } from "../knowledge.js";
import { protectedManifest, scanTextForBreaches, scanWorkspaceForBreaches, verifyManifest } from "../guard.js";
import { PiHarness, toolOutput } from "../piharness.js";
import { resolveModel } from "../provider.js";
import { recall, renderMemory, type MemoryStore } from "../memory.js";
import { queryTermsFromStatement, regionsForTask, renderRetrieved, retrieve } from "../retrieval.js";

export interface EpisodeResult {
	problemId: string;
	fitness: number | null;
	bestPublic: number | null;
	submits: number;
	turns: number;
	tokens: number;
	secs: number;
	error: string | null;
	workspace: string;
	/** knowledge nodes injected into this episode, for deferred accounting */
	knowledgeIds: string[];
}

interface SubmitState {
	answer: Record<string, unknown> | null;
	publicHistory: { score: number | null; note: string }[];
	bestPublic: number | null;
	bestAnswer: Record<string, unknown> | null;
	submits: number;
	staleSubmits: number;
	finished: boolean;
	lastFeedback: string;
}

export function resolveInWorkspace(workspace: string, rel: string): string | null {
	// hard fence: the old strip-dots regex let leading "../" through, which
	// let agents execute/submit files from outside the workspace (e.g. hidden
	// reference solutions). Resolve and require containment instead.
	const root = resolve(workspace);
	const p = resolve(root, rel);
	return p === root || p.startsWith(root + sep) ? p : null;
}

function runPython(cwd: string, pythonCmd: string, file: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve) => {
		// never let eval-side credentials (LLM judge) leak into agent-run code
		const safeEnv = { ...process.env } as NodeJS.ProcessEnv;
		for (const k of Object.keys(safeEnv)) if (k.startsWith("RSILAB_JUDGE")) delete safeEnv[k];
		safeEnv.PYTHONIOENCODING = "utf-8";
		const child = spawn(pythonCmd, [file], { cwd, windowsHide: true, env: safeEnv });
		let out = "";
		let err = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, timeoutMs);
		child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
		child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
		child.on("error", (e) => {
			clearTimeout(timer);
			resolve(`failed to start python: ${e.message}`);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			const head = timedOut ? "[execution timed out]\n" : "";
			let msg = `${head}exit=${code}\nstdout (tail):\n${out.slice(-3000)}`;
			if (err) msg += `\nstderr (tail):\n${err.slice(-1500)}`;
			resolve(msg);
		});
	});
}

export interface SolveOpts {
	cfg: Config;
	problem: Problem;
	evalCtx: EvalContext;
	scaffold: Scaffold;
	model: Model<any>;
	workspace: string;
	memory: MemoryStore;
	log?: (m: string) => void;
	/** optional structured event sink (TUI); absent in headless runs */
	emit?: (ev: import("../tui/events.js").RsiEvent) => void;
	/** live model reasoning/narration stream (research chat display) */
	onAgentDelta?: (kind: "thinking" | "text", delta: string) => void;
	/** tool call lifecycle for live display */
	onToolEvent?: (ev: { phase: "start" | "end"; tool: string; detail: string; isError?: boolean }) => void;
	/** disable global knowledge-stat writes during isolated candidate evaluation */
	persistKnowledgeUsage?: boolean;
	/** cooperative pause/stop gate (checked between turns) */
	controller?: import("../loopctl.js").RunController;
	tag: string;
}

export async function solveEpisode(opts: SolveOpts): Promise<EpisodeResult> {
	const { problem, evalCtx, scaffold, workspace } = opts;
	// per-problem overrides (quiz batches, long-job problems) win over config
	const cfg: Config = { ...opts.cfg, ...problem.overrides } as Config;
	const log = opts.log ?? (() => {});
	const emit = opts.emit ?? (() => {});
	const t0 = Date.now();
	// fresh scratch every episode: leftovers from a previous episode in the same
	// role dir would contaminate the agent's context
	rmSync(workspace, { recursive: true, force: true });
	mkdirSync(workspace, { recursive: true });
	emit({ type: "episode_start", tag: opts.tag, problem: problem.id, role: opts.tag.split("-")[0], generation: scaffold.generation });

	// knowledge-base routing (deterministic; see src/knowledge.ts): pick the
	// proven lessons tagged for this problem's regions, inject into the prompt
	// task-to-model routing: quiz batches may run a different (cheaper/faster)
	// inner than the suite default; per-problem override wins over the
	// quiz-wide default
	const routedInner =
		problem.overrides.inner_model ??
		(problem.overrides.type === "quiz" && cfg.quiz_inner_model ? cfg.quiz_inner_model : undefined);
	const inner = routedInner ? resolveModel(routedInner) : opts.model;
	if (routedInner && routedInner !== (opts.model as { id?: string }).id) {
		log(`[route] ${problem.id}: inner -> ${routedInner}`);
	}

	const kbSel = selectKnowledge(loadKnowledge(), { genre: problem.genre, id: problem.id });
	if (kbSel.nodes.length > 0) {
		log(`[knowledge] ${problem.id}: ${kbSel.nodes.map((n) => n.id).join(",")} (store ${kbSel.version})`);
	}
	const ragRegions = cfg.rag_enabled ? regionsForTask(problem.genre, problem.id) : [];
	const ragDocs = ragRegions.length > 0
		? retrieve(ragRegions, queryTermsFromStatement(problem.statement), cfg.rag_budget_chars)
		: [];
	if (ragDocs.length > 0) {
		log(`[rag] ${problem.id}: ${ragDocs.map((d) => d.id).join(",")} regions=${ragRegions.join(",")}`);
	}

	// integrity manifest of everything private grading depends on (eval.py,
	// hidden references, quiz gold) + a tap recording every tool call's args:
	// built-in read/write accept absolute paths, so both are checked at exit.
	const gradeManifest = protectedManifest(problem.dir);
	const toolCallLog: string[] = [];

	// Copy the problem's data dir into the workspace: the agent gets the data
	// it may read, but not the eval script or anything outside data/.
	const srcData = join(problem.dir, "data");
	const dstData = join(workspace, "data");
	if (existsSync(srcData)) {
		cpSync(srcData, dstData, { recursive: true });
	}
	mkdirSync(join(workspace, "solutions"), { recursive: true });

	const isQuiz = problem.overrides.type === "quiz";
	const st: SubmitState = {
		answer: null,
		publicHistory: [],
		bestPublic: null,
		bestAnswer: null,
		submits: 0,
		staleSubmits: 0,
		finished: false,
		lastFeedback: "",
	};

	const runPy = defineTool({
		name: "run_python",
		label: "Run python",
		description:
			"Execute a python script file in the current workspace (foreground). Write the script first with the write tool. Returns exit code plus stdout/stderr tails. For anything longer than a couple of minutes use start_job instead.",
		parameters: Type.Object({
			file: Type.String({ description: "script filename relative to the workspace, e.g. analyze.py" }),
		}),
		execute: async (_id, params) => {
			const file = resolveInWorkspace(workspace, params.file);
			if (!file) return toolOutput("error: script path must stay inside the workspace");
			if (!existsSync(file)) {
				return toolOutput(`error: file not found: ${params.file} (create it with the write tool first)`);
			}
			const out = await runPython(workspace, cfg.python_cmd, file, (cfg.script_timeout_s ?? 120) * 1000);
			if (out.includes("[execution timed out]")) {
				return toolOutput(
					out +
						`\n\nForeground scripts are capped at ${cfg.script_timeout_s ?? 120}s. ` +
						`For long computations call start_job with this file — it runs in the background and the system wakes you when it finishes.`,
				);
			}
			return toolOutput(out);
		},
	});

	// ---- background jobs: long computations (hours) without blocking turns ----
	interface Job {
		name: string;
		file: string;
		pid: number | undefined;
		startedAt: number;
		state: "running" | "done" | "failed" | "timeout" | "killed";
		exitCode: number | null;
	}
	const jobs = new Map<string, Job>();
	const jobsDir = join(workspace, "jobs");
	mkdirSync(jobsDir, { recursive: true });

	const refreshJob = (j: Job): Job => {
		if (j.state !== "running") return j;
		// a job is finished when its status file says so OR the pid is gone
		const statusPath = join(jobsDir, `${j.name}.status.json`);
		try {
			const s = JSON.parse(readFileSync(statusPath, "utf8")) as { state?: string; exitCode?: number | null };
			if (s.state && s.state !== "running") {
				j.state = s.state as Job["state"];
				j.exitCode = s.exitCode ?? null;
				return j;
			}
		} catch {
			/* no status file yet */
		}
		if (j.pid != null) {
			try {
				process.kill(j.pid, 0); // liveness probe
			} catch {
				// process gone: give it a moment to have written status; treat as done
				j.state = "done";
				j.exitCode = null;
				return j;
			}
		}
		if (Date.now() - j.startedAt > (cfg.job_timeout_s ?? 14_400) * 1000) {
			killJob(j);
			j.state = "timeout";
		}
		return j;
	};

	const killJob = (j: Job): void => {
		if (j.pid != null) {
			try {
				process.kill(j.pid);
			} catch {
				/* already gone */
			}
		}
		writeJobStatus(j);
	};

	const writeJobStatus = (j: Job): void => {
		try {
			writeFileSync(
				join(jobsDir, `${j.name}.status.json`),
				JSON.stringify({ name: j.name, file: j.file, state: j.state, exitCode: j.exitCode, startedAt: j.startedAt, pid: j.pid }, null, 2),
			);
		} catch {
			/* best effort */
		}
	};

	const jobStatusText = (): string => {
		const list = [...jobs.values()].map(refreshJob);
		if (list.length === 0) return "no jobs started";
		return list
			.map((j) => {
				const mins = Math.round((Date.now() - j.startedAt) / 60000);
				const logPath = join("jobs", `${j.name}.log`);
				let tail = "";
				try {
					const log = readFileSync(join(jobsDir, `${j.name}.log`), "utf8");
					const lines = log.split(/\r?\n/).filter(Boolean);
					tail = lines.slice(-5).join(" | ").slice(-400);
				} catch {
					/* no log yet */
				}
				return `[${j.name}] ${j.state}${j.exitCode != null ? ` (exit ${j.exitCode})` : ""} — ${mins}m — ${j.file}\n  log: ${logPath}\n  tail: ${tail || "(empty)"}`;
			})
			.join("\n");
	};

	const startJob = defineTool({
		name: "start_job",
		label: "Start background job",
		description:
			"Start a LONG-RUNNING python script as a detached background job (simulations, heavy fits, hours are fine). Output goes to jobs/<name>.log. The system automatically waits and wakes you when all jobs finish — you may also call job_status anytime. Use run_python for quick scripts.",
		parameters: Type.Object({
			file: Type.String({ description: "script filename relative to the workspace" }),
			name: Type.Optional(Type.String({ description: "short job name (default: script name)" })),
		}),
		execute: async (_id, params) => {
			const file = resolveInWorkspace(workspace, params.file);
			if (!file) return toolOutput("error: job script must stay inside the workspace");
			if (!existsSync(file)) {
				return toolOutput(`error: file not found: ${params.file}`);
			}
			const name = (params.name ?? file.replace(/\.py$/, "")).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "job";
			if (jobs.has(name)) return toolOutput(`error: job "${name}" already exists — pick another name`);
			const logFd = openSync(join(jobsDir, `${name}.log`), "w");
			const jobEnv = { ...process.env } as NodeJS.ProcessEnv;
			for (const k of Object.keys(jobEnv)) if (k.startsWith("RSILAB_JUDGE")) delete jobEnv[k];
			const child = spawn(cfg.python_cmd, ["-u", file], {
				cwd: workspace,
				detached: true,
				stdio: ["ignore", logFd, logFd],
				windowsHide: true,
				env: { ...jobEnv, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" },
			});
			child.unref();
			const j: Job = { name, file, pid: child.pid, startedAt: Date.now(), state: "running", exitCode: null };
			jobs.set(name, j);
			writeJobStatus(j);
			child.on("exit", (code) => {
				j.exitCode = code;
				j.state = code === 0 ? "done" : "failed";
				writeJobStatus(j);
			});
			log(`  [${opts.tag}] job started: ${name} (${file}, pid ${child.pid})`);
			return toolOutput(
				`job "${name}" started (pid ${child.pid}). Log: jobs/${name}.log. ` +
					`The system waits for it automatically and wakes you when it finishes — continue with other work or just wait.`,
			);
		},
	});

	const jobStatus = defineTool({
		name: "job_status",
		label: "Job status",
		description: "Check background jobs: state, elapsed, exit code, log tail.",
		parameters: Type.Object({}),
		execute: async () => toolOutput(jobStatusText()),
	});

	const killJobTool = defineTool({
		name: "kill_job",
		label: "Kill job",
		description: "Kill a running background job by name.",
		parameters: Type.Object({ name: Type.String() }),
		execute: async (_id, params) => {
			const j = jobs.get(params.name);
			if (!j) return toolOutput(`error: no job named "${params.name}"`);
			killJob(j);
			j.state = "killed";
			writeJobStatus(j);
			return toolOutput(`job "${params.name}" killed`);
		},
	});

	/** Driver-side wait: poll running jobs until all finish, or stop/deadline hits. */
	const waitForJobs = async (): Promise<string[]> => {
		const finished: string[] = [];
		for (;;) {
			const running = [...jobs.values()].filter((j) => refreshJob(j).state === "running");
			if (running.length === 0) return finished;
			if (opts.controller?.stopRequested) {
				for (const j of running) killJob(j);
				finished.push(`${running.map((j) => j.name).join(",")} killed (stop requested)`);
				return finished;
			}
			if (Date.now() > t0 + cfg.episode_timeout_s * 1000) {
				for (const j of running) killJob(j);
				finished.push(`${running.map((j) => j.name).join(",")} killed (episode wall clock)`);
				return finished;
			}
			const mins = Math.round((Date.now() - running[0]!.startedAt) / 60000);
			log(`  [${opts.tag}] waiting for ${running.length} job(s): ${running.map((j) => j.name).join(", ")} (${mins}m elapsed)`);
			await opts.controller?.waitIfPaused();
			await new Promise((r) => setTimeout(r, (cfg.job_poll_s ?? 30) * 1000));
			for (const j of [...jobs.values()]) {
				if (j.state === "running") {
					refreshJob(j);
					if (j.state !== "running") finished.push(`${j.name} ${j.state}${j.exitCode != null ? ` exit=${j.exitCode}` : ""}`);
				}
			}
		}
	};


	const submit = defineTool({
		name: "submit",
		label: "Submit answer",
		description:
			"Submit your final answer for grading. Returns the PUBLIC score (computed against the reference dataset truth). Call again to improve; the last/best submission counts.",
		parameters: Type.Object({
			answer: Type.Optional(
				Type.Record(Type.String(), Type.Unknown(), {
					description: "the answer object exactly as the task statement specifies",
				}),
			),
			answers_file: Type.Optional(
				Type.String({ description: "quiz batches: workspace file with the {qid: answer} map, e.g. answers.json" }),
			),
			note: Type.Optional(Type.String({ description: "one-line justification of the method used" })),
			final: Type.Optional(Type.Boolean({ description: "true when you are done improving" })),
		}),
		execute: async (_id, params) => {
			if (st.submits >= cfg.eval_cap) {
				// budget is spent, but final=true is still meaningful: it ends
				// the episode cleanly instead of leaving the nudge loop to burn
				// max_turns on submit attempts we would refuse anyway
				if (params.final) {
					st.finished = true;
					return toolOutput(
						`finalized. Submission budget (${cfg.eval_cap}) was already spent; the best recorded answer stands as the episode answer.`,
					);
				}
				return toolOutput(
					`submission budget exhausted (${cfg.eval_cap}). Call submit with final=true to end the episode; the best answer already recorded will be graded.`,
				);
			}
			// quiz batches submit via a file (a 100-item map is too big for one tool arg)
			let answer = params.answer ?? {};
			if (params.answers_file) {
				const af = resolveInWorkspace(workspace, params.answers_file);
				if (!af) return toolOutput("error: answers_file must be inside the workspace");
				if (!existsSync(af)) {
					return toolOutput(`error: answers file not found: ${params.answers_file} — write it first with the write tool`);
				}
				try {
					const parsed = JSON.parse(readFileSync(af, "utf8")) as Record<string, unknown>;
					answer = parsed.answers && typeof parsed.answers === "object" ? (parsed.answers as Record<string, unknown>) : parsed;
					// verifier (deterministic, no gold access): catch output_format
					// and instruction errors before they cost points. Refuses the
					// first final submission that fails coverage or sanity; later
					// attempts pass through with a warning appended by the caller.
					if (isQuiz && params.final && st.submits === 0) {
						const quizPath = join(workspace, "data", "quiz.jsonl");
						if (existsSync(quizPath)) {
							const qs: { qid: string; kind?: string; options?: string[] | null }[] = [];
							for (const x of readFileSync(quizPath, "utf8").split(/\r?\n/)) {
								if (!x.trim()) continue;
								try {
									qs.push(JSON.parse(x));
								} catch {
									/* skip torn line */
								}
							}
							const total = qs.length;
							const covered = Object.keys(answer ?? {}).filter((k) => {
								const v = (answer as Record<string, unknown>)[k];
								return v !== undefined && v !== null && String(v).trim() !== "";
							}).length;
							const issues: string[] = [];
							if (total > 0 && covered / total < 0.5) {
								issues.push(`only ${covered}/${total} answered (${Math.round((covered / total) * 100)}%) — unanswered score ZERO`);
							}
							const unknownQids = Object.keys(answer ?? {}).filter((k) => !qs.some((q) => q.qid === k));
							if (unknownQids.length > 0) {
								issues.push(`${unknownQids.length} answers reference unknown qids (e.g. ${unknownQids[0]}) — check you used the exact qids from data/quiz.jsonl`);
							}
							let badFormat = 0;
							for (const q of qs) {
								const v = (answer as Record<string, unknown>)[q.qid];
								if (v === undefined || v === null || String(v).trim() === "") continue;
								const s = String(v).trim();
								if (q.kind === "mcq" && q.options && q.options.length > 0) {
									const letterOk = /^[a-jA-J]$/.test(s) || q.options.some((o) => o.trim() === s);
									if (!letterOk) badFormat += 1;
								} else if (q.kind === "tf" && !/^(true|false|t|f|yes|no|对|错|正确|错误)$/i.test(s.replace(/[。.\s]/g, ""))) {
									badFormat += 1;
								}
							}
							if (badFormat > 0) issues.push(`${badFormat} answers look malformed for their question kind (mcq should be a bare letter like "B", tf should be true/false)`);
							if (issues.length > 0) {
								return toolOutput(
									`submission refused — fix and resubmit (this refusal did not consume a submission):\n- ` +
										issues.join("\n- "),
								);
							}
						}
					}
				} catch (e) {
					return toolOutput(`error: answers file is not valid JSON: ${(e as Error).message}`);
				}
			} else if (!params.answer) {
				return toolOutput("error: provide either answer or answers_file");
			}
			st.submits += 1;
			const subPath = join(workspace, "solutions", `${problem.id}.json`);
			writeFileSync(subPath, JSON.stringify(answer, null, 2));
			const res: EvalResult = await runEval(problem, evalCtx, subPath, "public", (problem.overrides.eval_timeout_s ?? 60) * 1000);
			st.publicHistory.push({ score: res.score, note: params.note ?? "" });
			const improved = res.score != null && (st.bestPublic == null || res.score > st.bestPublic);
			if (improved) {
				st.bestPublic = res.score;
				st.bestAnswer = answer;
				st.staleSubmits = 0;
			} else {
				st.staleSubmits += 1;
			}
			st.answer = answer;
			const budget = cfg.eval_cap - st.submits;
			let fb: string;
			if (res.score == null) {
				fb = `INVALID submission (${res.detail}). Fix the format/method and submit again.`;
			} else if (params.final) {
				st.finished = true;
				fb = `public score ${res.score.toFixed(4)} recorded. Episode complete.`;
			} else {
				fb = `public score ${res.score.toFixed(4)}${improved ? " (new best)" : ""}. ${budget} submission(s) left.`;
			}
			st.lastFeedback = fb;
			emit({
				type: "episode_submitted",
				tag: opts.tag,
				publicScore: res.score,
				best: st.bestPublic,
				submits: st.submits,
				cap: cfg.eval_cap,
			});
			return toolOutput(fb);
		},
	});

	// memory recall (deterministic, no LLM)
	const memItems = recall(opts.memory, problem.id, problem.genre, 4);
	const memBlock = renderMemory(memItems);

	const harness = new PiHarness({
		model: inner,
		thinkingLevel: "low",
		cwd: workspace,
		systemPrompt: composeSystemPrompt(scaffold, problem.genre) + renderKnowledge(kbSel) + renderRetrieved(ragDocs),
		customTools: [runPy, submit, startJob, jobStatus, killJobTool],
		onAgentDelta: opts.onAgentDelta,
		onToolEvent: (ev) => {
			toolCallLog.push(`${ev.phase} ${ev.tool} ${ev.detail}`);
			opts.onToolEvent?.(ev);
		},
		// a full agent turn = many internal LLM round-trips (one per tool call);
		// heavy reasoners (mimo) legitimately spend 10-20+ minutes per turn —
		// the stall detector (no-event abort) is the real watchdog, this wall
		// is only the backstop, so give slow models generous headroom
		promptTimeoutMs: Math.min(cfg.episode_timeout_s, 1500) * 1000,
		stallMs: cfg.stall_s * 1000,
	});

	let turns = 0;
	let tokens = 0;
	let lastError: string | null = null;

	try {
		await harness.init();
		const quizFirstPass = isQuiz
			? "QUIZ FIRST-PASS CONTRACT: read data/quiz.jsonl once, make a best-effort answer for every item, write answers.json, and call submit with answers_file=\"answers.json\" and final=false in this first turn. Use compact answers and no long per-question explanation. A complete imperfect sheet is better than spending the turn on an unfinished derivation. Refine only after a public score.\n"
			: "";
		const openFirstPass = !isQuiz
			? "OPEN-TASK FIRST-PASS CONTRACT: inspect the statement and available data/tools, perform only the minimum checks needed to form a valid answer, and submit a complete best-effort artifact in this first turn with final=false. Do not spend the whole turn on exploratory narration or repeated analysis; an imperfect valid submission creates feedback for refinement.\n"
			: "";
		const initial =
			`${problem.statement}\n\n` +
			`Environment: you are in a scratch workspace; the dataset is in data/. ` +
			`There is NO shell — write scripts to files (write tool) and execute them with the ` +
			`run_python tool (quick scripts) — for computations longer than a couple of minutes ` +
			`use start_job instead: it runs detached in the background and the system wakes you ` +
			`when it finishes (hours are fine). Budget your time: a complete analysis in 2-4 scripts is ideal.\n` +
			quizFirstPass +
			openFirstPass +
			`You may submit up to ${cfg.eval_cap} times; public scores guide your iteration. ` +
			`Finish by calling submit with final=true.\n` +
			(memBlock ? `\n${memBlock}\n` : "");
		log(`  [${opts.tag}] turn 1`);
		emit({ type: "episode_turn", tag: opts.tag, turn: 1, maxTurns: cfg.max_turns, note: problem.id });
		let out = await harness.prompt(initial);
		tokens += out.tokens;
		turns += 1;
		if (out.error) lastError = out.error;
		let canContinue = !out.error && !out.aborted;

		const deadline = t0 + cfg.episode_timeout_s * 1000;
		for (let turn = 2; turn <= cfg.max_turns && !st.finished && !lastError && canContinue; turn++) {
			await opts.controller?.waitIfPaused();
			if (opts.controller?.stopRequested) {
				log(`  [${opts.tag}] stop requested; finalizing current episode`);
				break;
			}
			if (Date.now() > deadline) {
				log(`  [${opts.tag}] episode wall-clock cap reached`);
				break;
			}
			if (TOKENS_BUDGET_EXHAUSTED) break;
			// long computations: if the agent started background jobs, the DRIVER
			// waits (no turns burned, no watchdog risk) and wakes the agent with
			// the finished-job summary
			let jobWake = "";
			const runningJobs = [...jobs.values()].filter((j) => refreshJob(j).state === "running");
			if (runningJobs.length > 0) {
				log(`  [${opts.tag}] ${runningJobs.length} background job(s) running — driver waiting`);
				const finished = await waitForJobs();
				jobWake =
					`BACKGROUND JOBS FINISHED: ${finished.join("; ") || "(all done)"}.\n` +
					`Inspect their logs (jobs/*.log via job_status or read), then continue.\n`;
			}
			let nudge: string;
			const budgetLeft = cfg.eval_cap - st.submits;
			if (isQuiz && st.submits === 0) {
				// batch-friendly escalation: early turns point at the task,
				// later turns get concrete batch instructions (large one-shot
				// sheets stall some models — measured on hy3 2026-08-25)
				const batchHint =
					turns >= 3
						? " Work in batches of 15-20 questions: answer a batch, merge it into answers.json, repeat. You may submit once ~90% are answered — partial submissions score partially."
						: "";
				nudge =
					jobWake +
					"You have not submitted yet. Read data/quiz.jsonl, answer the questions, write answers.json ({qid: answer}), then call submit with answers_file=\"answers.json\". Unanswered questions count as wrong — always submit a complete sheet." +
					batchHint;
			} else if (st.submits === 0) {
				nudge =
					jobWake +
					"You have not submitted yet. Run your analysis, then call the submit tool with your answer. A valid early submission beats an unsubmitted perfect plan.";
			} else if (budgetLeft <= 0 || st.staleSubmits >= cfg.patience || out.aborted) {
				nudge =
					jobWake +
					(budgetLeft <= 0
						? "SUBMISSION BUDGET EXHAUSTED. "
						: st.staleSubmits >= cfg.patience
							? "No improvement in recent submissions. "
							: "") +
					"Finalize now: call submit with final=true using your best answer. Do not start new analysis.";
			} else {
				nudge =
					`${jobWake}${st.lastFeedback}\n` +
					`Public best: ${st.bestPublic?.toFixed(4) ?? "none"}. ` +
					`You have ${budgetLeft} submission(s) left — refine the method (or confirm current best with final=true).`;
			}
			log(`  [${opts.tag}] turn ${turn}: ${nudge.slice(0, 60)}...`);
			emit({ type: "episode_turn", tag: opts.tag, turn, maxTurns: cfg.max_turns, note: nudge.slice(0, 80) });
			out = await harness.prompt(nudge);
			tokens += out.tokens;
			turns += 1;
			if (out.error) lastError = out.error;
			canContinue = !out.error && !out.aborted;
		}
	} finally {
		harness.dispose();
		// never leak detached compute processes past the episode
		for (const j of jobs.values()) {
			if (refreshJob(j).state === "running") {
				killJob(j);
				j.state = "killed";
				writeJobStatus(j);
				log(`  [${opts.tag}] job ${j.name} killed at episode end`);
			}
		}
	}

	// fitness: one private eval on the best public submission
	let fitness: number | null = null;
	let error = lastError;
	if (st.bestAnswer != null || st.answer != null) {
		const answer = st.bestAnswer ?? st.answer!;
		const subPath = join(workspace, "solutions", `${problem.id}.json`);
		writeFileSync(subPath, JSON.stringify(answer, null, 2));
		const priv = await runEval(problem, evalCtx, subPath, "private", (problem.overrides.eval_timeout_s ?? 60) * 1000);
		fitness = priv.score;
		if (priv.score == null) error = priv.detail;
	} else {
		error = error ?? "no submission produced";
	}

	const result: EpisodeResult = {
		problemId: problem.id,
		fitness,
		bestPublic: st.bestPublic,
		submits: st.submits,
		turns,
		tokens,
		secs: (Date.now() - t0) / 1000,
		error,
		workspace,
		knowledgeIds: kbSel.nodes.map((n) => n.id),
	};
	let breaches = scanWorkspaceForBreaches(workspace);
	breaches.push(...scanTextForBreaches(toolCallLog.join("\n")));
	const tampered = verifyManifest(problem.dir, gradeManifest);
	for (const f of tampered) breaches.push({ file: f, pattern: "grading asset modified" });
	if (breaches.length > 0) {
		// reward-hacking attempt: agent touched protected paths (quiz gold,
		// hidden references, judge cache). Void the episode end to end.
		result.fitness = null;
		result.bestPublic = null;
		result.error = `anti-cheat: workspace referenced protected paths (${breaches
			.slice(0, 3)
			.map((b) => `${b.file}:${b.pattern}`)
			.join(", ")})`;
		log(`[guard] ${problem.id}: COMPROMISED — ${result.error}`);
	} else if (result.fitness != null && opts.persistKnowledgeUsage !== false) {
		recordUsage(
			kbSel.nodes.map((n) => n.id),
			result.fitness,
		);
	}
	writeFileSync(join(workspace, "episode.json"), JSON.stringify(result, null, 2));
	emit({
		type: "episode_end",
		tag: opts.tag,
		problem: problem.id,
		fitness: result.fitness,
		publicScore: result.bestPublic,
		secs: Math.round(result.secs),
		error: result.error,
	});
	return result;
}

/** Global kill-switch set by the outer loop when the token budget is gone. */
export let TOKENS_BUDGET_EXHAUSTED = false;
export function setBudgetExhausted(v: boolean): void {
	TOKENS_BUDGET_EXHAUSTED = v;
}
