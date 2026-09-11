/** Frozen, model-independent protocol for fair research benchmark comparisons. */
import { createHash } from "node:crypto";
import { stableJson } from "./event-ledger.js";
import type { MissionDataset, ResearchTaskFamily } from "./contracts.js";
import { validateResearchModelConfig, type ResearchModelConfig } from "../config.js";

export type ResearchBenchmarkStage = "stage-a" | "stage-b" | "held-out";

export interface ResearchBenchmarkTask {
	id: string;
	family: ResearchTaskFamily;
	weight: number;
	/** A task is public for strategy development; held-out tasks are never tuned against. */
	public: boolean;
	heldOut: boolean;
	/** Data contract binding every mission run of this task to one fixed seeded dataset (#65):
	 * two runs of the same task are comparable ONLY when the dataset contract matches. */
	dataset?: MissionDataset;
}

export interface ResearchBenchmarkManifest {
	version: 1;
	id: string;
	frozen: boolean;
	modelPolicy: ResearchModelConfig;
	strategyFingerprint: string;
	repetitions: number[];
	stages: {
		"stage-a": ResearchBenchmarkTask[];
		"stage-b": ResearchBenchmarkTask[];
		"held-out": ResearchBenchmarkTask[];
	};
	selection: {
		scoreBand: number;
		minimumValidRate: number;
		minimumRepetitions: number;
	};
	protocolVersion: "research-competition-v1";
}

export const RESEARCH_BENCHMARK_MANIFEST: ResearchBenchmarkManifest = {
	version: 1,
	id: "georsi-research-competition-v1",
	frozen: false,
	modelPolicy: {
		provider: "alsl",
		base_url: "https://ai.alsl.xyz/v1",
		model: "gpt-5.6-luna",
		api: "openai-responses",
		thinking_level: "xhigh",
		max_tokens_field: "max_completion_tokens",
		credential_env: "GEORSI_RESEARCH_API_KEY",
		fallback: "none",
		context_window: 600000,
		max_output: 128000,
		supports_developer_role: true,
		supports_reasoning_effort: true,
		supports_usage: true,
		supports_tool_loop: true,
		require_provider_observed_thinking: true,
	},
	strategyFingerprint: "f0aba011e0467d40f85f5b05",
	repetitions: [1, 2],
	stages: {
		"stage-a": [
			{ id: "quake_b", family: "quantitative", weight: 1, public: true, heldOut: false, dataset: { type: "synthetic", description: "Synthetic Gutenberg-Richter catalog fixture; Poisson arrivals in time, magnitudes sampled from GR law with true b=1.0 above completeness; all parameters binding for reproducibility.", seed: 20260909, params: { catalogSize: 1000, magnitudeRange: [0.5, 7.5], completenessMc: 2.0, trueB: 1.0, noiseModel: "poisson-arrival", rounding: 0.1 } } },
			{ id: "flood_rp", family: "quantitative", weight: 1, public: true, heldOut: false, dataset: { type: "synthetic", description: "Synthetic annual flood-peak series; log-Pearson III parent with fixed return-period truth; parameters binding for reproducibility.", seed: 20260910, params: { years: 80, distribution: "log-pearson-iii", returnPeriods: [10, 50, 100], rounding: 0.01 } } },
			{ id: "climate_trend", family: "quantitative", weight: 1, public: true, heldOut: false, dataset: { type: "synthetic", description: "Synthetic annual temperature series with linear warming trend, AR(1) noise, and fixed break point; parameters binding for reproducibility.", seed: 20260911, params: { years: 120, trendCPerDecade: 0.18, ar1: 0.4, noiseSigma: 0.25, breakYear: 1985 } } },
			{ id: "gabench_54", family: "gis-remote-sensing", weight: 1, public: true, heldOut: false, dataset: { type: "synthetic", description: "Synthetic raster pair (reference vs classified) with fixed class proportions and spatial autocorrelation; parameters binding for reproducibility.", seed: 20260912, params: { rows: 256, cols: 256, classes: 5, spatialAutocorr: 0.6 } } },
			{ id: "quake_b_real", family: "capstone", weight: 1, public: true, heldOut: false, dataset: { type: "file", description: "Real catalog subset bound to a repository-relative source file; the fingerprint of the file is captured at run time.", seed: 20260913, path: "problems/quake_b_real/dataset.csv", params: { minMagnitude: 2.0 } } },
		],
		"stage-b": [
			{ id: "research-capstone-seismic-gis", family: "capstone", weight: 1, public: true, heldOut: false },
			{ id: "research-remote-sensing-crs", family: "gis-remote-sensing", weight: 1, public: true, heldOut: false },
			{ id: "research-literature-completeness", family: "literature-hypothesis", weight: 1, public: true, heldOut: false },
			{ id: "research-quantitative-uncertainty", family: "quantitative", weight: 1, public: true, heldOut: false },
		],
		"held-out": [
			{ id: "poro_perm", family: "quantitative", weight: 1, public: false, heldOut: true },
		],
	},
	selection: { scoreBand: 0.01, minimumValidRate: 1, minimumRepetitions: 2 },
	protocolVersion: "research-competition-v1",
};

