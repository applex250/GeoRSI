/** Serial, checkpointed WorkGraph scheduler with deterministic ports. */
import type { ResearchWorkGraph, WorkNode } from "./contracts.js";
import { classifyResearchFailure, type ResearchFailure } from "./failure-taxonomy.js";
import { readyWorkNodes, transitionWorkNode, workGraphComplete } from "./work-graph.js";

export interface NodeExecutionResult {
	artifactIds: string[];
	metadata?: Record<string, unknown>;
	usage: { modelCalls: number; toolCalls: number; outputTokens: number };
}

export interface NodeVerificationResult {
	passed: boolean;
	evidenceIds: string[];
	issues: string[];
	usage: { modelCalls: number; toolCalls: number; outputTokens: number };
}

export interface ResearchSchedulerPorts {
	execute(node: WorkNode, graph: ResearchWorkGraph, signal: AbortSignal): Promise<NodeExecutionResult>;
	verify(node: WorkNode, result: NodeExecutionResult, graph: ResearchWorkGraph, signal: AbortSignal): Promise<NodeVerificationResult>;
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

function assertUsage(label: string, usage: NodeExecutionResult["usage"]): void {
	for (const [name, value] of Object.entries(usage)) {
		if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} ${name} usage must be a non-negative safe integer`);
	}
}

export class ResearchScheduler {
	constructor(private readonly ports: ResearchSchedulerPorts) {}

	private async withinDeadline<T>(wallMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let timedOut = false;
		const operationPromise = Promise.resolve().then(() => operation(controller.signal));
		try {
			return await Promise.race([
				operationPromise,
				new Promise<T>((_resolve, reject) => {
					timer = setTimeout(() => {
						timedOut = true;
						controller.abort();
						reject(new Error(`research node timed out after ${wallMs}ms`));
					}, wallMs);
				}),
			]);
		} catch (error) {
			if (timedOut) {
				// Do not return a retryable failure while the previous operation is
				// still unwinding. Ports must honor AbortSignal and resolve only after
				// their model/process cleanup is complete; awaiting here prevents an
				// overlapping retry from emitting late artifacts or receipts.
				try { await operationPromise; } catch { /* preserve timeout */ }
			}
			throw error;
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

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
		const deadline = Date.now() + ready.budget.wallMs;
		const remainingWallMs = (): number => Math.max(0, deadline - Date.now());
		await this.save(next);
		this.emit("node-start", nodeId, { attempt: next.nodes.find((node) => node.id === nodeId)?.attempts });
		let execution: NodeExecutionResult;
		try {
			execution = await this.withinDeadline(remainingWallMs(), (signal) => this.ports.execute(next.nodes.find((node) => node.id === nodeId)!, next, signal));
			const usage = execution.usage;
			assertUsage("node execution", usage);
			if (usage.modelCalls > ready.budget.maxModelCalls) throw new Error(`node model-call budget exceeded: ${usage.modelCalls}/${ready.budget.maxModelCalls}`);
			if (usage.toolCalls > ready.budget.maxToolCalls) throw new Error(`node tool-call budget exceeded: ${usage.toolCalls}/${ready.budget.maxToolCalls}`);
			if (usage.outputTokens > ready.budget.maxOutputTokens) throw new Error(`node output-token budget exceeded: ${usage.outputTokens}/${ready.budget.maxOutputTokens}`);
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
			verification = await this.withinDeadline(remainingWallMs(), (signal) => this.ports.verify(next.nodes.find((node) => node.id === nodeId)!, execution, next, signal));
			assertUsage("node verification", verification.usage);
		} catch (error) {
			verification = { passed: false, evidenceIds: [], issues: [error instanceof Error ? error.message : String(error)], usage: { modelCalls: 0, toolCalls: 0, outputTokens: 0 } };
		}
		const combinedUsage = {
			modelCalls: execution.usage.modelCalls + verification.usage.modelCalls,
			toolCalls: execution.usage.toolCalls + verification.usage.toolCalls,
			outputTokens: execution.usage.outputTokens + verification.usage.outputTokens,
		};
		if (combinedUsage.modelCalls > ready.budget.maxModelCalls || combinedUsage.toolCalls > ready.budget.maxToolCalls || combinedUsage.outputTokens > ready.budget.maxOutputTokens) {
			verification = { passed: false, evidenceIds: verification.evidenceIds, issues: [...verification.issues, `combined node budget exceeded: model=${combinedUsage.modelCalls}/${ready.budget.maxModelCalls} tool=${combinedUsage.toolCalls}/${ready.budget.maxToolCalls} output=${combinedUsage.outputTokens}/${ready.budget.maxOutputTokens}`], usage: verification.usage };
		}
		if (verification.passed && next.nodes.find((node) => node.id === nodeId)!.acceptanceCriteriaIds.length > 0 && verification.evidenceIds.length === 0) {
			verification = { passed: false, evidenceIds: [], issues: ["verifier passed without acceptance evidence"], usage: verification.usage };
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
