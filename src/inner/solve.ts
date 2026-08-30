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
import { existsSync, closeSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ROOT, applyProblemRuntimeOverride, type Config } from "../config.js";
import type { EvalResult } from "../bench/eval.js";
import { runEval } from "../bench/eval.js";
import { composeSystemPrompt } from "../scaffold.js";
import { loadKnowledge, selectKnowledge, renderKnowledge, recordUsage } from "../knowledge.js";
import { protectedManifest, scanTextForBreaches, scanWorkspaceForBreaches, verifyManifest } from "../guard.js";
import { PiHarness, toolOutput, type PromptOutcome } from "../piharness.js";
import { resolveModel } from "../provider.js";
import { recall, renderMemory } from "../memory.js";
import { terminateProcessTree, isProcessAlive } from "../process.js";
import {
	assertSandboxPythonCommand,
	isSandboxieBackend,
	makeSandboxieBoxName,
	resolveExchangeWorkspace,
	SandboxieAdapter,
	sanitizeSandboxEnvironment,
	type SandboxieBackgroundRun,
	type SandboxieBoxRecord,
	type SandboxieCleanupResult,
} from "../sandboxie.js";
import { queryTermsFromStatement, regionsForTask, renderRetrieved, retrieve, corpusVersion } from "../retrieval.js";
import { assertExchangeWorkspace } from "../workspace-tools.js";
import { profileTask } from "../task-profile.js";
import { hostNetworkReachable, sandboxProbeSource } from "../isolation-probe.js";
import type { EpisodeRequest, EpisodeResult } from "./episode-contract.js";
import { buildFollowupPrompt, buildInitialEpisodePrompt } from "./prompt-policy.js";
import { createSubmissionState, recordPublicSubmission, validateQuizSubmission } from "./submission-policy.js";
import {
	checkPythonExecutionPolicy,
	ForegroundPythonRunner,
	hostForegroundPythonPort,
	type ForegroundPythonPort,
} from "./python-execution.js";
import { BackgroundJobRegistry, type BackgroundJob } from "./background-jobs.js";
import { persistEpisodeArtifacts, prepareEpisodeArtifacts } from "./artifact-store.js";

export type { EpisodeResult } from "./episode-contract.js";
export { runPythonHost } from "./python-execution.js";
export { hostNetworkReachable, sandboxProbeSource } from "../isolation-probe.js";

export function resolveInWorkspace(workspace: string, rel: string): string | null {
	// hard fence: the old strip-dots regex let leading "../" through, which
	// let agents execute/submit files from outside the workspace (e.g. hidden
	// reference solutions). Resolve and require containment instead.
	const root = resolve(workspace);
	const p = resolve(root, rel);
	const normalize = (value: string): string => (process.platform === "win32" ? value.toLowerCase() : value);
	const inside = (candidate: string): boolean => {
		const r = normalize(root);
		const c = normalize(candidate);
		return c === r || c.startsWith(r + sep);
	};
	if (!inside(p)) return null;
	try {
		if (!inside(realpathSync(p))) return null;
	} catch {
		// A not-yet-created script is still a valid lexical workspace path; the
		// caller will report it as missing. Dangling links fail this check through
		// existsSync/realpath before they can be executed.
	}
	return p;
}

export type SolveOpts = EpisodeRequest;

