/**
 * Event-sourced run state: append-only journal + atomic snapshots.
 *
 * Discipline (ported from OpenRSI_qh's tree_search_state, fixing its one
 * weakness — non-atomic journal rewrites):
 *  - board.jsonl is APPEND-ONLY, one JSON per line, flushed+fsynced. Crash at
 *    any line leaves a valid prefix.
 *  - state.json snapshots are written tmp+rename (atomic on POSIX and NTFS).
 *  - On resume we rebuild in-memory state from state.json and cross-check the
 *    journal tail; a missing snapshot replays from the journal alone.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Scaffold } from "./scaffold.js";

export interface GenRecord {
	kind: "episode" | "proposal" | "accept" | "note" | "memory" | "goal";
	ts: string;
	generation: number;
	[key: string]: unknown;
}

export interface RunState {
	version: 1;
	name: string;
	startedAt: string;
	updatedAt: string;
	fingerprint: string;
	generation: number;
	champion: Scaffold;
	bestFitness: number | null;
	fitnessHistory: number[];
	stagnation: number;
	tokensUsed: number;
}

export class Journal {
	private readonly fh: number;

	constructor(dir: string) {
		mkdirSync(dir, { recursive: true });
		this.fh = openSync(join(dir, "board.jsonl"), "a");
	}

	append(rec: GenRecord): void {
		appendFileSync(this.fh, JSON.stringify(rec) + "\n");
		try {
			fsyncSync(this.fh);
		} catch {
			// best effort durability; the append itself is already in the OS page cache
		}
	}

	close(): void {
		closeSync(this.fh);
	}
}

/** Atomic JSON write: tmp file + rename. Never leaves a half-written file. */
export function atomicWriteJson(path: string, obj: unknown): void {
	const tmp = path + ".tmp";
	writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
	renameSync(tmp, path);
}

export function writeTextAtomic(path: string, text: string): void {
	const tmp = path + ".tmp";
	writeFileSync(tmp, text, "utf8");
	renameSync(tmp, path);
}

export function saveRunState(dir: string, state: RunState): void {
	state.updatedAt = new Date().toISOString();
	atomicWriteJson(join(dir, "state.json"), state);
}

export function loadRunState(dir: string): RunState | null {
	const p = join(dir, "state.json");
	if (!existsSync(p)) return null;
	try {
		const s = JSON.parse(readFileSync(p, "utf8")) as RunState;
		if (s.version !== 1 || !s.champion) return null;
		return s;
	} catch {
		return null;
	}
}

/** Fingerprint of the run-defining config: mismatched resume is refused. */
export function fingerprint(parts: unknown[]): string {
	const s = JSON.stringify(parts);
	// FNV-1a: stable, dependency-free
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16);
}

/** Read the last non-empty lines of a jsonl file (for board summaries). */
export function readJournalTail(dir: string, n = 200): GenRecord[] {
	const p = join(dir, "board.jsonl");
	if (!existsSync(p)) return [];
	const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
	const out: GenRecord[] = [];
	for (const line of lines.slice(-n)) {
		try {
			out.push(JSON.parse(line) as GenRecord);
		} catch {
			// tolerate a torn tail line (crash mid-append)
		}
	}
	return out;
}

export function cleanupTmp(path: string): void {
	if (existsSync(path + ".tmp")) {
		try {
			unlinkSync(path + ".tmp");
		} catch {
			/* best effort */
		}
	}
}
