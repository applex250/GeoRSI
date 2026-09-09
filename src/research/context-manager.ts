/** Bounded context assembly for node-scoped long-horizon workers. */
import { createHash } from "node:crypto";

export type ContextBlockKind = "policy" | "mission" | "node" | "graph" | "dependency" | "evidence" | "claim" | "recipe" | "budget";

export interface ContextBlock {
	id: string;
	kind: ContextBlockKind;
	content: string;
	priority: number;
	mandatory: boolean;
	sourceHash?: string;
}

export interface ContextPackEntry {
	id: string;
	kind: ContextBlockKind;
	chars: number;
	estimatedTokens: number;
	mandatory: boolean;
	priority: number;
	sourceHash: string;
}

export interface ContextPack {
	text: string;
	entries: ContextPackEntry[];
	estimatedTokens: number;
	budgetTokens: number;
	skippedBlockIds: string[];
	fingerprint: string;
}

export function estimateContextTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

function blockHash(block: ContextBlock): string {
	return block.sourceHash ?? createHash("sha256").update(block.content).digest("hex");
}

export function buildContextPack(blocks: readonly ContextBlock[], budgetTokens: number): ContextPack {
	if (!Number.isSafeInteger(budgetTokens) || budgetTokens <= 0) throw new Error("context budget must be a positive integer");
	const seen = new Set<string>();
	for (const block of blocks) {
		if (!block.id.trim() || seen.has(block.id)) throw new Error(`invalid or duplicate context block id: ${block.id}`);
		seen.add(block.id);
	}
	const mandatory = blocks.filter((block) => block.mandatory).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
	const optional = blocks.filter((block) => !block.mandatory).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
	const mandatoryTokens = mandatory.reduce((sum, block) => sum + estimateContextTokens(block.content), 0);
	if (mandatoryTokens > budgetTokens) throw new Error(`mandatory context requires ${mandatoryTokens} tokens but budget is ${budgetTokens}`);
	const selected: ContextBlock[] = [...mandatory];
	let used = mandatoryTokens;
	const skipped: string[] = [];
	for (const block of optional) {
		const tokens = estimateContextTokens(block.content);
		if (used + tokens <= budgetTokens) {
			selected.push(block);
			used += tokens;
		} else skipped.push(block.id);
	}
	selected.sort((left, right) => {
		const order: ContextBlockKind[] = ["policy", "mission", "node", "graph", "dependency", "evidence", "claim", "recipe", "budget"];
		return order.indexOf(left.kind) - order.indexOf(right.kind) || right.priority - left.priority || left.id.localeCompare(right.id);
	});
	const entries = selected.map((block) => ({ id: block.id, kind: block.kind, chars: block.content.length, estimatedTokens: estimateContextTokens(block.content), mandatory: block.mandatory, priority: block.priority, sourceHash: blockHash(block) }));
	const text = selected.map((block) => `## ${block.kind}:${block.id}\n${block.content}`).join("\n\n");
	const fingerprint = createHash("sha256").update(JSON.stringify(entries.map((entry) => [entry.id, entry.sourceHash]))).digest("hex").slice(0, 24);
	return { text, entries, estimatedTokens: used, budgetTokens, skippedBlockIds: skipped, fingerprint };
}
