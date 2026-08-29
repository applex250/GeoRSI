/**
 * Problem bench: geoscience tasks with the two-split eval protocol.
 *
 * Each problem directory under problems/<id>/ provides:
 *   - statement.md        task text shown to the inner agent
 *   - data/               datasets the agent may read
 *   - eval.py             scores a submission: prints `##SCORE##<float>` + a
 *                         JSON detail line. `--split public` uses reference
 *                         truth (agent-visible), `--split private` reads the
 *                         truth file given by env RSILAB_PRIVATE_TRUTH, which
 *                         lives OUTSIDE this tree.
 *
 * The agent only ever sees public scores. Selection in the outer loop uses
 * private scores. This is the structural defense against reward hacking.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { terminateProcessTree } from "../process.js";
import type { Config, ProblemSpec } from "../config.js";

export interface ProblemOverride {
	type?: "standard" | "quiz";
	genre?: string;
	/** execution backend override for this task */
	execution_backend?: "sandboxie" | "host-audit";
	/** execution policy override for this task's Python scripts */
	execution_policy?: "audit" | "restricted";
	/** eval needs the LLM judge on private split (credentials injected) */
	judge?: boolean;
	/** isolated python env for this problem (e.g. the GIS venv) */
	python_cmd?: string;
	/** per-eval timeout seconds (oracle references may run minutes) */
	eval_timeout_s?: number;
	max_turns?: number;
	eval_cap?: number;
	episode_timeout_s?: number;
	patience?: number;
	script_timeout_s?: number;
	job_timeout_s?: number;
	/** per-problem inner model override (task-to-model routing, e.g. quiz
	 * batches -> the cheap fast Pareto winner instead of the heavy default) */
	inner_model?: string;
	/** eval grades against an in-repo reference (deterministic scoring) -
	 * exempt from the outside-tree private-truth requirement */
	self_graded?: boolean;
}

export interface Problem {
	id: string;
	dir: string;
	statement: string;
	weight: number;
	heldout: boolean;
	genre: string;
	/** per-problem config overrides from problem.json (quiz batches, long jobs) */
	overrides: ProblemOverride;
}

export interface EvalResult {
	score: number | null;
	detail: string;
	secs: number;
}

/** Read problems/<id>/problem.json overrides if present. */
function loadOverrides(dir: string): ProblemOverride {
	const p = join(dir, "problem.json");
	if (!existsSync(p)) return {};
	try {
		return JSON.parse(readFileSync(p, "utf8")) as ProblemOverride;
	} catch {
		return {};
	}
}

export function loadProblems(cfg: Config, root: string, includeHeldout = false): Problem[] {
	const out: Problem[] = [];
	for (const spec of cfg.problems as ProblemSpec[]) {
		if (spec.heldout && !includeHeldout) continue;
		const dir = join(root, "problems", spec.id);
		const statementPath = join(dir, spec.statement ?? "statement.md");
		if (!existsSync(statementPath)) {
			throw new Error(`problem "${spec.id}": missing ${statementPath}`);
		}
		const overrides = loadOverrides(dir);
		out.push({
			id: spec.id,
			dir,
			statement: readFileSync(statementPath, "utf8"),
			weight: spec.weight ?? 1,
			heldout: spec.heldout ?? false,
			genre: (spec as { genre?: string }).genre ?? overrides.genre ?? guessGenre(spec.id),
			overrides,
		});
	}
	return out;
}

/** Cheap deterministic genre guess — zero-cost routing without an LLM call. */
export function guessGenre(id: string): string {
	if (/quake|seis|b_val/.test(id)) return "seismology";
	if (/flood|hydro|river/.test(id)) return "hydrology";
	if (/climate|temp|precip/.test(id)) return "climatology";
	if (/poro|perm|well|core|log/.test(id)) return "petrophysics";
	return "general";
}

export interface AdHocProblem {
	problem: Problem;
	truthPath: string;
	warnings: string[];
}

/**
 * Load a user-scaffolded research problem from any directory (the /research
 * extension flow). Requires statement.md + eval.py; data/ and
 * private_truth.txt are strongly recommended and warned when missing.
 */
