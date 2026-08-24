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
import type { Config, ProblemSpec } from "../config.js";

export interface Problem {
	id: string;
	dir: string;
	statement: string;
	weight: number;
	heldout: boolean;
	genre: string;
}

export interface EvalResult {
	score: number | null;
	detail: string;
	secs: number;
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
		out.push({
			id: spec.id,
			dir,
			statement: readFileSync(statementPath, "utf8"),
			weight: spec.weight ?? 1,
			heldout: spec.heldout ?? false,
			genre: (spec as { genre?: string }).genre ?? guessGenre(spec.id),
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
}

export function makeEvalContext(cfg: Config, root: string): EvalContext {
	return {
		pythonCmd: cfg.python_cmd,
		privateTruthDir: join(root, cfg.private_truth_dir),
		truthFile: (id) => join(root, cfg.private_truth_dir, `${id}.txt`),
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
		if (split === "private") {
			const truth = ctx.truthFile(problem.id);
			if (!existsSync(truth)) {
				resolve({ score: null, detail: `private truth missing: ${truth}`, secs: 0 });
				return;
			}
			env.RSILAB_PRIVATE_TRUTH = truth;
		}
		const child = spawn(ctx.pythonCmd, args, { env, windowsHide: true });
		let out = "";
		let err = "";
		const timer = setTimeout(() => {
			child.kill();
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