function tasks(manifest: ResearchBenchmarkManifest): ResearchBenchmarkTask[] {
	return [...manifest.stages["stage-a"], ...manifest.stages["stage-b"], ...manifest.stages["held-out"]];
}

export function validateResearchBenchmarkManifest(manifest: ResearchBenchmarkManifest, requireFrozen = false): string[] {
	const issues: string[] = [];
	if (manifest.version !== 1 || manifest.protocolVersion !== "research-competition-v1") issues.push("unsupported research benchmark manifest version");
	if (!manifest.id.trim()) issues.push("benchmark manifest id is required");
	if (!manifest.modelPolicy) issues.push("benchmark must bind one research_model policy");
	else if (validateResearchModelConfig(manifest.modelPolicy).length > 0 || manifest.modelPolicy.fallback !== "none" || manifest.modelPolicy.thinking_level !== "xhigh") issues.push("benchmark must bind one valid xhigh research_model policy with no fallback");
	if (!manifest.strategyFingerprint.trim() || !/^[a-f0-9]{24}$/i.test(manifest.strategyFingerprint)) issues.push("benchmark must bind a 24-character StrategyBundle fingerprint");
	if (manifest.repetitions.length < manifest.selection.minimumRepetitions || manifest.repetitions.some((value) => !Number.isSafeInteger(value) || value <= 0) || new Set(manifest.repetitions).size !== manifest.repetitions.length) issues.push("benchmark repetitions must be unique positive integers and meet the minimum");
	if (!Number.isFinite(manifest.selection.scoreBand) || manifest.selection.scoreBand < 0 || manifest.selection.scoreBand > 0.01) issues.push("selection score band must be within 0..0.01");
	if (!Number.isFinite(manifest.selection.minimumValidRate) || manifest.selection.minimumValidRate < 0 || manifest.selection.minimumValidRate > 1) issues.push("minimum valid rate must be within 0..1");
	if (manifest.stages["stage-a"].length !== 5) issues.push("Stage-A must contain exactly five fixed tasks");
	if (manifest.stages["stage-b"].length === 0) issues.push("Stage-B must contain at least one family task");
	if (manifest.stages["held-out"].length === 0) issues.push("held-out must contain at least one task");
	const ids = new Set<string>();
	for (const [stage, stageTasks] of Object.entries(manifest.stages) as [ResearchBenchmarkStage, ResearchBenchmarkTask[]][]) {
		for (const task of stageTasks) {
			if (!task.id.trim() || ids.has(task.id)) issues.push(`duplicate benchmark task id: ${task.id}`);
			ids.add(task.id);
			if (!Number.isFinite(task.weight) || task.weight <= 0) issues.push(`benchmark task ${task.id} weight must be positive`);
			if (stage === "held-out" && (!task.heldOut || task.public)) issues.push(`held-out task ${task.id} must be private and marked heldOut`);
			if (stage !== "held-out" && (task.heldOut || !task.public)) issues.push(`development task ${task.id} cannot be held-out/private`);
			if (task.dataset !== undefined) {
				if (task.dataset.type !== "synthetic" && task.dataset.type !== "file") issues.push(`benchmark task ${task.id} dataset.type must be synthetic or file`);
				if (!task.dataset.description.trim()) issues.push(`benchmark task ${task.id} dataset.description is required`);
				if (task.dataset.seed === undefined) issues.push(`benchmark task ${task.id} must bind a dataset seed`);
				if (task.dataset.seed !== undefined && (!Number.isSafeInteger(task.dataset.seed) || task.dataset.seed < 0)) issues.push(`benchmark task ${task.id} dataset.seed must be a non-negative integer`);
				if (task.dataset.type === "file" && (!task.dataset.path || task.dataset.path.includes(".."))) issues.push(`benchmark task ${task.id} file dataset.path is required and must be relative`);
			}
		}
	}
	if (requireFrozen && !manifest.frozen) issues.push("held-out evaluation requires a frozen manifest");
	return issues;
}

