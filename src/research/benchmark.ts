/** Frozen, model-independent protocol for fair research benchmark comparisons. */
import { createHash } from "node:crypto";
import { stableJson } from "./event-ledger.js";
import type { ResearchTaskFamily } from "./contracts.js";
import { validateResearchModelConfig, type ResearchModelConfig } from "../config.js";

export type ResearchBenchmarkStage = "stage-a" | "stage-b" | "held-out";

export interface ResearchBenchmarkTask {
	id: string;
	family: ResearchTaskFamily;
	weight: number;
	/** A task is public for strategy development; held-out tasks are never tuned against. */
	public: boolean;
	heldOut: boolean;
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
		provider: "geiliapi",
		base_url: "https://sub.geiliapi.com/v1",
		model: "gpt-5.6-luna",
		api: "openai-completions",
		thinking_level: "xhigh",
		max_tokens_field: "max_completion_tokens",
		credential_env: "GEILIAPI_API_KEY",
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
			{ id: "quake_b", family: "quantitative", weight: 1, public: true, heldOut: false },
			{ id: "flood_rp", family: "quantitative", weight: 1, public: true, heldOut: false },
			{ id: "climate_trend", family: "quantitative", weight: 1, public: true, heldOut: false },
			{ id: "gabench_54", family: "gis-remote-sensing", weight: 1, public: true, heldOut: false },
			{ id: "quake_b_real", family: "capstone", weight: 1, public: true, heldOut: false },
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
