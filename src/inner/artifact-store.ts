/** Filesystem adapter for authorized episode workspaces and durable evidence. */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson } from "../journal.js";
import { SCIENCE_TOOLKIT_SOURCE } from "../science-toolkit.js";
import type { EpisodeResult } from "./episode-contract.js";
import type { CandidateAnswer } from "./submission-policy.js";

export interface PrepareEpisodeArtifactsOptions {
	workspace: string;
	requestedWorkspace: string;
	problemDir: string;
}

/** Destructive preparation is safe only after the caller has authorized both
 * paths against repository/private/exchange boundaries. */
export function prepareEpisodeArtifacts(options: PrepareEpisodeArtifactsOptions): void {
	rmSync(options.workspace, { recursive: true, force: true });
	mkdirSync(options.workspace, { recursive: true });
	if (options.requestedWorkspace !== options.workspace) {
		rmSync(options.requestedWorkspace, { recursive: true, force: true });
		mkdirSync(options.requestedWorkspace, { recursive: true });
	}
	const sourceData = join(options.problemDir, "data");
	if (existsSync(sourceData)) cpSync(sourceData, join(options.workspace, "data"), { recursive: true });
	mkdirSync(join(options.workspace, "solutions"), { recursive: true });
	writeFileSync(join(options.workspace, "georsi_science.py"), SCIENCE_TOOLKIT_SOURCE, "utf8");
}

export interface PersistEpisodeArtifactsOptions {
	workspace: string;
	requestedWorkspace: string;
	problemId: string;
	result: EpisodeResult;
	selectedAnswer: CandidateAnswer | null;
}

/** Persist the canonical, sanitized result. Arbitrary agent scripts/logs stay
 * in external scratch; only the selected answer crosses into durable storage. */
export function persistEpisodeArtifacts(options: PersistEpisodeArtifactsOptions): void {
	atomicWriteJson(join(options.workspace, "episode.json"), options.result);
	if (options.requestedWorkspace === options.workspace) return;
	mkdirSync(options.requestedWorkspace, { recursive: true });
	atomicWriteJson(join(options.requestedWorkspace, "episode.json"), options.result);
	if (!options.selectedAnswer) return;
	const durableSolutions = join(options.requestedWorkspace, "solutions");
	mkdirSync(durableSolutions, { recursive: true });
	atomicWriteJson(join(durableSolutions, `${options.problemId}.json`), options.selectedAnswer);
}
