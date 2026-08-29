/**
 * RSI suite evaluation and learning commit helpers.
 *
 * The generation loop should decide *when* to evaluate and accept a
 * scaffold; this module owns *how* a scaffold is evaluated and how staged
 * learning is committed. Keeping those policies separate prevents rsi.ts
 * from becoming the implementation home for every concern.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { Config } from "./config.js";
import { ROOT } from "./config.js";
import { makeEvalContext, type Problem } from "./bench/eval.js";
import type { EpisodeRecord } from "./board.js";
import type { Scaffold } from "./scaffold.js";
import { solveEpisode, type EpisodeResult } from "./inner/solve.js";
import { addMemory, defaultObservation, snapshotMemory, type MemoryItem, type MemoryStore } from "./memory.js";
import { knowledgePath, recordUsage } from "./knowledge.js";
import type { RsiEvent } from "./tui/events.js";
import type { RunController } from "./loopctl.js";
import { weightedFitnessMean } from "./metrics.js";

export interface EvaluationLearning {
	memoryItems: MemoryItem[];
	knowledgeUsage: { ids: string[]; fitness: number }[];
}

export interface ScaffoldEvaluation {
	mean: number | null;
	detail: EpisodeRecord[];
	learning: EvaluationLearning;
}

export interface EvaluateScaffoldOptions {
	cfg: Config;
	problems: Problem[];
	scaffold: Scaffold;
	runDir: string;
	role: string;
	model: Model<any>;
	memory: MemoryStore;
	emit?: (ev: RsiEvent) => void;
	controller?: RunController;
	log?: (m: string) => void;
}

/** Evaluate a scaffold on a fixed memory snapshot; learning commits later. */
export async function evaluateScaffold(opts: EvaluateScaffoldOptions): Promise<ScaffoldEvaluation> {
	const { cfg, problems, scaffold, runDir, role, model, memory } = opts;
	const emit = opts.emit ?? (() => {});
	const controller = opts.controller;
	const log = opts.log ?? (() => {});
	const evalCtx = makeEvalContext(cfg, ROOT);
	const detail: EpisodeRecord[] = [];
	const evaluated: { problem: Problem; result: EpisodeResult }[] = [];
	const weighted: { fitness: number | null; weight: number }[] = [];
	const evalMemory = snapshotMemory(memory);
	const repeats = Math.max(1, Math.floor(cfg.episodes_per_problem || 1));
	for (let repeat = 0; repeat < repeats; repeat++) {
		for (const problem of problems) {
			await controller?.waitIfPaused();
			const tag = repeats === 1 ? `${role}-${problem.id}` : `${role}-r${repeat + 1}-${problem.id}`;
			const workspace = join(runDir, "episodes", tag);
			const result = await solveEpisode({
				cfg,
				problem,
				evalCtx,
				scaffold,
				model,
				workspace,
				memory: evalMemory,
				log,
				tag,
				emit,
				persistKnowledgeUsage: false,
			});
			evaluated.push({ problem, result });
			weighted.push({ fitness: result.fitness, weight: problem.weight });
			detail.push({
				problem: problem.id,
				fitness: result.fitness,
				bestPublic: result.bestPublic,
				submits: result.submits,
				secs: Math.round(result.secs),
				error: result.error,
			});
		}
	}
	// Fixed denominator: an ERR/null episode is a failed task, not missing data.
	if (problems.length === 0) return { mean: null, detail, learning: { memoryItems: [], knowledgeUsage: [] } };
	const mean = weightedFitnessMean(weighted);
	emit({
		type: "suite_done",
		mean,
		perProblem: detail.map((d) => ({ problem: d.problem, fitness: d.fitness })),
	});

	// Stage learning locally. Candidate, verification, and hold-out callers
	// decide later whether this evidence is allowed to enter durable state.
	const memoryItems: MemoryItem[] = [];
	const knowledgeUsage: { ids: string[]; fitness: number }[] = [];
	for (const { problem, result: res } of evaluated) {
		const obs = defaultObservation(res.problemId, res.bestPublic, res.fitness == null);
		for (const text of obs.slice(0, 1)) {
			memoryItems.push({
				ts: Date.now(),
				problem: res.problemId,
				genre: problem.genre,
				tag: res.error ? "failure" : "note",
				text,
				publicScore: res.bestPublic,
				confidence: "probation",
				evidence: {
					source: res.bestPublic != null ? "public_score" : "episode_outcome",
					score: res.bestPublic,
					repetitions: 1,
				},
			});
		}
		if (res.fitness != null && res.knowledgeIds.length > 0) {
			knowledgeUsage.push({ ids: res.knowledgeIds, fitness: res.fitness });
		}
	}
	return { mean, detail, learning: { memoryItems, knowledgeUsage } };
}

export function commitEvaluationLearning(memory: MemoryStore, learning: EvaluationLearning): void {
	for (const item of learning.memoryItems) addMemory(memory, item);
	for (const usage of learning.knowledgeUsage) recordUsage(usage.ids, usage.fitness);
}

/** Champion tips outlive their run. New tips are staged as probationary
 * knowledge; a later evidence pass can promote them to active. */
export function promoteChampionTipsToKnowledge(runName: string, gen: number, champion: Scaffold, problems: Problem[]): void {
	try {
		const genres = [...new Set(problems.map((p) => p.genre))];
		const tips = champion.tips
			.map((t) => (typeof t === "string" ? { text: t, genres: undefined as string[] | undefined } : t))
			.filter((t) => t.text?.trim());
		if (tips.length === 0) return;
		const path = knowledgePath();
		const existing = new Set<string>();
		for (const line of readFileSync(path, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				existing.add(JSON.parse(line).text as string);
			} catch {
				/* torn tail */
			}
		}
		const fresh = tips.filter((t) => !existing.has(t.text));
		if (fresh.length === 0) return;
		const stamp = Date.now().toString(36);
		const lines = fresh.map((t, i) =>
			JSON.stringify({
				id: `tip_${stamp}_${i}`,
				text: t.text.slice(0, 400),
				tags: t.genres?.length ? t.genres : genres,
				scope: t.genres?.length || genres.length === 1 ? "regional" : "generic",
				stats: { uses: 0, wins: 0, fitness_sum: 0 },
				origin: { run: runName, gen },
				status: "probation",
			}),
		);
		appendFileSync(path, lines.join("\n") + "\n");
		console.log(`[knowledge] staged ${fresh.length} champion tip(s) as probation from g${gen} of ${runName}`);
	} catch (e) {
		console.error(`[knowledge] promotion failed: ${(e as Error).message}`);
	}
}
