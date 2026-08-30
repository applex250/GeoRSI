/** Pure, deterministic state machine for long-horizon research work. */
import { createHash } from "node:crypto";
import type { ResearchWorkGraph, WorkNode, WorkNodeState } from "./contracts.js";

const ALLOWED_TRANSITIONS: Record<WorkNodeState, readonly WorkNodeState[]> = {
	pending: ["ready", "cancelled"],
	ready: ["running", "cancelled"],
	running: ["verifying", "failed", "blocked", "cancelled"],
	verifying: ["completed", "failed", "blocked", "cancelled"],
	completed: [],
	failed: ["ready", "cancelled"],
	blocked: ["ready", "cancelled"],
	cancelled: [],
};

function cloneGraph(graph: ResearchWorkGraph): ResearchWorkGraph {
	return { ...graph, nodes: graph.nodes.map((node) => ({ ...node, dependsOn: [...node.dependsOn], inputEvidenceIds: [...node.inputEvidenceIds], expectedOutputs: [...node.expectedOutputs], acceptanceCriteriaIds: [...node.acceptanceCriteriaIds], allowedCapabilities: [...node.allowedCapabilities], budget: { ...node.budget }, outputArtifactIds: [...node.outputArtifactIds], acceptanceEvidenceIds: [...node.acceptanceEvidenceIds] })) };
}

export interface CreateWorkNodeInput extends Omit<WorkNode, "state" | "attempts" | "outputArtifactIds" | "acceptanceEvidenceIds"> {
	state?: WorkNodeState;
}

export function createWorkNode(input: CreateWorkNodeInput): WorkNode {
	return {
		...input,
		state: input.state ?? "pending",
		dependsOn: [...input.dependsOn],
		inputEvidenceIds: [...input.inputEvidenceIds],
		expectedOutputs: [...input.expectedOutputs],
		acceptanceCriteriaIds: [...input.acceptanceCriteriaIds],
		allowedCapabilities: [...input.allowedCapabilities],
		budget: { ...input.budget },
		attempts: 0,
		outputArtifactIds: [],
		acceptanceEvidenceIds: [],
	};
}

export function validateWorkGraph(graph: ResearchWorkGraph): string[] {
	const issues: string[] = [];
	if (graph.version !== 1) issues.push("work graph version must be 1");
	if (!graph.missionId.trim()) issues.push("work graph missionId is required");
	if (graph.nodes.length === 0) issues.push("work graph needs at least one node");
	if (graph.nodes.length > 64) issues.push("work graph exceeds the 64-node safety limit");
	const byId = new Map<string, WorkNode>();
	for (const node of graph.nodes) {
		if (!node.id.trim() || byId.has(node.id)) issues.push(`invalid or duplicate node id: ${node.id}`);
		byId.set(node.id, node);
		if (!node.title.trim()) issues.push(`node ${node.id} needs a title`);
		if (node.dependsOn.includes(node.id)) issues.push(`node ${node.id} depends on itself`);
		if (node.budget.wallMs <= 0 || node.budget.maxModelCalls < 0 || node.budget.maxToolCalls < 0 || node.budget.maxOutputTokens <= 0 || node.budget.maxAttempts <= 0) {
			issues.push(`node ${node.id} has an invalid budget`);
		}
	}
	for (const node of graph.nodes) {
		for (const dependency of node.dependsOn) if (!byId.has(dependency)) issues.push(`node ${node.id} has unknown dependency ${dependency}`);
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (id: string): void => {
		if (visited.has(id)) return;
		if (visiting.has(id)) {
			issues.push(`work graph contains a cycle at ${id}`);
			return;
		}
		visiting.add(id);
		for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency);
		visiting.delete(id);
		visited.add(id);
	};
	for (const node of graph.nodes) visit(node.id);
	return [...new Set(issues)];
}

export function createWorkGraph(missionId: string, nodes: WorkNode[], now = new Date()): ResearchWorkGraph {
	const graph: ResearchWorkGraph = {
		version: 1,
		missionId,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
		nodes: nodes.map((node) => ({ ...node, dependsOn: [...node.dependsOn] })),
	};
	const issues = validateWorkGraph(graph);
	if (issues.length > 0) throw new Error(`invalid research work graph: ${issues.join("; ")}`);
	return refreshReadyNodes(graph, now);
}

