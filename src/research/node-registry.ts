/** B-track exploratory node-kind registry (Phase-4).
 *
 * The Research Lead may propose node kinds beyond the built-in vocabulary. They run as
 * EXPLORATORY stages: outputs enter the evidence store and are recall-able, but they can
 * never satisfy mission requiredStages or family verifier gates until promoted. Promotion
 * requires a dedicated deterministic verifier profile and records full lineage. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { WorkNodeKind } from "./contracts.js";
import { WORK_NODE_KINDS } from "./graph-spec.js";

export type NodeKindStatus = "exploratory" | "promoted";

export interface NodeKindRecord {
	kind: string;
	status: NodeKindStatus;
	purpose: string;
	originRun?: string;
	discoveredAt: string;
	/** Set at promotion: the deterministic verifier profile gating this kind's output. */
	verifierProfile?: string;
}

export interface NodeKindRegistryFile {
	version: 1;
	kinds: NodeKindRecord[];
}

export function isBuiltInKind(kind: string): boolean {
	return (WORK_NODE_KINDS as readonly string[]).includes(kind);
}

export function loadNodeKindRegistry(path: string): NodeKindRegistryFile {
	if (!existsSync(path)) return { version: 1, kinds: [] };
	const parsed = JSON.parse(readFileSync(path, "utf8")) as NodeKindRegistryFile;
	if (parsed.version !== 1 || !Array.isArray(parsed.kinds)) throw new Error(`invalid node kind registry: ${path}`);
	return parsed;
}

export function saveNodeKindRegistry(path: string, registry: NodeKindRegistryFile): void {
	writeFileSync(path, JSON.stringify(registry, null, 2) + "\n", { encoding: "utf8" });
}

/** A stage kind is usable when built-in or registered (exploratory or promoted). */
export function isKnownStageKind(path: string, kind: string): boolean {
	return isBuiltInKind(kind) || loadNodeKindRegistry(path).kinds.some((record) => record.kind === kind);
}

/** Registered kinds (exploratory + promoted) beyond the built-in vocabulary. */
export function registeredStageKinds(path: string): string[] {
	return loadNodeKindRegistry(path).kinds.map((record) => record.kind);
}

export function registerExploratoryKind(path: string, input: { kind: string; purpose: string; originRun?: string; now?: Date }): NodeKindRegistryFile {
	if (isBuiltInKind(input.kind)) throw new Error(`cannot register a built-in kind as exploratory: ${input.kind}`);
	const registry = loadNodeKindRegistry(path);
	if (registry.kinds.some((record) => record.kind === input.kind)) throw new Error(`kind already registered: ${input.kind}`);
	registry.kinds.push({ kind: input.kind, status: "exploratory", purpose: input.purpose, originRun: input.originRun, discoveredAt: (input.now ?? new Date()).toISOString() });
	saveNodeKindRegistry(path, registry);
	return registry;
}

/** Promotion: an exploratory kind becomes a first-class kind gated by a verifier profile. */
export function promoteNodeKind(path: string, kind: string, verifierProfile: string, now = new Date()): NodeKindRegistryFile {
	const registry = loadNodeKindRegistry(path);
	const record = registry.kinds.find((candidate) => candidate.kind === kind);
	if (!record) throw new Error(`cannot promote unknown exploratory kind: ${kind}`);
	if (record.status !== "exploratory") throw new Error(`kind is not exploratory: ${kind}`);
	record.status = "promoted";
	record.verifierProfile = verifierProfile;
	record.discoveredAt = record.discoveredAt ?? now.toISOString();
	saveNodeKindRegistry(path, registry);
	return registry;
}
