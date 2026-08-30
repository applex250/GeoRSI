/** Reproducibility metadata that can be captured without exposing credentials. */
import { createHash } from "node:crypto";
import type { ResearchNetworkMode } from "./contracts.js";
import { stableJson } from "./event-ledger.js";

export interface ResearchEnvironmentInput {
	gitCommit: string | null;
	gitDirty: boolean | null;
	configFingerprint: string;
	strategyFingerprint: string;
	modelProfileVersion: string;
	modelProfileFingerprint: string;
	pythonPath: string;
	pythonHash?: string;
	pythonPackages?: string[];
	gisPackages?: Record<string, string>;
	knowledgeVersion?: string;
	ragCorpusVersion?: string;
	networkMode: ResearchNetworkMode;
	evaluatorMetrics: Record<string, string>;
	randomSeeds: number[];
}

export interface ResearchEnvironment extends ResearchEnvironmentInput {
	version: 1;
	node: string;
	platform: string;
	arch: string;
	capturedAt: string;
	fingerprint: string;
}

export function captureResearchEnvironment(input: ResearchEnvironmentInput, now = new Date()): ResearchEnvironment {
	const stableInput: ResearchEnvironmentInput = {
		...input,
		pythonPackages: [...(input.pythonPackages ?? [])].sort(),
		gisPackages: input.gisPackages ? Object.fromEntries(Object.entries(input.gisPackages).sort(([left], [right]) => left.localeCompare(right))) : undefined,
		randomSeeds: [...input.randomSeeds],
	};
	const fingerprint = createHash("sha256").update(stableJson(stableInput)).digest("hex").slice(0, 24);
	return {
		...stableInput,
		version: 1,
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		capturedAt: now.toISOString(),
		fingerprint,
	};
}