export function loadAdHocProblem(dir: string): AdHocProblem {
	const warnings: string[] = [];
	const statementPath = join(dir, "statement.md");
	const evalPath = join(dir, "eval.py");
	if (!existsSync(statementPath)) throw new Error(`missing ${statementPath} — run the scaffold first and fill it in`);
	if (!existsSync(evalPath)) throw new Error(`missing ${evalPath} — run the scaffold first and fill it in`);
	if (!existsSync(join(dir, "data"))) warnings.push("no data/ directory: the agent will have no dataset to analyze");
	const id = dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "research";
	const truthPath = join(dir, "private_truth.txt");
	// fallback: lab problems keep their truth outside the tree
	const labTruth = join(dir, "..", "..", "..", "rsi-lab-private", `${id}.txt`);
	const effectiveTruth = existsSync(truthPath) ? truthPath : existsSync(labTruth) ? labTruth : truthPath;
	if (!existsSync(effectiveTruth)) warnings.push("no private_truth.txt: private scoring will fail (public split still works)");
	return {
		problem: {
			id,
			dir,
			statement: readFileSync(statementPath, "utf8"),
			weight: 1,
			heldout: false,
			genre: guessGenre(id),
			overrides: loadOverrides(dir),
		},
		truthPath: effectiveTruth,
		warnings,
	};
}

export interface EvalContext {
	pythonCmd: string;
	privateTruthDir: string;
	/** per-problem truth filename inside privateTruthDir */
	truthFile: (problemId: string) => string;
	/** gateway credentials for LLM-judge evals (private splits only) */
	judgeEnv?: Record<string, string>;
}

export function makeEvalContext(cfg: Config, root: string): EvalContext {
	// judge credentials for problems whose eval needs LLM grading (private split
	// only; never present in the agent's own python subprocesses)
	let judgeEnv: Record<string, string> | undefined;
	const p = join(root, "api_key.txt");
	if (existsSync(p)) {
		judgeEnv = {
			RSILAB_JUDGE_BASE: cfg.base_url,
			RSILAB_JUDGE_KEY: readFileSync(p, "utf8").trim(),
			RSILAB_JUDGE_MODEL: (cfg as { judge?: { model?: string } }).judge?.model ?? "hy3",
		};
	}
	return {
		pythonCmd: cfg.python_cmd,
		privateTruthDir: join(root, cfg.private_truth_dir),
		truthFile: (id) => join(root, cfg.private_truth_dir, `${id}.txt`),
		judgeEnv,
	};
}

/**
 * Run a problem's eval.py on a submission file.
 * Deterministic-first: we only parse the ##SCORE## marker; no LLM judging.
 */
export function runEval(
	problem: Problem,
	ctx: EvalContext,
	submissionPath: string,
	split: "public" | "private",
	timeoutMs = 60_000,
): Promise<EvalResult> {
	return new Promise((resolve) => {
		const t0 = Date.now();
		const args = [
			join(problem.dir, "eval.py"),
			"--submission",
			submissionPath,
			"--split",
			split,
		];
		const env = { ...process.env, PYTHONIOENCODING: "utf-8" } as NodeJS.ProcessEnv;
		if (split === "private" && ctx.judgeEnv && problem.overrides.judge) {
			Object.assign(env, ctx.judgeEnv);
		}
		if (split === "private" && problem.overrides?.type !== "quiz" && !problem.overrides?.judge && !problem.overrides?.self_graded) {
			// quiz batches carry gold in answers.private.jsonl; judge/oracle
			// problems grade internally against a hidden reference — neither
			// needs the outside-tree truth file; standard problems do
			const truth = ctx.truthFile(problem.id);
			if (!existsSync(truth)) {
				resolve({ score: null, detail: `private truth missing: ${truth}`, secs: 0 });
				return;
			}
			env.RSILAB_PRIVATE_TRUTH = truth;
		}
		const child = spawn(problem.overrides.python_cmd ?? ctx.pythonCmd, args, {
			env,
			windowsHide: true,
			detached: process.platform !== "win32",
		});
		let out = "";
		let err = "";
		const timer = setTimeout(() => {
			terminateProcessTree(child.pid);
			resolve({ score: null, detail: "eval timeout", secs: (Date.now() - t0) / 1000 });
		}, timeoutMs);
		child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
		child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
		child.on("error", (e) => {
			clearTimeout(timer);
			resolve({ score: null, detail: `spawn failed: ${e.message}`, secs: (Date.now() - t0) / 1000 });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			const secs = (Date.now() - t0) / 1000;
			if (code !== 0) {
				resolve({ score: null, detail: `eval exit ${code}: ${err.slice(-300)}`, secs });
				return;
			}
			for (const line of out.split(/\r?\n/)) {
				if (line.startsWith("##SCORE##")) {
					const v = Number(line.slice("##SCORE##".length).trim());
					if (Number.isFinite(v)) {
						resolve({ score: v, detail: extractJson(out), secs });
						return;
					}
				}
			}
			resolve({ score: null, detail: "no ##SCORE## marker", secs });
		});
	});
}

function extractJson(out: string): string {
	for (const line of out.split(/\r?\n/)) {
		const t = line.trim();
		if (t.startsWith("{") && t.endsWith("}")) return t;
	}
	return out.slice(0, 400);
}
