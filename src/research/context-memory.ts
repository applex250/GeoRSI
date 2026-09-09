/** Run-scoped, read-only context memory shared by research node workers.
 *
 * Memory entries are derived exclusively from audited node submissions that
 * already live in the CAS evidence store; the tool never accepts model-authored
 * writes, so the memory cannot be poisoned mid-run. Every recall is receipted
 * by the scientific tool registry.
 *
 * Layers:
 *   L0 fetch    — exact evidence id -> verified full content slice
 *   L1 filter   — node (+self) / field structured recall of latest submissions
 *   L2 search   — deterministic lexical scoring (ascii words + CJK bigrams)
 *   L1.5 list   — catalog of what memory currently holds (discoverability)
 */
import { sanitizeResearchEvidence } from "./event-ledger.js";
import type { ContentAddressedEvidenceStore } from "./evidence-store.js";
import type { EvidenceRef } from "./contracts.js";
import type { ScientificTool } from "./tool-registry.js";

export type ContextRecallField = "summary" | "decisions" | "artifacts" | "verifications" | "all";

export interface ContextSubmissionLike {
	summary: string;
	artifactIds: string[];
	decisions: { question: string; alternatives?: string[]; selected: string; uncertainty?: string }[];
	verifications: { profile: string; inputArtifactId?: string; evidenceIds?: string[] }[];
}

export interface ContextMemoryBlock {
	nodeId: string;
	version: number;
	field: Exclude<ContextRecallField, "all">;
	evidenceId: string;
	sha256: string;
	text: string;
}

interface NodeVersion {
	version: number;
	submissionRef: { id: string; sha256: string };
	blocks: ContextMemoryBlock[];
	artifacts: { evidenceId: string; logicalName: string; kind: string; bytes: number }[];
	verificationProfiles: string[];
}

export interface NodeCatalogEntry {
	nodeId: string;
	version: number;
	submissionEvidenceId: string;
	summaryExcerpt: string;
	decisionCount: number;
	verificationProfiles: string[];
	artifacts: { evidenceId: string; logicalName: string; kind: string; bytes: number }[];
}
export interface ContextRecallEntry {
	nodeId: string;
	version: number;
	field: string;
	evidenceId: string;
	score?: number;
	excerpt: string;
}

export interface ContextRecallOutput {
	mode: "list" | "fetch" | "filter" | "search";
	/** Full work-graph progress snapshot when a graph state has been synced. */
	progress?: Record<string, string>;
	nodes?: NodeCatalogEntry[];
	entries?: ContextRecallEntry[];
	truncated?: boolean;
	hint?: string;
}

export interface ContextRecallRequest {
	list?: true | "nodes" | "artifacts";
	node?: string;
	field?: ContextRecallField;
	query?: string;
	evidenceId?: string;
	topK?: number;
	maxChars?: number;
}

/* ------------------------------ lexical scoring ------------------------------ */

export function tokenize(text: string): string[] {
	const tokens: string[] = [];
	for (const word of text.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) ?? []) {
		if (word.length > 1) tokens.push(word);
	}
	for (const run of text.match(/[\u4e00-\u9fff]+/g) ?? []) {
		if (run.length === 1) tokens.push(run);
		else for (let index = 0; index + 1 < run.length; index += 1) tokens.push(run.slice(index, index + 2));
	}
	return tokens;
}

function termFrequency(tokens: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
	return counts;
}

/** Deterministic BM25-lite: same blocks + same query -> same ranking, always. */
export function scoreBlocks(queryTokens: readonly string[], blocks: readonly ContextMemoryBlock[]): { block: ContextMemoryBlock; score: number }[] {
	if (queryTokens.length === 0) return [];
	const documentFrequency = new Map<string, number>();
	const blockFrequencies = blocks.map((block) => {
		const frequencies = termFrequency(tokenize(block.text));
		for (const term of frequencies.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
		return frequencies;
	});
	const queryFrequency = termFrequency(queryTokens);
	const total = blocks.length;
	const scored = blocks.map((block, index) => {
		const frequencies = blockFrequencies[index]!;
		const blockLength = tokenize(block.text).length || 1;
		let score = 0;
		for (const [term, queryCount] of queryFrequency) {
			const tf = frequencies.get(term) ?? 0;
			if (tf === 0) continue;
			const idf = Math.log(1 + total / (1 + (documentFrequency.get(term) ?? 0)));
			score += queryCount * idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (blockLength / 64))));
		}
		return { block, score };
	});
	scored.sort((left, right) => right.score - left.score || left.block.nodeId.localeCompare(right.block.nodeId) || left.block.field.localeCompare(right.block.field) || left.block.evidenceId.localeCompare(right.block.evidenceId));
	return scored.filter((item) => item.score > 0);
}

/* ------------------------------ memory index ------------------------------ */