export async function solveEpisode(opts: EpisodeRequest): Promise<EpisodeResult> {
	const { problem, evalCtx, scaffold } = opts;
	// per-problem overrides (quiz batches, long-job problems) win over config
	const cfg: Config = applyProblemRuntimeOverride(opts.cfg, problem.overrides);
	const sandboxed = isSandboxieBackend(cfg);
	const repoRoot = resolve(ROOT);
	const privateRoot = resolve(ROOT, cfg.private_truth_dir);
	const extraProtectedRoots = [...new Set((evalCtx.protectedRoots ?? []).map((path) => resolve(path)))]
		.filter((path) => path !== repoRoot && path !== privateRoot);
	const protectedFiles = [...new Set([
		...(evalCtx.protectedFiles ?? []),
		...(existsSync(evalCtx.truthFile(problem.id)) ? [evalCtx.truthFile(problem.id)] : []),
	].map((path) => resolve(path)))];
	const pythonCmd = sandboxed
		? assertSandboxPythonCommand(cfg.python_cmd, [repoRoot, privateRoot, ...extraProtectedRoots])
		: cfg.python_cmd;
	const requestedWorkspace = resolve(opts.workspace);
	// Strict Sandboxie episodes never use a repository-owned workspace. The
	// requested path is only a stable run/episode label for the exchange path.
	const workspace = sandboxed
		? resolveExchangeWorkspace(requestedWorkspace, cfg.sandboxie_exchange_root)
		: requestedWorkspace;
	if (sandboxed) assertExchangeWorkspace(workspace, repoRoot, privateRoot, extraProtectedRoots);
	const log = opts.log ?? (() => {});
	const emit = opts.emit ?? (() => {});
	const t0 = Date.now();
	const deadline = t0 + cfg.episode_timeout_s * 1000;
	const remainingMs = (): number => Math.max(0, deadline - Date.now());
	// Destructive I/O begins only after strict path authorization.
	prepareEpisodeArtifacts({ workspace, requestedWorkspace, problemDir: problem.dir });
	if (sandboxed) assertExchangeWorkspace(workspace, repoRoot, privateRoot, extraProtectedRoots);
	emit({ type: "episode_start", tag: opts.tag, problem: problem.id, role: opts.tag.split("-")[0], generation: scaffold.generation });
	const taskProfile = profileTask(problem);

	// proven lessons tagged for this problem's regions, inject into the prompt
	// task-to-model routing: quiz batches may run a different (cheaper/faster)
	// inner than the suite default; per-problem override wins over the
	// quiz-wide default
	const routedInner =
		problem.overrides.inner_model ??
		(taskProfile.isQuiz && cfg.quiz_inner_model ? cfg.quiz_inner_model : undefined);
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
	const gradeManifest = protectedManifest(problem.dir, protectedFiles);
	const integrityBreaches: string[] = [];
	const verifyGradingAssets = (phase: string): string[] => {
		const changed = verifyManifest(problem.dir, gradeManifest);
		for (const file of changed) {
			const finding = `${phase}:${file}`;
			if (!integrityBreaches.includes(finding)) integrityBreaches.push(finding);
		}
		return changed;
	};
	const toolCallLog: string[] = [];
	const sandboxAdapter = sandboxed ? SandboxieAdapter.fromConfig(cfg, log) : null;
	let sandboxRecord: SandboxieBoxRecord | null = null;
	let sandboxCleanup: SandboxieCleanupResult | null = null;
	let sandboxCleanupError: string | null = null;
	let unregisterSandboxExit = (): void => {};

	if (sandboxAdapter) {
		try {
			const networkExpected = await hostNetworkReachable();
			if (!networkExpected) {
				throw new Error("strict Sandboxie network preflight failed: the host could not reach https://example.com; refusing to classify an unavailable network as sandbox blocking");
			}
			const boxName = makeSandboxieBoxName(`${opts.tag}-${problem.id}`);
		sandboxRecord = await sandboxAdapter.prepareBox({
			name: boxName,
			exchangeWorkspace: workspace,
			repoRoot,
			privateRoot,
			additionalProtectedRoots: extraProtectedRoots,
		});
		const recordForExit = sandboxRecord!;
		const onProcessExit = (): void => {
			try {
				sandboxAdapter.cleanupBoxSync(recordForExit);
			} catch {
				/* exit handlers cannot report safely; normal cleanup records errors */
			}
		};
		process.once("exit", onProcessExit);
		unregisterSandboxExit = () => process.removeListener("exit", onProcessExit);
		const probeScript = join(workspace, ".georsi_sandbox_probe.py");
		const probeResultPath = join(workspace, ".georsi_sandbox_probe.json");
		const repoProbeFile = join(repoRoot, "README.md");
		if (!existsSync(repoProbeFile)) throw new Error(`Sandboxie isolation probe target is missing: ${repoProbeFile}`);
		if (!existsSync(privateRoot)) throw new Error(`Sandboxie isolation probe target is missing: ${privateRoot}`);
		const additionalProbePaths = [...new Set([...extraProtectedRoots, ...protectedFiles])]
			.filter((path) => existsSync(path));
		writeFileSync(
			probeScript,
			sandboxProbeSource(repoProbeFile, privateRoot, probeResultPath, networkExpected, additionalProbePaths),
			"utf8",
		);
		const probe = await sandboxAdapter.runPython({
			boxName: sandboxRecord.name,
			pythonCmd,
			scriptPath: probeScript,
			cwd: workspace,
			stdoutPath: join(workspace, ".georsi_sandbox_probe.stdout.log"),
			stderrPath: join(workspace, ".georsi_sandbox_probe.stderr.log"),
			timeoutMs: 30_000,
		});
		sandboxRecord.pids.push(...probe.targetPids);
		let probeData: Record<string, unknown>;
		try {
			probeData = JSON.parse(readFileSync(probeResultPath, "utf8")) as Record<string, unknown>;
		} catch (error) {
			throw new Error(`Sandboxie isolation probe produced no JSON result: ${error instanceof Error ? error.message : String(error)}`);
		}
		sandboxRecord.networkProbe = probeData;
		if (probe.exitCode !== 0 || probe.timedOut) {
			throw new Error(`Sandboxie isolation probe failed: exit=${probe.exitCode} timeout=${probe.timedOut}`);
		}
		for (const key of ["repo_file", "private_dir", "network"] as const) {
			if (probeData[key] !== "BLOCKED") {
				throw new Error(`Sandboxie isolation probe was not fail-closed for ${key}: ${String(probeData[key])}`);
			}
		}
		for (const [index, item] of ((probeData.additional_protected ?? []) as { status?: unknown }[]).entries()) {
			if (item.status !== "BLOCKED") {
				throw new Error(`Sandboxie isolation probe was not fail-closed for additional protected path ${index}: ${String(item.status)}`);
			}
		}
		if (!Array.isArray(probeData.errors) || probeData.errors.length > 0) {
			throw new Error(`Sandboxie isolation probe had unexpected errors: ${JSON.stringify(probeData.errors ?? "missing")}`);
		}
		log(`  [${opts.tag}] Sandboxie isolation probe passed (repo/private/network blocked)`);
		} catch (error) {
			if (sandboxRecord) {
				try {
					const cleanup = await sandboxAdapter.cleanupBox(sandboxRecord);
					log(`  [${opts.tag}] Sandboxie setup cleanup: ${cleanup.errors.join("; ") || "ok"}`);
				} catch (cleanupError) {
					log(`  [${opts.tag}] Sandboxie setup cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
				}
			}
			unregisterSandboxExit();
			throw error;
		}
	}

	const isQuiz = taskProfile.isQuiz;
	const quizQuestionTotal = isQuiz
		? readFileSync(join(workspace, "data", "quiz.jsonl"), "utf8").split(/\r?\n/).filter((line) => line.trim()).length
		: undefined;
	const st = createSubmissionState();

	const foregroundPythonPort: ForegroundPythonPort = sandboxAdapter
		? {
			execute: async (request) => {
				if (!sandboxRecord) throw new Error("Sandboxie box was not prepared before Python execution");
				const result = await sandboxAdapter.runPython({
					boxName: sandboxRecord.name,
					pythonCmd: request.pythonCmd,
					scriptPath: request.file,
					cwd: request.cwd,
					stdoutPath: request.stdoutPath,
					stderrPath: request.stderrPath,
					timeoutMs: request.timeoutMs,
				});
				return {
					exitCode: result.exitCode,
					timedOut: result.timedOut,
					stdout: result.stdout,
					stderr: result.stderr,
					error: result.error,
					targetPids: result.targetPids,
					wrapperPath: result.wrapperPath,
				};
			},
		}
		: hostForegroundPythonPort;
	const foregroundPython = new ForegroundPythonRunner({
		workspace,
		pythonCmd,
		port: foregroundPythonPort,
		recordTargetPids: (pids) => {
			if (sandboxRecord) sandboxRecord.pids.push(...pids);
		},
	});
	const runEpisodePython = (file: string, timeoutMs: number): Promise<string> => foregroundPython.run(file, timeoutMs);

	const runPy = defineTool({
		name: "run_python",
		label: "Run python",
		description:
			"Execute a python script file in the current workspace (foreground). Write the script first with the write tool. Returns exit code plus stdout/stderr tails. For anything longer than a couple of minutes use start_job instead.",
		parameters: Type.Object({
			file: Type.String({ description: "script filename relative to the workspace, e.g. analyze.py" }),
		}),
		execute: async (_id, params) => {
			if (remainingMs() < 8_000) return toolOutput("error: episode deadline is too close to safely prove Sandboxie process ownership; submit the current best answer now");
			const file = resolveInWorkspace(workspace, params.file);
			if (!file) return toolOutput("error: script path must stay inside the workspace");
			if (!existsSync(file)) {
				return toolOutput(`error: file not found: ${params.file} (create it with the write tool first)`);
			}
			const policy = checkPythonExecutionPolicy(file, params.file, cfg.execution_policy ?? "audit");
			if (policy.blocked) return toolOutput(`error: ${policy.notice}`);
			const out = await runEpisodePython(
				file,
				Math.min((cfg.script_timeout_s ?? 120) * 1000, Math.max(1, remainingMs())),
			);
			const notice = policy.notice ? `${policy.notice}\n\n` : "";
			if (out.includes("[execution timed out]")) {
				return toolOutput(
					notice +
					out +
						`\n\nForeground scripts are capped at ${cfg.script_timeout_s ?? 120}s. ` +
						`For long computations call start_job with this file — it runs in the background and the system wakes you when it finishes.`,
				);
			}
			return toolOutput(notice + out);
		},
	});

	// ---- background jobs: long computations (hours) without blocking turns ----
	const jobsDir = join(workspace, "jobs");
	mkdirSync(jobsDir, { recursive: true });
	const jobs = new BackgroundJobRegistry(
		{
			now: () => Date.now(),
			writeStatus: (job) => {
				try {
					writeFileSync(join(jobsDir, `${job.name}.status.json`), JSON.stringify({
						name: job.name, file: job.file, state: job.state, exitCode: job.exitCode,
						startedAt: job.startedAt, pid: job.pid, killVerified: job.killVerified,
						sandboxTargetPids: job.sandboxTargetPids,
					}, null, 2));
				} catch { /* best-effort evidence */ }
			},
			readLogTail: (name) => {
				try {
					const lines = readFileSync(join(jobsDir, `${name}.log`), "utf8").split(/\r?\n/).filter(Boolean);
					return lines.slice(-5).join(" | ").slice(-400);
				} catch { return ""; }
			},
			isAlive: isProcessAlive,
			terminate: terminateProcessTree,
		},
		(cfg.job_timeout_s ?? 14_400) * 1000,
	);
	const refreshJob = (job: BackgroundJob): BackgroundJob => jobs.refresh(job);
	const killJob = (job: BackgroundJob, state: "killed" | "timeout" = "killed"): void => {
		const stillAlive = jobs.kill(job, state);
		if (stillAlive.length > 0) log(`  [${opts.tag}] job ${job.name} kill could not be verified for pid(s): ${stillAlive.join(",")}`);
	};
	const jobStatusText = (): string => jobs.statusText();

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
			if (remainingMs() < 8_000) return toolOutput("error: episode deadline is too close to start a background job; submit the current best answer now");
			const file = resolveInWorkspace(workspace, params.file);
			if (!file) return toolOutput("error: job script must stay inside the workspace");
			if (!existsSync(file)) {
				return toolOutput(`error: file not found: ${params.file}`);
			}
			const policy = checkPythonExecutionPolicy(file, params.file, cfg.execution_policy ?? "audit");
			if (policy.blocked) return toolOutput(`error: ${policy.notice}`);
			if (policy.notice) log(`  [${opts.tag}] ${policy.notice}`);
			const name = (params.name ?? file.replace(/\.py$/, "")).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "job";
			if (jobs.has(name)) return toolOutput(`error: job "${name}" already exists — pick another name`);
			let child: ReturnType<typeof spawn>;
			let pid: number | undefined;
			let sandboxTargetPids: number[] | undefined;
			let wrapperPath: string | undefined;
			if (sandboxAdapter) {
				if (!sandboxRecord) return toolOutput("error: Sandboxie box was not prepared");
				const sandboxJob: SandboxieBackgroundRun = await sandboxAdapter.startPython({
					boxName: sandboxRecord.name,
					pythonCmd,
					scriptPath: file,
					cwd: workspace,
					stdoutPath: join(jobsDir, `${name}.log`),
					stderrPath: join(jobsDir, `${name}.stderr.log`),
					timeoutMs: (cfg.job_timeout_s ?? 14_400) * 1000,
					background: true,
				});
				child = sandboxJob.child;
				pid = sandboxJob.launcherPid;
				sandboxTargetPids = sandboxJob.targetPids;
				wrapperPath = sandboxJob.wrapperPath;
				sandboxRecord.pids.push(...sandboxJob.targetPids);
			} else {
				const logFd = openSync(join(jobsDir, `${name}.log`), "w");
				const jobEnv = sanitizeSandboxEnvironment();
				try {
					child = spawn(cfg.python_cmd, ["-u", file], {
						cwd: workspace,
						detached: true,
						stdio: ["ignore", logFd, logFd],
						windowsHide: true,
						env: jobEnv,
					});
				} finally {
					closeSync(logFd);
				}
				child.unref();
				pid = child.pid;
			}
			const j: BackgroundJob = {
				name,
				file,
				pid,
				startedAt: Date.now(),
				state: "running",
				exitCode: null,
				sandboxTargetPids,
				wrapperPath,
			};
			jobs.set(name, j);
			child.on("error", (error) => {
				jobs.recordProcessError(j);
				log(`  [${opts.tag}] job ${name} failed to start: ${error.message}`);
			});
			child.on("exit", (code) => {
				jobs.recordProcessExit(j, code);
				if (j.wrapperPath) {
					try {
						rmSync(j.wrapperPath, { force: true });
					} catch {
						/* best effort */
					}
				}
			});
			log(`  [${opts.tag}] job started: ${name} (${file}, pid ${pid})`);
			return toolOutput(
				`job "${name}" started (pid ${pid}). Log: jobs/${name}.log. ` +
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
			if (refreshJob(j).state !== "running") return toolOutput(`job "${params.name}" is already ${j.state}; no process signal was sent`);
			killJob(j, "killed");
			return toolOutput(
				j.state === "killed"
					? `job "${params.name}" killed and verified`
					: `error: job "${params.name}" kill could not be verified; episode cleanup will fail closed`,
			);
		},
	});

	/** Driver-side wait: poll running jobs until all finish, or stop/deadline hits. */
	const waitForJobs = async (): Promise<string[]> => {
		const finished: string[] = [];
		for (;;) {
			const running = [...jobs.values()].filter((j) => refreshJob(j).state === "running");
			if (running.length === 0) return finished;
			if (opts.controller?.stopRequested) {
				for (const j of running) killJob(j, "killed");
				finished.push(`${running.map((j) => j.name).join(",")} killed (stop requested)`);
				return finished;
			}
			if (Date.now() > t0 + cfg.episode_timeout_s * 1000) {
				for (const j of running) killJob(j, "killed");
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

	let submissionRecovered = false;
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
			const activeJobs = [...jobs.values()].filter((job) => refreshJob(job).state === "running");
			if (activeJobs.length > 0) {
				return toolOutput(`submission refused while background jobs are still writing (${activeJobs.map((job) => job.name).join(", ")}); wait for the driver wake-up first`);
			}
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
					// Deterministic, gold-free first-final preflight.
					if (isQuiz && params.final && st.submits === 0) {
						const quizPath = join(workspace, "data", "quiz.jsonl");
						if (existsSync(quizPath)) {
							const questions = readFileSync(quizPath, "utf8").split(/\r?\n/)
								.filter((line) => line.trim())
								.flatMap((line) => {
									try { return [JSON.parse(line) as { qid: string; kind?: string; options?: string[] | null }]; }
									catch { return []; }
								});
							const preflight = validateQuizSubmission(answer, questions);
							if (preflight.issues.length > 0) {
								return toolOutput(
									`submission refused — fix and resubmit (this refusal did not consume a submission):\n- ` +
										preflight.issues.join("\n- "),
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
			const changedAssets = verifyGradingAssets("public-preflight");
			if (changedAssets.length > 0) {
				return toolOutput(`submission refused: grading assets changed (${changedAssets.slice(0, 3).join(", ")})`);
			}
			st.submits += 1;
			const subPath = join(workspace, "solutions", `${problem.id}.json`);
			writeFileSync(subPath, JSON.stringify(answer, null, 2));
			const publicEvalTimeout = Math.min(
				(problem.overrides.eval_timeout_s ?? 60) * 1000,
				Math.max(1, remainingMs()),
			);
			const res: EvalResult = await runEval(problem, evalCtx, subPath, "public", publicEvalTimeout);
			const { improved } = recordPublicSubmission(st, answer, res.score, params.note ?? "");
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

	/**
	 * Recovery path for models that finish a turn after writing the canonical
	 * solution file but fail to emit the submit tool call (observed on the
	 * temporary emooo model during a long reasoning turn). This is not a
	 * hidden-score shortcut: it reads only the candidate in the exchange
	 * workspace and routes it through the exact same public evaluator and
	 * submission accounting as the tool.
	 */
	const recoverCandidateFile = async (phase: string): Promise<boolean> => {
		if (st.submits > 0) return false;
		const candidatePath = resolveInWorkspace(workspace, `solutions/${problem.id}.json`);
		if (!candidatePath || !existsSync(candidatePath)) return false;
		let parsed: unknown;
		try {
			parsed = JSON.parse(readFileSync(candidatePath, "utf8"));
		} catch {
			return false;
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) return false;
		const before = st.submits;
		try {
			await submit.execute(
				`driver-recovery-${phase}`,
				{
					answer: parsed as Record<string, unknown>,
					note: `driver recovered candidate after ${phase}`,
					final: false,
				},
				undefined,
				undefined,
				undefined as never,
			);
		} catch {
			return false;
		}
		if (st.submits <= before) return false;
		toolCallLog.push(`driver_recovery submit phase=${phase}`);
		submissionRecovered = true;
		log(`  [${opts.tag}] recovered candidate file through public submit (${phase})`);
		return true;
	};

	// memory recall (deterministic, no LLM)
	const memItems = recall(opts.memory, problem.id, problem.genre, 4);
	const memBlock = renderMemory(memItems);

	const harness = new PiHarness({
		model: inner,
		thinkingLevel: cfg.inner_thinking_level ?? "low",
		cwd: workspace,
		systemPrompt: composeSystemPrompt(scaffold, problem.genre) + renderKnowledge(kbSel) + renderRetrieved(ragDocs),
		customTools: [runPy, submit, startJob, jobStatus, killJobTool],
		exchangeToolGuard: () => {
			const active = [...jobs.values()].filter((job) => refreshJob(job).state === "running");
			if (active.length > 0) {
				throw new Error(`exchange file tools are unavailable while background Python jobs run (${active.map((job) => job.name).join(", ")}); wait for completion or kill the job first`);
			}
		},
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
	const warnings: string[] = [];

	try {
		await harness.init();
		const softSubmitTarget = Math.max(1, Math.min(cfg.eval_cap, Math.round(scaffold.eval_budget_hint || cfg.eval_cap)));
		const initial = buildInitialEpisodePrompt({
			statement: problem.statement,
			isQuiz,
			evalCap: cfg.eval_cap,
			softSubmitTarget,
			memoryBlock: memBlock,
		});
		log(`  [${opts.tag}] turn 1`);
		emit({ type: "episode_turn", tag: opts.tag, turn: 1, maxTurns: cfg.max_turns, note: problem.id });
		let out: PromptOutcome;
		if (remainingMs() <= 0) {
			out = { aborted: true, timedOut: true, stalled: false, error: "episode wall-clock cap reached before the first model turn", tokens: 0, secs: 0 };
		} else {
			out = await harness.prompt(initial, remainingMs());
		}
		const recoveredFirst = await recoverCandidateFile("turn-1");
		tokens += out.tokens;
		turns += 1;
		if (out.error && !recoveredFirst && st.submits === 0) lastError = out.error;
		if (out.error && (recoveredFirst || st.submits > 0)) warnings.push(`post-submit model turn warning: ${out.error}`);
		let canContinue = !out.error && !out.aborted;
		if (recoveredFirst && out.error) {
			log(`  [${opts.tag}] model turn ended with ${out.error}; recovered submission is authoritative`);
			canContinue = false;
		}

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
			const budgetLeft = cfg.eval_cap - st.submits;
			const nudge = buildFollowupPrompt({
				isQuiz,
				turnsCompleted: turns,
				submits: st.submits,
				budgetLeft,
				patience: cfg.patience,
				staleSubmits: st.staleSubmits,
				lastFeedback: st.lastFeedback,
				bestPublic: st.bestPublic,
				previousTurnAborted: out.aborted,
				jobWake,
			});
			log(`  [${opts.tag}] turn ${turn}: ${nudge.slice(0, 60)}...`);
			emit({ type: "episode_turn", tag: opts.tag, turn, maxTurns: cfg.max_turns, note: nudge.slice(0, 80) });
			out = await harness.prompt(nudge, remainingMs());
			const recovered = await recoverCandidateFile(`turn-${turn}`);
			tokens += out.tokens;
			turns += 1;
			if (out.error && !recovered && st.submits === 0) lastError = out.error;
			if (out.error && (recovered || st.submits > 0)) warnings.push(`post-submit model turn warning: ${out.error}`);
			canContinue = !out.error && !out.aborted;
			if (recovered && out.error) {
				log(`  [${opts.tag}] model turn ended with ${out.error}; recovered submission is authoritative`);
				canContinue = false;
			}
		}
	} finally {
		harness.dispose();
		// never leak detached compute processes past the episode
		for (const j of jobs.values()) {
			if (refreshJob(j).state === "running") {
				killJob(j, "killed");
				log(`  [${opts.tag}] job ${j.name} killed at episode end`);
			}
		}
		if (sandboxAdapter && sandboxRecord) {
			sandboxAdapter.terminateSync(sandboxRecord.name);
		}
	}

	if (sandboxAdapter && sandboxRecord) {
		try {
			sandboxCleanup = await sandboxAdapter.cleanupBox(sandboxRecord);
			sandboxRecord.cleanup = sandboxCleanup;
			if (sandboxCleanup.errors.length > 0 || sandboxCleanup.boxStillEnabled || !sandboxCleanup.terminated || !sandboxCleanup.leaseReleased) {
				sandboxCleanupError = `Sandboxie cleanup failed: ${sandboxCleanup.errors.slice(0, 3).join("; ") || "box remains enabled"}`;
			}
		} catch (cleanupError) {
			sandboxCleanupError = `Sandboxie cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
		} finally {
			unregisterSandboxExit();
		}
	}

	// Fitness is computed only after the agent box has been terminated, its
	// config removed, and global WFP state restored/read back. A cleanup failure
	// therefore cannot accidentally turn into a valid private score.
	let fitness: number | null = null;
	let error = sandboxCleanupError ?? lastError;
	if (submissionRecovered && !sandboxCleanupError) error = null;
	if (!sandboxCleanupError && (st.bestAnswer != null || st.answer != null)) {
		const changedAssets = verifyGradingAssets("private-preflight");
		if (changedAssets.length > 0) {
			error = `anti-cheat: grading assets changed before private evaluation (${changedAssets.slice(0, 3).join(", ")})`;
		} else if (remainingMs() <= 0) {
			error = "episode wall-clock cap reached before private evaluation";
		} else {
			const answer = st.bestAnswer ?? st.answer!;
			const subPath = join(workspace, "solutions", `${problem.id}.json`);
			writeFileSync(subPath, JSON.stringify(answer, null, 2));
			const privateEvalTimeout = Math.min(
				(problem.overrides.eval_timeout_s ?? 60) * 1000,
				Math.max(1, remainingMs()),
			);
			const priv = await runEval(problem, evalCtx, subPath, "private", privateEvalTimeout);
			fitness = priv.score;
			if (priv.score == null) error = priv.detail;
		}
	} else if (!sandboxCleanupError && st.bestAnswer == null && st.answer == null) {
		error = error ?? "no submission produced";
	}

	const result: EpisodeResult = {
		problemId: problem.id,
		fitness,
		bestPublic: sandboxCleanupError ? null : st.bestPublic,
		submits: st.submits,
		turns,
		tokens,
		secs: (Date.now() - t0) / 1000,
		error,
		warnings,
		publicHistory: st.publicHistory,
		workspace,
		durableWorkspace: requestedWorkspace,
		submissionRecovery: submissionRecovered ? "candidate-file-driver" : undefined,
		isolation: sandboxRecord
			? {
					backend: "sandboxie-app-level",
					boxName: sandboxRecord.name,
					exchangeWorkspace: workspace,
					reload: sandboxRecord.reload,
					processOwnershipVerified: sandboxRecord.pids.length > 0,
					networkProbe: sandboxRecord.networkProbe,
					cleanup: sandboxCleanup as unknown as Record<string, unknown> | undefined,
				}
			: { backend: "host-audit", exchangeWorkspace: workspace },
		knowledgeIds: kbSel.nodes.map((n) => n.id),
		knowledgeVersion: kbSel.version,
		ragDocumentIds: ragDocs.map((doc) => doc.id),
		ragCorpusVersion: cfg.rag_enabled ? corpusVersion() : undefined,
		answerCount: isQuiz ? Object.keys(st.bestAnswer ?? st.answer ?? {}).length : undefined,
		answerTotal: quizQuestionTotal,
	};

	let breaches = scanWorkspaceForBreaches(workspace);
	breaches.push(...scanTextForBreaches(toolCallLog.join("\n")));
	const tampered = verifyGradingAssets("final");
	for (const file of tampered) breaches.push({ file, pattern: "grading asset modified" });
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
	persistEpisodeArtifacts({
		workspace,
		requestedWorkspace,
		problemId: problem.id,
		result,
		selectedAnswer: st.bestAnswer ?? st.answer,
	});
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
