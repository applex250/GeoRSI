/**
 * Exam mode (考题): run a scaffold over the full problem suite — including
 * held-out problems never used during evolution — and produce a graded
 * report. Used both as the final gate of an RSI run and standalone to
 * validate the system end-to-end.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { ROOT } from "./config.js";
import { getPiRuntime } from "./provider.js";
import { loadProblems, makeEvalContext } from "./bench/eval.js";
import { SEED_SCAFFOLD, type Scaffold } from "./scaffold.js";
import { solveEpisode } from "./inner/solve.js";
import { emptyMemory } from "./memory.js";
import { atomicWriteJson, fingerprint, writeTextAtomic } from "./journal.js";
import { protectedManifest } from "./guard.js";
import { loadProfiles } from "./models.js";
import type { RunController } from "./loopctl.js";
import { TOKENS } from "./provider.js";
import { weightedFitnessMean } from "./metrics.js";

export interface ExamProblemResult {
	problem: string;
	heldout: boolean;
	weight: number;
	fitness: number | null;
	bestPublic: number | null;
	submits: number;
	secs: number;
	error: string | null;
	warnings: string[];
	tokens: number;
	submissionRecovery?: "candidate-file-driver";
	isolation?: Record<string, unknown>;
}

export interface ExamReport {
	scaffoldName: string;
	results: ExamProblemResult[];
	trainMean: number | null;
	heldoutMean: number | null;
	complete: boolean;
	summary: string;
}

function examGitSnapshot(): { commit: string | null; dirty: boolean | null } {
	const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true });
	const status = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8", windowsHide: true });
	return {
		commit: commit.status === 0 ? String(commit.stdout).trim() : null,
		dirty: status.status === 0 ? String(status.stdout).trim().length > 0 : null,
	};
}

export function examHasValidTrainingResult(results: readonly ExamProblemResult[]): boolean {
	return results.some((result) => !result.heldout && result.fitness != null);
}

export async function runExam(
	cfg: Config,
	scaffold: Scaffold,
	scaffoldName: string,
	runDir: string,
	log: (m: string) => void,
): Promise<ExamReport> {
	mkdirSync(runDir, { recursive: true });
	const { inner } = await getPiRuntime(cfg, ROOT);
	const problems = loadProblems(cfg, ROOT, true);
	const evalCtx = makeEvalContext(cfg, ROOT);
	// Exams must measure the supplied scaffold, not memories left by an
	// earlier run. Training episodes may build memory; standalone exams start
	// with an empty episodic store.
	const memory = emptyMemory(runDir);

	const results: ExamProblemResult[] = [];
	const repeats = Math.max(1, Math.floor(cfg.episodes_per_problem || 1));
	for (let repeat = 0; repeat < repeats; repeat++) {
		for (const problem of problems) {
			log(`[exam] ${problem.id}${problem.heldout ? " (held-out)" : ""} ...`);
			if (TOKENS.total >= cfg.cost_cap_tokens) {
				results.push({ problem: problem.id, heldout: problem.heldout, weight: problem.weight, fitness: null, bestPublic: null, submits: 0, secs: 0, error: "token budget exhausted", warnings: [], tokens: 0 });
				continue;
			}
			const res = await solveEpisode({
				cfg,
				problem,
				evalCtx,
				scaffold,
				model: inner,
				workspace: join(runDir, "exam", repeats === 1 ? problem.id : `r${repeat + 1}-${problem.id}`),
				memory,
				log,
				tag: repeats === 1 ? `exam-${problem.id}` : `exam-r${repeat + 1}-${problem.id}`,
				persistKnowledgeUsage: false,
			});
			results.push({
				problem: problem.id,
				heldout: problem.heldout,
				weight: problem.weight,
				fitness: res.fitness,
				bestPublic: res.bestPublic,
				submits: res.submits,
				secs: Math.round(res.secs),
				error: res.error,
				warnings: res.warnings,
				tokens: res.tokens,
				submissionRecovery: res.submissionRecovery,
				isolation: res.isolation as Record<string, unknown> | undefined,
			});
			log(`[exam] ${problem.id}: fitness=${res.fitness?.toFixed(4) ?? "ERR"} public=${res.bestPublic?.toFixed(4) ?? "—"} (${Math.round(res.secs)}s)`);
		}
	}

	const trainMean = weightedFitnessMean(
		results.filter((result) => !result.heldout).map((result) => ({ fitness: result.fitness, weight: result.weight })),
	);
	const heldoutMean = weightedFitnessMean(
		results.filter((result) => result.heldout).map((result) => ({ fitness: result.fitness, weight: result.weight })),
	);
	const summary = `train=${trainMean?.toFixed(4) ?? "ERR"} heldout=${heldoutMean?.toFixed(4) ?? "—"}`;

	const md =
		`# Exam Report — ${scaffoldName}\n\n` +
		`| problem | split | weight | fitness | best public | submits | secs | tokens | warnings | error |\n|---|---|---:|---:|---:|---:|---:|---:|---|---|\n` +
		results
			.map(
				(r) =>
					`| ${r.problem} | ${r.heldout ? "held-out" : "train"} | ${r.weight} | ${r.fitness?.toFixed(4) ?? "ERR"} | ${
						r.bestPublic?.toFixed(4) ?? "—"
					} | ${r.submits} | ${r.secs} | ${r.tokens} | ${r.warnings.join("; ").slice(0, 80)} | ${r.error ? r.error.slice(0, 60) : ""} |`,
			)
			.join("\n") +
		`\n\n**train mean = ${trainMean?.toFixed(4) ?? "ERR"}  ·  held-out mean = ${heldoutMean?.toFixed(4) ?? "—"}**\n`;
	writeTextAtomic(join(runDir, "RESULTS.md"), md);
	atomicWriteJson(join(runDir, "exam-report.json"), {
		version: 1,
		generatedAt: new Date().toISOString(),
		node: process.version,
		platform: `${process.platform}/${process.arch}`,
		git: examGitSnapshot(),
		model: cfg.inner_model,
		thinkingLevel: cfg.inner_thinking_level ?? "low",
		requestMaxTokens: process.env.RSILAB_REQUEST_MAX_TOKENS ?? "default",
		profileVersion: loadProfiles().version,
		profileFingerprint: fingerprint([loadProfiles()]),
		evaluationMetrics: { quizPublic: "public-dev-v1", quizPrivate: "private-only-v2" },
		repeats,
		config: cfg,
		scaffoldName,
		scaffold,
		problems: problems.map((problem) => ({
			id: problem.id,
			heldout: problem.heldout,
			weight: problem.weight,
			genre: problem.genre,
			gradingAssets: protectedManifest(
				problem.dir,
				existsSync(evalCtx.truthFile(problem.id)) ? [evalCtx.truthFile(problem.id)] : [],
			),
		})),
		results,
		trainMean,
		heldoutMean,
		validTrainingResults: results.filter((result) => !result.heldout && result.fitness != null).length,
	});
	return { scaffoldName, results, trainMean, heldoutMean, complete: results.length === problems.length * repeats && results.every((result) => result.fitness != null), summary };
}

/** Final gate of an RSI run: champion on the held-out problems. */
export async function runHeldoutExam(
	cfg: Config,
	runName: string,
	champion: Scaffold,
	log: (m: string) => void,
	controller?: RunController,
): Promise<ExamReport> {
	const runDir = join(ROOT, "runs", runName);
	mkdirSync(runDir, { recursive: true });
	const { inner } = await getPiRuntime(cfg, ROOT);
	const problems = loadProblems(cfg, ROOT, true).filter((p) => p.heldout);
	const evalCtx = makeEvalContext(cfg, ROOT);
	// Held-out must not receive train-episode memories. It tests the champion
	// scaffold with an independent episodic context.
	const memory = emptyMemory(runDir);

	const results: ExamProblemResult[] = [];
	const repeats = Math.max(1, Math.floor(cfg.episodes_per_problem || 1));
	for (let repeat = 0; repeat < repeats; repeat++) {
		for (const problem of problems) {
			await controller?.waitIfPaused();
			log(`[heldout] ${problem.id} ...`);
			if (controller?.stopRequested || TOKENS.total >= cfg.cost_cap_tokens) {
				results.push({
					problem: problem.id,
					heldout: true,
					weight: problem.weight,
					fitness: null,
					bestPublic: null,
					submits: 0,
					secs: 0,
					error: controller?.stopRequested ? "cancelled by operator" : "token budget exhausted",
					warnings: [],
					tokens: 0,
				});
				continue;
			}
			const res = await solveEpisode({
				cfg,
				problem,
				evalCtx,
				scaffold: champion,
				model: inner,
				workspace: join(runDir, "heldout", repeats === 1 ? problem.id : `r${repeat + 1}-${problem.id}`),
				memory,
				tag: repeats === 1 ? `heldout-${problem.id}` : `heldout-r${repeat + 1}-${problem.id}`,
				persistKnowledgeUsage: false,
				controller,
			});
			results.push({
				problem: problem.id,
				heldout: true,
				weight: problem.weight,
				fitness: res.fitness,
				bestPublic: res.bestPublic,
				submits: res.submits,
				secs: Math.round(res.secs),
				error: res.error,
				warnings: res.warnings,
				tokens: res.tokens,
				submissionRecovery: res.submissionRecovery,
				isolation: res.isolation as Record<string, unknown> | undefined,
			});
			log(`[heldout] ${problem.id}: fitness=${res.fitness?.toFixed(4) ?? "ERR"}`);
		}
	}
	const heldoutMean = weightedFitnessMean(results.map((result) => ({ fitness: result.fitness, weight: result.weight })));
	const md =
		`# Held-out Exam (champion, gen ${champion.generation})\n\n` +
		`| problem | weight | fitness | warnings | error |\n|---|---:|---:|---|---|\n` +
		results.map((r) => `| ${r.problem} | ${r.weight} | ${r.fitness?.toFixed(4) ?? "ERR"} | ${r.warnings.join("; ").slice(0, 80)} | ${r.error?.slice(0, 60) ?? ""} |`).join("\n") +
		`\n\n**held-out mean = ${heldoutMean?.toFixed(4) ?? "—"}**\n`;
	writeTextAtomic(join(runDir, "RESULTS.md"), md);
	atomicWriteJson(join(runDir, "heldout-report.json"), {
		version: 1,
		generatedAt: new Date().toISOString(),
		git: examGitSnapshot(),
		model: cfg.inner_model,
		thinkingLevel: cfg.inner_thinking_level ?? "low",
		profileVersion: loadProfiles().version,
		profileFingerprint: fingerprint([loadProfiles()]),
		evaluationMetrics: { quizPublic: "public-dev-v1", quizPrivate: "private-only-v2" },
		repeats,
		champion,
		results,
		heldoutMean,
	});
	return {
		scaffoldName: "champion",
		results,
		trainMean: null,
		heldoutMean,
		complete: results.length === problems.length * repeats && results.every((result) => result.fitness != null),
		summary: `heldout=${heldoutMean?.toFixed(4) ?? "—"}`,
	};
}

export { SEED_SCAFFOLD };
