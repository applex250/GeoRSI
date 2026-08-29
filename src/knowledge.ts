/**
 * Tagged knowledge base — the durable, cross-run evolution memory.
 *
 * Design ("knowledge graph, pragmatically"): every lesson is a NODE tagged
 * with the regions it applies to; retrieval is tag-intersect + utility sort
 * + hard char budget. Multi-parent semantics of a graph without graph
 * machinery; deterministic routing from metadata the problem already carries.
 *
 * Storage: knowledge/nodes.jsonl (one JSON node per line, rewritten
 * atomically on stats updates — exam runs are serial by protocol).
 *
 * Determinism contract: selectKnowledge(problemMeta, store) is a pure
 * function of its inputs, so the same store version + problem always yields
 * the same injected set — re-evals of the same submission stay same-scored.
 * Stats updates happen AFTER an episode ends, never mid-eval.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./config.js";

export interface KnowledgeNode {
	id: string;
	text: string;
	tags: string[];
	scope: "generic" | "regional";
	stats: { uses: number; wins: number; fitness_sum: number };
	origin: { run: string; gen: number };
	status: "active" | "probation" | "retired";
}

export const KNOWLEDGE_CHAR_BUDGET = 6000;
/** a "win" is coarse on purpose: episodes that reached basic competence */
export const WIN_LINE = 0.6;

export function knowledgePath(): string {
	// per-lane override for provider-parallel runs: each lane gets a COPY of
	// the store (stats accumulate independently, merged back afterwards) so
	// read-modify-write never races across lanes
	const envPath = process.env.RSILAB_KB_PATH;
	if (envPath) return envPath;
	return join(ROOT, "knowledge", "nodes.jsonl");
}

export function loadKnowledge(): KnowledgeNode[] {
	const p = knowledgePath();
	if (!existsSync(p)) return [];
	const out: KnowledgeNode[] = [];
	for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line) as KnowledgeNode);
		} catch {
			// skip corrupted line; struct_selftest flags it separately
		}
	}
	return out;
}

/** stable content fingerprint of the store (selection audit trail) */
export function storeVersion(nodes: KnowledgeNode[]): string {
	const canon = nodes
		.map((n) => JSON.stringify([n.id, n.text, n.tags, n.status]))
		.sort()
		.join("\n");
	return createHash("sha256").update(canon).digest("hex").slice(0, 12);
}

/** regions a problem belongs to, derived from metadata we already have */
export function deriveTags(genre: string | undefined, problemId: string): string[] {
	const tags = new Set<string>();
	const g = (genre ?? "").toLowerCase();
	for (const t of g.split(/[^a-z0-9]+/)) if (t) tags.add(t);
	if (g) tags.add(g);
	const suite = problemId.split("_")[0].toLowerCase();
	if (suite) tags.add(suite);
	return [...tags];
}

export interface KnowledgeSelection {
	nodes: KnowledgeNode[];
	version: string;
	tags: string[];
}

/**
 * Pick active knowledge for one problem. Probation nodes are excluded by
 * default; set RSILAB_KB_INCLUDE_PROBATION=1 for an explicit A/B pilot. This
 * keeps unvalidated champion tips from silently becoming part of every run.
 */
export function selectKnowledge(
	nodes: KnowledgeNode[],
	meta: { genre?: string; id: string },
	budgetChars = KNOWLEDGE_CHAR_BUDGET,
): KnowledgeSelection {
	const tags = deriveTags(meta.genre, meta.id);
	const includeProbation = process.env.RSILAB_KB_INCLUDE_PROBATION === "1";
	const scored: { n: KnowledgeNode; matches: number }[] = [];
	for (const n of nodes) {
		if (n.status !== "active" && !(includeProbation && n.status === "probation")) continue;
		const matches = n.scope === "generic" ? 1 : n.tags.filter((t) => tags.includes(t)).length;
		if (matches > 0) scored.push({ n, matches });
	}
	scored.sort((a, b) => {
		if (a.n.status !== b.n.status) return a.n.status === "active" ? -1 : 1;
		if (b.matches !== a.matches) return b.matches - a.matches;
		const ua = a.n.stats.uses ? a.n.stats.fitness_sum / a.n.stats.uses : -1;
		const ub = b.n.stats.uses ? b.n.stats.fitness_sum / b.n.stats.uses : -1;
		if (ub !== ua) return ub - ua; // untried (-1) first: exploration before exploitation
		if (b.n.stats.uses !== a.n.stats.uses) return b.n.stats.uses - a.n.stats.uses;
		return a.n.id < b.n.id ? -1 : 1;
	});
	const picked: KnowledgeNode[] = [];
	let used = 0;
	for (const { n } of scored) {
		if (used + n.text.length > budgetChars && picked.length > 0) break;
		picked.push(n);
		used += n.text.length;
	}
	return { nodes: picked, version: storeVersion(nodes), tags };
}

export function renderKnowledge(sel: KnowledgeSelection): string {
	if (sel.nodes.length === 0) return "";
	const lines = sel.nodes.map((n) => `- [${n.status === "probation" ? "probation; test before trusting" : "active"}] ${n.text}`);
	return "\n\nCurated knowledge matched to this task (active lessons and explicit probation pilots):\n" + lines.join("\n");
}

/**
 * Post-episode feedback: bump usage counters for the nodes that were in
 * context. Reloads the store fresh (another process may have appended),
 * patches, saves atomically. Never called while an eval can observe it.
 */
export function recordUsage(ids: string[], fitness: number): void {
	if (ids.length === 0 || !Number.isFinite(fitness)) return;
	const nodes = loadKnowledge();
	const want = new Set(ids);
	let touched = false;
	for (const n of nodes) {
		if (!want.has(n.id)) continue;
		n.stats.uses += 1;
		if (fitness >= WIN_LINE) n.stats.wins += 1;
		n.stats.fitness_sum = Math.round((n.stats.fitness_sum + fitness) * 1e6) / 1e6;
		touched = true;
	}
	if (!touched) return;
	const p = knowledgePath();
	const tmp = p + ".tmp";
	writeFileSync(tmp, nodes.map((n) => JSON.stringify(n)).join("\n") + "\n", "utf8");
	renameSync(tmp, p);
}