function sliceText(text: string, maxChars: number): string {
	return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

export class ResearchContextMemory {
	private readonly nodes = new Map<string, NodeVersion[]>();
	private graphState: { id: string; state: string; attempts: number }[] = [];

	constructor(private readonly deps: { evidenceStore: ContentAddressedEvidenceStore; evidenceById(id: string): EvidenceRef | undefined }) {}

	/** Host-driven graph state snapshot (read-only data owned by the scheduler). */
	syncGraphState(states: readonly { id: string; state: string; attempts: number }[]): void {
		this.graphState = [...states].sort((left, right) => left.id.localeCompare(right.id));
	}

	progress(): Record<string, string> {
		return Object.fromEntries(this.graphState.map((entry) => [entry.id, entry.attempts > 1 ? `${entry.state}(attempt ${entry.attempts})` : entry.state]));
	}

	/** Register the latest audited submission of a node. Read-only memory: this
	 * is the only write path and it is driven by the executor, never the model. */
	commit(nodeId: string, submissionRef: { id: string; sha256: string }, submission: ContextSubmissionLike): number {
		const versions = this.nodes.get(nodeId) ?? [];
		const version = versions.length + 1;
		const blocks: ContextMemoryBlock[] = [
			{ nodeId, version, field: "summary", evidenceId: submissionRef.id, sha256: submissionRef.sha256, text: sliceText(submission.summary, 2000) },
			...submission.decisions.slice(0, 16).map((decision) => ({
				nodeId,
				version,
				field: "decisions" as const,
				evidenceId: submissionRef.id,
				sha256: submissionRef.sha256,
				text: sliceText(`Q: ${decision.question} | options: ${(decision.alternatives ?? []).join(" / ")} | selected: ${decision.selected}${decision.uncertainty ? ` | uncertainty: ${decision.uncertainty}` : ""}`, 1000),
			})),
			{ nodeId, version, field: "verifications", evidenceId: submissionRef.id, sha256: submissionRef.sha256, text: sliceText(submission.verifications.map((verification) => `${verification.profile} -> ${verification.inputArtifactId ?? verification.evidenceIds?.join(",") ?? "?"}`).join("; "), 1000) },
		];
		const artifacts: NodeVersion["artifacts"] = [];
		for (const artifactId of submission.artifactIds.slice(0, 32)) {
			const reference = this.deps.evidenceById(artifactId);
			if (!reference) continue;
			artifacts.push({ evidenceId: reference.id, logicalName: reference.logicalName, kind: reference.kind, bytes: reference.bytes });
			let preview = "";
			try {
				if (reference.bytes <= 262_144 && this.deps.evidenceStore.verify(reference)) {
					preview = String(sanitizeResearchEvidence(this.deps.evidenceStore.read(reference).toString("utf8")));
				}
			} catch {
				preview = "";
			}
			blocks.push({ nodeId, version, field: "artifacts", evidenceId: reference.id, sha256: reference.sha256, text: sliceText(`${reference.logicalName} (${reference.kind}, ${reference.bytes}B): ${preview}`, 800) });
		}
		versions.push({ version, submissionRef, blocks, artifacts, verificationProfiles: submission.verifications.map((verification) => verification.profile) });
		this.nodes.set(nodeId, versions);
		return version;
	}

	has(nodeId: string): boolean {
		return this.nodes.has(nodeId);
	}

	latest(nodeId: string): NodeVersion | undefined {
		const versions = this.nodes.get(nodeId);
		return versions?.[versions.length - 1];
	}

	catalog(nodeFilter?: string): NodeCatalogEntry[] {
		const entries: NodeCatalogEntry[] = [];
		for (const [nodeId, versions] of [...this.nodes.entries()].sort(([left], [right]) => left.localeCompare(right))) {
			if (nodeFilter && nodeId !== nodeFilter && nodeFilter !== "any") continue;
			const latest = versions[versions.length - 1]!;
			entries.push({
				nodeId,
				version: latest.version,
				submissionEvidenceId: latest.submissionRef.id,
				summaryExcerpt: sliceText(latest.blocks.find((block) => block.field === "summary")?.text ?? "", 240),
				decisionCount: latest.blocks.filter((block) => block.field === "decisions").length,
				verificationProfiles: latest.verificationProfiles,
				artifacts: latest.artifacts,
			});
		}
		return entries;
	}

	blocks(nodeFilter?: string): ContextMemoryBlock[] {
		const output: ContextMemoryBlock[] = [];
		for (const entry of this.catalog(nodeFilter)) {
			const latest = this.latest(entry.nodeId)!;
			output.push(...latest.blocks);
		}
		return output;
	}

	fetch(evidenceId: string): ContextRecallEntry {
		const reference = this.deps.evidenceById(evidenceId.trim());
		if (!reference) throw new Error(`context-recall: unknown evidence id: ${evidenceId}`);
		if (!this.deps.evidenceStore.verify(reference)) throw new Error(`context-recall: evidence failed integrity verification: ${reference.id}`);
		const owningNode = [...this.nodes.entries()].find(([, versions]) => versions.some((version) => version.submissionRef.id === reference.id || version.artifacts.some((artifact) => artifact.evidenceId === reference.id)));
		const content = String(sanitizeResearchEvidence(this.deps.evidenceStore.read(reference).toString("utf8")));
		return {
			nodeId: owningNode?.[0] ?? (reference.producerNodeId || "unknown"),
			version: owningNode ? owningNode[1][owningNode[1].length - 1]!.version : 0,
			field: "content",
			evidenceId: reference.id,
			excerpt: content,
		};
	}
}

/* ------------------------------ the tool ------------------------------ */

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

export function createContextRecallTool(input: { memory: ResearchContextMemory }): ScientificTool<ContextRecallRequest, ContextRecallOutput> {
	return {
		id: "context-recall",
		version: "1",
		capability: "context-memory",
		validate: (value) => {
			const request = value as ContextRecallRequest;
			const issues: string[] = [];
			if (request.list !== undefined && request.list !== true && request.list !== "nodes" && request.list !== "artifacts") issues.push("list must be true, \"nodes\", or \"artifacts\"");
			if (request.node !== undefined && (typeof request.node !== "string" || request.node.trim().length === 0 || request.node.length > 160)) issues.push("node must be 1..160 characters");
			if (request.field !== undefined && !["summary", "decisions", "artifacts", "verifications", "all"].includes(request.field)) issues.push("field is invalid");
			if (request.query !== undefined && (typeof request.query !== "string" || request.query.trim().length === 0 || request.query.length > 500)) issues.push("query must be 1..500 characters");
			if (request.evidenceId !== undefined && (typeof request.evidenceId !== "string" || request.evidenceId.trim().length === 0 || request.evidenceId.length > 200)) issues.push("evidenceId must be 1..200 characters");
			if (request.topK !== undefined && (!Number.isSafeInteger(request.topK) || request.topK < 1 || request.topK > 10)) issues.push("topK must be within 1..10");
			if (request.maxChars !== undefined && (!Number.isSafeInteger(request.maxChars) || request.maxChars < 200 || request.maxChars > 20_000)) issues.push("maxChars must be within 200..20000");
			return issues;
		},
		execute: async (context, request) => {
			const maxChars = request.maxChars ?? 6000;
			// L1.5 — catalog: what memory currently holds (discoverability first)
			if (request.list !== undefined) {
				const nodeFilter = request.node === "self" ? context.nodeId : request.node;
				const nodes = input.memory.catalog(nodeFilter);
				if (request.list === "artifacts") {
					return { output: { mode: "list", progress: input.memory.progress(), nodes: nodes.map((node) => ({ ...node, summaryExcerpt: "", decisionCount: 0, verificationProfiles: [] })) } };
				}
				return { output: { mode: "list", progress: input.memory.progress(), nodes } };
			}
			// L0 — exact fetch
			if (request.evidenceId) {
				const entry = input.memory.fetch(request.evidenceId);
				entry.excerpt = sliceText(entry.excerpt, maxChars);
				return { output: { mode: "fetch", entries: [entry], truncated: entry.excerpt.length >= maxChars } };
			}
			const nodeFilter = request.node === "self" ? context.nodeId : request.node;
			// L2 — lexical search
			if (request.query) {
				const candidates = input.memory.blocks(nodeFilter).filter((block) => request.field === undefined || request.field === "all" || block.field === request.field);
				const ranked = scoreBlocks(tokenize(request.query), candidates).slice(0, request.topK ?? 3);
				if (ranked.length === 0) return { output: { mode: "search", entries: [], hint: "no matching context; call with list:true to inspect available memory" } };
				const perEntry = clamp(Math.floor(maxChars / ranked.length), 200, 2000);
				return { output: { mode: "search", entries: ranked.map(({ block, score }) => ({ nodeId: block.nodeId, version: block.version, field: block.field, evidenceId: block.evidenceId, score: Number(score.toFixed(4)), excerpt: sliceText(block.text, perEntry) })), truncated: ranked.some(({ block }) => block.text.length > perEntry) } };
			}
			// L1 — structured filter over latest submissions
			const field = request.field ?? "all";
			let candidates = input.memory.blocks(nodeFilter);
			if (field === "all") candidates = candidates.filter((block) => block.field === "summary");
			else candidates = candidates.filter((block) => block.field === field);
			const selected = candidates.slice(0, request.topK ?? 5);
			if (selected.length === 0) return { output: { mode: "filter", entries: [], hint: "no committed context matches; call with list:true to inspect available memory" } };
			const perEntry = clamp(Math.floor(maxChars / selected.length), 200, 2000);
			return { output: { mode: "filter", entries: selected.map((block) => ({ nodeId: block.nodeId, version: block.version, field: block.field, evidenceId: block.evidenceId, excerpt: sliceText(block.text, perEntry) })), truncated: selected.some((block) => block.text.length > perEntry) } };
		},
	};
}