export function freezeResearchBenchmarkManifest(manifest: ResearchBenchmarkManifest): ResearchBenchmarkManifest {
	const issues = validateResearchBenchmarkManifest({ ...manifest, frozen: true });
	if (issues.length > 0) throw new Error(`cannot freeze invalid benchmark manifest: ${issues.join("; ")}`);
	return structuredClone({ ...manifest, frozen: true });
}

export function researchBenchmarkManifestFingerprint(manifest: ResearchBenchmarkManifest): string {
	return createHash("sha256").update(stableJson(manifest)).digest("hex").slice(0, 24);
}

export function benchmarkTasksForStage(manifest: ResearchBenchmarkManifest, stage: ResearchBenchmarkStage): ResearchBenchmarkTask[] {
	if (validateResearchBenchmarkManifest(manifest, stage === "held-out").length > 0) throw new Error("invalid research benchmark manifest");
	return manifest.stages[stage].map((task) => ({ ...task }));
}

export function benchmarkTaskDenominator(manifest: ResearchBenchmarkManifest, stage: ResearchBenchmarkStage): number {
	return benchmarkTasksForStage(manifest, stage).reduce((sum, task) => sum + task.weight, 0);
}

export function benchmarkManifestUsesOnlyFrozenHeldOut(manifest: ResearchBenchmarkManifest): boolean {
	return manifest.frozen && validateResearchBenchmarkManifest(manifest, true).length === 0 && tasks(manifest).filter((task) => task.heldOut).every((task) => !task.public);
}

/** One completed (or attempted) benchmark run of a single task repetition. */
export interface BenchmarkRunRecord {
	taskId: string;
	stage: ResearchBenchmarkStage;
	repetition: number;
	runDir: string;
	scienceScore: number | null;
	overallScore: number | null;
	validRate: number;
	eligible: boolean;
	totalTokens: number;
}

export interface BenchmarkStageAggregate {
	stage: ResearchBenchmarkStage;
	/** Weighted mean of per-task mean scienceScore (ineligible/missing scores count as 0 — honest). */
	weightedScienceScore: number;
	meanValidRate: number;
	/** Runs missing from the manifest's repetition plan — a benchmark report with gaps is not promotable. */
	missingRepetitions: { taskId: string; repetition: number }[];
	ineligibleTaskIds: string[];
	denominator: number;
}

export interface BenchmarkAggregate {
	manifestId: string;
	manifestFingerprint: string;
	manifestFrozen: boolean;
	generatedAt: string;
	records: BenchmarkRunRecord[];
	stages: Record<BenchmarkStageAggregate["stage"], BenchmarkStageAggregate>;
	/** Development-stage overall (stage-a + stage-b). Held-out is reported separately and
	 * only meaningful on a frozen manifest — it is never averaged into development scores. */
	developmentOverall: number | null;
	heldOutScore: number | null;
	issues: string[];
}

