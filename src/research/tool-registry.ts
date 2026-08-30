/** Typed scientific tool registry with uniform, auditable receipts. */
import { createHash, randomUUID } from "node:crypto";
import type { EvidenceRef } from "./contracts.js";
import { sanitizeResearchEvidence, stableJson } from "./event-ledger.js";

export interface ScientificToolContext {
	missionId: string;
	episodeId: string;
	nodeId: string;
	allowedCapabilities: readonly string[];
	remainingWallMs: number;
}

export interface ScientificToolResult<Output> {
	output: Output;
	artifactIds?: string[];
	/** Canonical metadata for newly created CAS evidence; ids must match artifactIds. */
	evidenceRefs?: EvidenceRef[];
	stdoutArtifactId?: string;
	stderrArtifactId?: string;
	exitCode?: number | null;
}

export interface ScientificTool<Input = unknown, Output = unknown> {
	id: string;
	version: string;
	capability: string;
	validate(input: unknown): string[];
	execute(context: ScientificToolContext, input: Input): Promise<ScientificToolResult<Output>>;
}

export interface ScientificToolReceipt {
	version: 1;
	id: string;
	missionId: string;
	episodeId: string;
	nodeId: string;
	toolId: string;
	toolVersion: string;
	capability: string;
	startedAt: string;
	completedAt: string;
	wallMs: number;
	status: "success" | "failure";
	inputHash: string;
	outputHash?: string;
	input: unknown;
	output?: unknown;
	artifactIds: string[];
	stdoutArtifactId?: string;
	stderrArtifactId?: string;
	exitCode?: number | null;
	error?: string;
}

function digest(value: unknown): string {
	return createHash("sha256").update(stableJson(value)).digest("hex");
}

export class ScientificToolRegistry {
	private readonly tools = new Map<string, ScientificTool<any, any>>();

	constructor(
		private readonly now: () => Date = () => new Date(),
		private readonly makeId: () => string = randomUUID,
		private readonly onReceipt: (receipt: ScientificToolReceipt) => void = () => {},
	) {}

	register<Input, Output>(tool: ScientificTool<Input, Output>): void {
		if (!tool.id.trim() || !tool.version.trim() || !tool.capability.trim()) throw new Error("scientific tool id, version and capability are required");
		if (this.tools.has(tool.id)) throw new Error(`scientific tool already registered: ${tool.id}`);
		this.tools.set(tool.id, tool);
	}

	list(): { id: string; version: string; capability: string }[] {
		return [...this.tools.values()].map((tool) => ({ id: tool.id, version: tool.version, capability: tool.capability })).sort((left, right) => left.id.localeCompare(right.id));
	}

	async execute<Input, Output>(toolId: string, context: ScientificToolContext, input: Input): Promise<{ result: ScientificToolResult<Output>; receipt: ScientificToolReceipt }> {
		const tool = this.tools.get(toolId) as ScientificTool<Input, Output> | undefined;
		if (!tool) throw new Error(`unknown scientific tool: ${toolId}`);
		if (!context.allowedCapabilities.includes(tool.capability)) throw new Error(`node ${context.nodeId} is not allowed capability ${tool.capability}`);
		if (context.remainingWallMs <= 0) throw new Error(`node ${context.nodeId} has no remaining wall-clock budget`);
		const issues = tool.validate(input);
		if (issues.length > 0) throw new Error(`invalid ${tool.id} input: ${issues.join("; ")}`);
		const started = this.now();
		const safeInput = sanitizeResearchEvidence(input);
		const base = {
			version: 1 as const,
			id: this.makeId(),
			missionId: context.missionId,
			episodeId: context.episodeId,
			nodeId: context.nodeId,
			toolId: tool.id,
			toolVersion: tool.version,
			capability: tool.capability,
			startedAt: started.toISOString(),
			inputHash: digest(safeInput),
			input: safeInput,
		};
		try {
			const result = await tool.execute(context, input);
			const completed = this.now();
			const safeOutput = sanitizeResearchEvidence(result.output);
			const receipt: ScientificToolReceipt = {
				...base,
				completedAt: completed.toISOString(),
				wallMs: Math.max(0, completed.getTime() - started.getTime()),
				status: "success",
				outputHash: digest(safeOutput),
				output: safeOutput,
				artifactIds: [...new Set(result.artifactIds ?? [])],
				stdoutArtifactId: result.stdoutArtifactId,
				stderrArtifactId: result.stderrArtifactId,
				exitCode: result.exitCode,
			};
			this.onReceipt(receipt);
			return { result, receipt };
		} catch (error) {
			const completed = this.now();
			const receipt: ScientificToolReceipt = {
				...base,
				completedAt: completed.toISOString(),
				wallMs: Math.max(0, completed.getTime() - started.getTime()),
				status: "failure",
				artifactIds: [],
				error: String(sanitizeResearchEvidence(error instanceof Error ? `${error.name}: ${error.message}` : String(error))).slice(0, 500),
			};
			this.onReceipt(receipt);
			throw Object.assign(new Error(receipt.error), { receipt });
		}
	}
}
