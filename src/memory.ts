/**
 * Cross-episode experience memory (port of OpenRSI_self's memory.ts, scoped
 * per run to avoid held-out leakage).
 *
 * After each episode a cheap reflection turns the session into 1-2 short
 * tagged observations stored in runs/<name>/memory.jsonl. Recall scores
 * same-problem +5 / same-genre +2 / public-score weight / recency, top-6
 * injected into the inner agent's prompt. Zero embeddings, zero extra calls
 * at recall time.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface MemoryItem {
	ts: number;
	problem: string;
	genre: string;
	tag: string;
	text: string;
	publicScore: number | null;
}

export interface MemoryStore {
	dir: string;
	items: MemoryItem[];
}

/** Create a read-only-in-practice snapshot for fair candidate evaluation. */
export function snapshotMemory(store: MemoryStore): MemoryStore {
	return {
		dir: store.dir,
		items: store.items.map((item) => ({ ...item })),
	};
}

/** Empty episodic context for an independent exam or hold-out evaluation. */
export function emptyMemory(dir: string): MemoryStore {
	return { dir, items: [] };
}

export function openMemory(runDir: string): MemoryStore {
	const dir = join(runDir, "memory");
	mkdirSync(dir, { recursive: true });
	const p = join(dir, "memory.jsonl");
	const items: MemoryItem[] = [];
	if (existsSync(p)) {
		for (const line of readFileSync(p, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				items.push(JSON.parse(line) as MemoryItem);
			} catch {
				/* torn tail tolerated */
			}
		}
	}
	return { dir, items };
}

export function addMemory(store: MemoryStore, item: MemoryItem): void {
	store.items.push(item);
	appendFileSync(join(store.dir, "memory.jsonl"), JSON.stringify(item) + "\n");
}

/** Deterministic recall: same problem > same genre > score > recency. */
export function recall(store: MemoryStore, problem: string, genre: string, k = 6): MemoryItem[] {
	const now = Date.now();
	const scored = store.items.map((m) => {
		let s = 0;
		if (m.problem === problem) s += 5;
		if (m.genre === genre) s += 2;
		if (m.publicScore != null) s += Math.min(3, m.publicScore);
		s += (2 * (m.ts - now)) / (now - 1 || 1) + 2; // mild recency, always > 0
		return { m, s };
	});
	scored.sort((a, b) => b.s - a.s);
	return scored.slice(0, k).map((x) => x.m);
}

export function renderMemory(items: MemoryItem[]): string {
	if (items.length === 0) return "";
	return (
		"Possibly relevant experience from earlier episodes (verify before trusting):\n" +
		items.map((m) => `- [${m.tag}] ${m.text}`).join("\n")
	);
}

/** A fixed, safe reflection fallback — never requires an LLM call. */
export function defaultObservation(problem: string, publicScore: number | null, failed: boolean): string[] {
	if (failed) return [`on ${problem}: episode produced no valid submission; keep scripts minimal and submit early`];
	if (publicScore != null && publicScore >= 0.9) {
		return [`on ${problem}: pipeline validated on reference data scored ${publicScore.toFixed(2)}; same approach generalizes`];
	}
	return [`on ${problem}: partial credit ${publicScore?.toFixed(2) ?? "?"}; validate estimator on reference data before submitting`];
}
