/** Serial, checkpointed WorkGraph scheduler with deterministic ports. */
import type { ResearchWorkGraph, WorkNode } from "./contracts.js";
import { classifyResearchFailure, type ResearchFailure } from "./failure-taxonomy.js";
import { readyWorkNodes, transitionWorkNode, workGraphComplete } from "./work-graph.js";

export interface NodeExecutionResult {
	artifactIds: string[];
	metadata?: Record<string, unknown>;
}

export interface NodeVerificationResult {
	passed: boolean;
	evidenceIds: string[];
	issues: string[];
}

export interface ResearchSchedulerPorts {
	execute(node: WorkNode, graph: ResearchWorkGraph): Promise<NodeExecutionResult>;
	verify(node: WorkNode, result: NodeExecutionResult, graph: ResearchWorkGraph): Promise<NodeVerificationResult>;
	checkpoint(graph: ResearchWorkGraph): void | Promise<void>;
	now(): Date;
	onEvent?(event: { type: string; nodeId?: string; detail?: unknown }): void;
	stopRequested?(): boolean;
}

export interface ResearchSchedulerResult {
	graph: ResearchWorkGraph;
	completed: boolean;
	stopped: boolean;
	executedNodes: string[];
	failures: { nodeId: string; failure: ResearchFailure }[];
}

export class ResearchScheduler {
	constructor(private readonly ports: ResearchSchedulerPorts) {}

	private async save(graph: ResearchWorkGraph): Promise<void> {
		await this.ports.checkpoint(graph);
	}

	private emit(type: string, nodeId?: string, detail?: unknown): void {
		this.ports.onEvent?.({ type, nodeId, detail });
	}

	async runNode(graph: ResearchWorkGraph, nodeId: string): Promise<{ graph: ResearchWorkGraph; failure?: ResearchFailure }> {
		const ready = readyWorkNodes(graph).find((node) => node.id === nodeId);
		if (!ready) throw new Error(`research node is not ready: ${nodeId}`);
		let next = transitionWorkNode(graph, nodeId, "running", {}, this.ports.now());
		await this.save(next);
		this.emit("node-start", nodeId, { attempt: next.nodes.find((node) => node.id === nodeId)?.attempts });
		let execution: NodeExecutionResult;
		try {
			execution = await this.ports.execute(next.nodes.find((node) => node.id === nodeId)!, next);
		} catch (error) {
			const failure = classifyResearchFailure(error, "node-execution");
			next = transitionWorkNode(next, nodeId, "failed", { failureCode: failure.class, failureMessage: failure.message }, this.ports.now());
			this.emit("node-failed", nodeId, failure);
			const failedNode = next.nodes.find((node) => node.id === nodeId)!;
			if (failure.retryable && failedNode.attempts < failedNode.budget.maxAttempts) {
				next = transitionWorkNode(next, nodeId, "ready", {}, this.ports.now());
				this.emit("node-retry-ready", nodeId, { attempts: failedNode.attempts });
			}
			await this.save(next);
			return { graph: next, failure };
		}
		next = transitionWorkNode(next, nodeId, "verifying", { outputArtifactIds: execution.artifactIds }, this.ports.now());
		await this.save(next);
		this.emit("node-verifying", nodeId, { artifactIds: execution.artifactIds });
		let verification: NodeVerificationResult;
		try {
			verification = await this.ports.verify(next.nodes.find((node) => node.id === nodeId)!, execution, next);
		} catch (error) {
			verification = { passed: false, evidenceIds: [], issues: [error instanceof Error ? error.message : String(error)] };
		}
		if (verification.passed && next.nodes.find((node) => node.id === nodeId)!.acceptanceCriteriaIds.length > 0 && verification.evidenceIds.length === 0) {
			verification = { passed: false, evidenceIds: [], issues: ["verifier passed without acceptance evidence"] };
		}
		if (verification.passed) {
			next = transitionWorkNode(next, nodeId, "completed", { acceptanceEvidenceIds: verification.evidenceIds }, this.ports.now());
			this.emit("node-completed", nodeId, { evidenceIds: verification.evidenceIds });
			await this.save(next);
			return { graph: next };
		}
		const failure = classifyResearchFailure(`verification failed: ${verification.issues.join("; ")}`, "node-verification");
		next = transitionWorkNode(next, nodeId, "failed", { failureCode: failure.class, failureMessage: failure.message }, this.ports.now());
		const failedNode = next.nodes.find((node) => node.id === nodeId)!;
		if (failedNode.attempts < failedNode.budget.maxAttempts) next = transitionWorkNode(next, nodeId, "ready", {}, this.ports.now());
		this.emit("node-verification-failed", nodeId, { issues: verification.issues, retry: next.nodes.find((node) => node.id === nodeId)?.state === "ready" });
		await this.save(next);
		return { graph: next, failure };
	}

	async run(graph: ResearchWorkGraph, maxNodeExecutions = 128): Promise<ResearchSchedulerResult> {
		let current = graph;
		const executedNodes: string[] = [];
		const failures: { nodeId: string; failure: ResearchFailure }[] = [];
		for (let step = 0; step < maxNodeExecutions; step++) {
			if (this.ports.stopRequested?.()) return { graph: current, completed: workGraphComplete(current), stopped: true, executedNodes, failures };
			if (workGraphComplete(current)) return { graph: current, completed: true, stopped: false, executedNodes, failures };
			const nextNode = readyWorkNodes(current)[0];
			if (!nextNode) return { graph: current, completed: false, stopped: false, executedNodes, failures };
			const outcome = await this.runNode(current, nextNode.id);
			current = outcome.graph;
			executedNodes.push(nextNode.id);
			if (outcome.failure) failures.push({ nodeId: nextNode.id, failure: outcome.failure });
		}
		throw new Error(`research scheduler exceeded ${maxNodeExecutions} node executions`);
	}
}