export function workGraphFingerprint(graph: ResearchWorkGraph): string {
	const stable = graph.nodes
		.map((node) => ({ id: node.id, kind: node.kind, dependsOn: [...node.dependsOn].sort(), expectedOutputs: node.expectedOutputs, acceptanceCriteriaIds: node.acceptanceCriteriaIds, allowedCapabilities: node.allowedCapabilities, budget: node.budget }))
		.sort((left, right) => left.id.localeCompare(right.id));
	return createHash("sha256").update(JSON.stringify([graph.missionId, stable])).digest("hex").slice(0, 16);
}

export function refreshReadyNodes(graph: ResearchWorkGraph, now = new Date()): ResearchWorkGraph {
	const next = cloneGraph(graph);
	const states = new Map(next.nodes.map((node) => [node.id, node.state]));
	let changed = false;
	for (const node of next.nodes) {
		if (node.state !== "pending") continue;
		if (node.dependsOn.every((dependency) => states.get(dependency) === "completed")) {
			node.state = "ready";
			states.set(node.id, "ready");
			changed = true;
		}
	}
	if (changed) next.updatedAt = now.toISOString();
	return next;
}

export interface WorkNodeTransitionPatch {
	outputArtifactIds?: readonly string[];
	acceptanceEvidenceIds?: readonly string[];
	failureCode?: string;
	failureMessage?: string;
}

export function transitionWorkNode(
	graph: ResearchWorkGraph,
	nodeId: string,
	to: WorkNodeState,
	patch: WorkNodeTransitionPatch = {},
	now = new Date(),
): ResearchWorkGraph {
	const next = cloneGraph(graph);
	const node = next.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) throw new Error(`unknown research work node: ${nodeId}`);
	if (!ALLOWED_TRANSITIONS[node.state].includes(to)) throw new Error(`invalid research work transition: ${node.id} ${node.state} -> ${to}`);
	if (to === "running") {
		if (!node.dependsOn.every((dependency) => next.nodes.find((candidate) => candidate.id === dependency)?.state === "completed")) {
			throw new Error(`node ${node.id} cannot run before all dependencies complete`);
		}
		if (node.attempts >= node.budget.maxAttempts) throw new Error(`node ${node.id} exhausted its attempt budget`);
		node.attempts += 1;
		node.startedAt = now.toISOString();
	}
	if (to === "ready" && (node.state === "failed" || node.state === "blocked") && node.attempts >= node.budget.maxAttempts) {
		throw new Error(`node ${node.id} cannot retry after ${node.attempts} attempts`);
	}
	if (patch.outputArtifactIds) node.outputArtifactIds = [...new Set(patch.outputArtifactIds)];
	if (patch.acceptanceEvidenceIds) node.acceptanceEvidenceIds = [...new Set(patch.acceptanceEvidenceIds)];
	if (to === "verifying" && node.expectedOutputs.length > 0 && node.outputArtifactIds.length === 0) {
		throw new Error(`node ${node.id} cannot verify without output artifacts`);
	}
	if (to === "completed") {
		if (node.acceptanceCriteriaIds.length > 0 && node.acceptanceEvidenceIds.length === 0) {
			throw new Error(`node ${node.id} cannot complete without acceptance evidence`);
		}
		if (node.expectedOutputs.length > 0 && node.outputArtifactIds.length === 0) {
			throw new Error(`node ${node.id} cannot complete without expected output artifacts`);
		}
		node.completedAt = now.toISOString();
		node.failureCode = undefined;
		node.failureMessage = undefined;
	}
	if (to === "failed" || to === "blocked") {
		node.failureCode = patch.failureCode ?? (to === "failed" ? "unknown-failure" : "blocked");
		node.failureMessage = patch.failureMessage?.slice(0, 500) ?? "";
	}
	node.state = to;
	next.updatedAt = now.toISOString();
	return to === "completed" ? refreshReadyNodes(next, now) : next;
}

export function readyWorkNodes(graph: ResearchWorkGraph): WorkNode[] {
	return graph.nodes.filter((node) => node.state === "ready").sort((left, right) => left.id.localeCompare(right.id));
}

export function workGraphComplete(graph: ResearchWorkGraph): boolean {
	return graph.nodes.length > 0 && graph.nodes.every((node) => node.state === "completed" || node.state === "cancelled");
}