function mean(values: readonly number[]): number {
	return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Pure aggregation: benchmark math with honest gaps. Missing repetitions and ineligible
 * runs never silently raise the score — they drag it toward zero and are listed. */
export function aggregateBenchmarkRuns(manifest: ResearchBenchmarkManifest, records: readonly BenchmarkRunRecord[], now = new Date()): BenchmarkAggregate {
	const issues = validateResearchBenchmarkManifest(manifest);
	if (issues.length > 0) throw new Error(`cannot aggregate over an invalid benchmark manifest: ${issues.join("; ")}`);
	const seen = new Set<string>();
	const problems: string[] = [];
	const byTask = new Map<string, BenchmarkRunRecord[]>();
	for (const record of records) {
		const key = `${record.taskId}__rep${record.repetition}`;
		if (seen.has(key)) problems.push(`duplicate benchmark record: ${key}`);
		seen.add(key);
		const stage = (["stage-a", "stage-b", "held-out"] as const).find((candidate) => manifest.stages[candidate].some((task) => task.id === record.taskId));
		if (!stage) {
			problems.push(`unknown benchmark task: ${record.taskId}`);
			continue;
		}
		if (stage !== record.stage) problems.push(`task ${record.taskId} reported under stage ${record.stage} but lives in ${stage}`);
		const bucket = byTask.get(`${stage}::${record.taskId}`) ?? [];
		bucket.push(record);
		byTask.set(`${stage}::${record.taskId}`, bucket);
	}

	const stages = {} as Record<BenchmarkStageAggregate["stage"], BenchmarkStageAggregate>;
	for (const stage of ["stage-a", "stage-b", "held-out"] as const) {
		// Direct stage iteration (already validated above); benchmarkTasksForStage would
		// require a frozen manifest even for development-stage aggregation.
		const stageTasks = manifest.stages[stage];
		let weighted = 0;
		let weightSum = 0;
		let validWeighted = 0;
		const missing: { taskId: string; repetition: number }[] = [];
		const ineligible: string[] = [];
		for (const task of stageTasks) {
			const runs = byTask.get(`${stage}::${task.id}`) ?? [];
			for (const repetition of manifest.repetitions) {
				if (!runs.some((run) => run.repetition === repetition)) missing.push({ taskId: task.id, repetition });
			}
			const scores = runs.map((run) => run.scienceScore ?? 0);
			weighted += task.weight * mean(scores);
			validWeighted += task.weight * mean(runs.map((run) => run.validRate));
			weightSum += task.weight;
			if (runs.some((run) => !run.eligible)) ineligible.push(task.id);
		}
		stages[stage] = {
			stage,
			weightedScienceScore: weightSum > 0 ? weighted / weightSum : 0,
			meanValidRate: weightSum > 0 ? validWeighted / weightSum : 0,
			missingRepetitions: missing,
			ineligibleTaskIds: ineligible,
			denominator: weightSum,
		};
	}

	const development = mean([stages["stage-a"].weightedScienceScore, stages["stage-b"].weightedScienceScore]);
	const hasDevelopmentRuns = records.some((record) => record.stage !== "held-out");
	const hasHeldOutRuns = records.some((record) => record.stage === "held-out");
	return {
		manifestId: manifest.id,
		manifestFingerprint: researchBenchmarkManifestFingerprint(manifest),
		manifestFrozen: manifest.frozen,
		generatedAt: now.toISOString(),
		records: records.map((record) => ({ ...record })),
		stages,
		developmentOverall: hasDevelopmentRuns ? development : null,
		heldOutScore: hasHeldOutRuns ? stages["held-out"].weightedScienceScore : null,
		issues: problems,
	};
}

/** Parse one run directory (research-score.json + runtime-attestation.json + plan.json)
 * into a benchmark record; missing artifacts become honest zeros, never throws. */
export function benchmarkRecordFromArtifacts(taskId: string, stage: ResearchBenchmarkStage, repetition: number, runDir: string, readJson: (path: string) => unknown): BenchmarkRunRecord {
	let scienceScore: number | null = null;
	let overallScore: number | null = null;
	let eligible = false;
	let totalTokens = 0;
	let validRate = 0;
	try {
		const score = readJson(`${runDir}/research-score.json`) as { eligible?: boolean; overall?: number | null; scienceScore?: number | null };
		eligible = score.eligible === true;
		overallScore = score.overall ?? null;
		scienceScore = score.scienceScore ?? null;
	} catch {
		// missing score artifact: stays null/0 — the aggregate counts it as zero with eligible=false
	}
	try {
		const attestation = readJson(`${runDir}/runtime-attestation.json`) as { totalTokens?: number };
		totalTokens = attestation.totalTokens ?? 0;
	} catch {
		// missing attestation: totalTokens stays 0
	}
	try {
		const plan = readJson(`${runDir}/plan.json`) as { nodes?: { state?: string }[] };
		const nodes = plan.nodes ?? [];
		if (nodes.length > 0) validRate = nodes.filter((node) => node.state === "completed").length / nodes.length;
	} catch {
		// missing plan: validRate stays 0
	}
	return { taskId, stage, repetition, runDir, scienceScore, overallScore, validRate, eligible, totalTokens };
}
