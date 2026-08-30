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

export type MemoryConfidence = "probation" | "validated";
export type MemoryEvidenceSource = "public_score" | "episode_outcome" | "operator";

export interface MemoryEvidence {
	/** What the agent-visible evidence actually supports. */
	source: MemoryEvidenceSource;
	/** Public score only; private fitness must never be rendered to the agent. */
	score: number | null;
	/** Number of independent observations behind this item. */
	repetitions: number;
}

export interface MemoryItem {
	ts: number;
	problem: string;
	genre: string;
	tag: string;
	text: string;
	publicScore: number | null;
	/** New records start as probation; old JSONL records default to probation. */
	confidence?: MemoryConfidence;
	/** Evidence metadata is deliberately agent-safe and public-only. */
	evidence?: MemoryEvidence;
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
				const parsed = JSON.parse(line) as MemoryItem;
				const score = parsed.publicScore ?? null;
				items.push({
					...parsed,
					confidence: parsed.confidence ?? "probation",
					evidence: parsed.evidence ?? {
						source: score != null ? "public_score" : "episode_outcome",
						score,
						repetitions: 1,
					},
				});
			} catch {
				/* torn tail tolerated */
			}
		}
	}
	return { dir, items };
}

export function addMemory(store: MemoryStore, item: MemoryItem): void {
	const score = item.publicScore ?? null;
	const normalized: MemoryItem = {
		...item,
		confidence: item.confidence ?? "probation",
		evidence: item.evidence ?? {
			source: score != null ? "public_score" : "episode_outcome",
			score,
			repetitions: 1,
		},
	};
	store.items.push(normalized);
	appendFileSync(join(store.dir, "memory.jsonl"), JSON.stringify(normalized) + "\n");
}

/** Deterministic recall: same problem > same genre > score > recency. */
export function recall(store: MemoryStore, problem: string, genre: string, k = 6): MemoryItem[] {
	const now = Date.now();
	const scored = store.items.map((m) => {
		let s = 0;
		if (m.problem === problem) s += 5;
		if (m.genre === genre) s += 2;
		if (m.publicScore != null) s += Math.min(3, m.publicScore);
		s += Math.max(0, 2 / (1 + Math.max(0, now - m.ts) / 86_400_000));
		return { m, s };
	});
	// keep equal-scored evidence deterministic across filesystems/runs
	scored.sort((a, b) => b.s - a.s || b.m.ts - a.m.ts || a.m.problem.localeCompare(b.m.problem) || a.m.text.localeCompare(b.m.text));
	return scored.slice(0, k).map((x) => x.m);
}

export function renderMemory(items: MemoryItem[]): string {
	if (items.length === 0) return "";
	return (
		"Possibly relevant experience from earlier episodes (probationary evidence; verify before trusting):\n" +
		items
			.map((m) => {
				const confidence = m.confidence ?? "probation";
				const source = m.evidence?.source === "public_score" ? "public-only" : "episode";
				return `- [${m.tag}|${confidence}|${source}] ${m.text}`;
			})
			.join("\n")
	);
}

/**
 * A fixed, safe reflection fallback — never requires an LLM call.
 *
 * Public success is evidence that one submission worked on the visible split;
 * it is deliberately NOT described as proof of generalization. Promotion to a
 * trusted/validated lesson requires a separate repeated or cross-task check.
 */
export function defaultObservation(problem: string, publicScore: number | null, failed: boolean): string[] {
	if (failed) {
		return [`on ${problem}: no valid submission was produced; this is a failure signal, not a proven diagnosis — simplify and submit early`];
	}
	if (publicScore != null && publicScore >= 0.9) {
		return [`on ${problem}: public split score ${publicScore.toFixed(2)}; promising candidate recipe only — verify on new data before reusing it`];
	}
	return [`on ${problem}: partial public credit ${publicScore?.toFixed(2) ?? "?"}; candidate hypothesis only — validate the estimator on reference or new data before submitting`];
}
