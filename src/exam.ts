/**
 * Exam mode (考题): run a scaffold over the full problem suite — including
 * held-out problems never used during evolution — and produce a graded
 * report. Used both as the final gate of an RSI run and standalone to
 * validate the system end-to-end.
 */
import { join } from "node:path";
import type { Config } from "./config.js";
import { ROOT } from "./config.js";
import { getPiRuntime } from "./provider.js";
import { loadProblems, makeEvalContext } from "./bench/eval.js";
import { SEED_SCAFFOLD, type Scaffold } from "./scaffold.js";
import { solveEpisode } from "./inner/solve.js";
import { openMemory } from "./memory.js";
import { writeTextAtomic } from "./journal.js";

export interface ExamProblemResult {
	problem: string;
	heldout: boolean;
	fitness: number | null;
	bestPublic: number | null;
	submits: number;
	secs: number;
	error: string | null;
}

export interface ExamReport {
	scaffoldName: string;
	results: ExamProblemResult[];
	trainMean: number | null;
	heldoutMean: number | null;
	summary: string;
}

export async function runExam(
	cfg: Config,
	scaffold: Scaffold,
	scaffoldName: string,
	runDir: string,
	log: (m: string) => void,
): Promise<ExamReport> {
	const { inner } = await getPiRuntime(cfg, ROOT);
	const problems = loadProblems(cfg, ROOT, true);
	const evalCtx = makeEvalContext(cfg, ROOT);
	const memory = openMemory(runDir);

	const results: ExamProblemResult[] = [];
	for (const p of problems) {
		log(`[exam] ${p.id}${p.heldout ? " (held-out)" : ""} ...`);
		const res = await solveEpisode({
			cfg,
			problem: p,
			evalCtx,
			scaffold,
			model: inner,
			workspace: join(runDir, "exam", p.id),
			memory,
			log,
			tag: `exam-${p.id}`,
		});
		results.push({
			problem: p.id,
			heldout: p.heldout,
			fitness: res.fitness,
			bestPublic: res.bestPublic,
			submits: res.submits,
			secs: Math.round(res.secs),
			error: res.error,
		});
		log(
			`[exam] ${p.id}: fitness=${res.fitness?.toFixed(4) ?? "ERR"} public=${res.bestPublic?.toFixed(4) ?? "—"} (${Math.round(res.secs)}s)`,
		);
	}

	const trainMean = meanOf(results.filter((r) => !r.heldout).map((r) => r.fitness));
	const heldoutMean = meanOf(results.filter((r) => r.heldout).map((r) => r.fitness));
	const summary = `train=${trainMean?.toFixed(4) ?? "ERR"} heldout=${heldoutMean?.toFixed(4) ?? "—"}`;

	const md =
		`# Exam Report — ${scaffoldName}\n\n` +
		`| problem | split | fitness | best public | submits | secs | error |\n|---|---|---|---|---|---|---|\n` +
		results
			.map(
				(r) =>
					`| ${r.problem} | ${r.heldout ? "held-out" : "train"} | ${r.fitness?.toFixed(4) ?? "ERR"} | ${
						r.bestPublic?.toFixed(4) ?? "—"
					} | ${r.submits} | ${r.secs} | ${r.error ? r.error.slice(0, 60) : ""} |`,
			)
			.join("\n") +
		`\n\n**train mean = ${trainMean?.toFixed(4) ?? "ERR"}  ·  held-out mean = ${heldoutMean?.toFixed(4) ?? "—"}**\n`;
	writeTextAtomic(join(runDir, "RESULTS.md"), md);
	return { scaffoldName, results, trainMean, heldoutMean, summary };
}

/** Final gate of an RSI run: champion on the held-out problems. */
export async function runHeldoutExam(
	cfg: Config,
	runName: string,
	champion: Scaffold,
	log: (m: string) => void,
): Promise<ExamReport> {
	const runDir = join(ROOT, "runs", runName);
	const { inner } = await getPiRuntime(cfg, ROOT);
	const problems = loadProblems(cfg, ROOT, true).filter((p) => p.heldout);
	const evalCtx = makeEvalContext(cfg, ROOT);
	const memory = openMemory(runDir);

	const results: ExamProblemResult[] = [];
	for (const p of problems) {
		log(`[heldout] ${p.id} ...`);
		const res = await solveEpisode({
			cfg,
			problem: p,
			evalCtx,
			scaffold: champion,
			model: inner,
			workspace: join(runDir, "heldout", p.id),
			memory,
			tag: `heldout-${p.id}`,
		});
		results.push({
			problem: p.id,
			heldout: true,
			fitness: res.fitness,
			bestPublic: res.bestPublic,
			submits: res.submits,
			secs: Math.round(res.secs),
			error: res.error,
		});
		log(`[heldout] ${p.id}: fitness=${res.fitness?.toFixed(4) ?? "ERR"}`);
	}
	const heldoutMean = meanOf(results.map((r) => r.fitness));
	const md =
		`# Held-out Exam (champion, gen ${champion.generation})\n\n` +
		`| problem | fitness | error |\n|---|---|---|\n` +
		results.map((r) => `| ${r.problem} | ${r.fitness?.toFixed(4) ?? "ERR"} | ${r.error?.slice(0, 60) ?? ""} |`).join("\n") +
		`\n\n**held-out mean = ${heldoutMean?.toFixed(4) ?? "—"}**\n`;
	writeTextAtomic(join(runDir, "RESULTS.md"), md);
	return {
		scaffoldName: "champion",
		results,
		trainMean: null,
		heldoutMean,
		summary: `heldout=${heldoutMean?.toFixed(4) ?? "—"}`,
	};
}

function meanOf(xs: (number | null)[]): number | null {
	const v = xs.filter((x): x is number => x != null);
	if (v.length === 0) return null;
	return v.reduce((a, b) => a + b, 0) / v.length;
}

export { SEED_SCAFFOLD };
