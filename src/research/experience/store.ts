/**
 * Cross-run experience store: append-only JSONL lanes under `knowledge/experience/` with an
 * `index.json` keyed by task signature. Writes are whole-file atomic (tmp + rename via the
 * journal helper), reads tolerate a torn last line. Idempotent by record id so a re-run of
 * the extractor over the same run directory never duplicates.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../config.js";
import { writeTextAtomic } from "../../journal.js";
import { applyApproval } from "./approval.js";
import type { ApprovalRecord, ExperienceRecord } from "./schema.js";
import { validateExperienceRecord } from "./schema.js";

/** `GEORSI_EXPERIENCE_ROOT` redirects the store (selftests point it at a temp dir so fixture
 * runs never enter the real lanes). Evaluated per construction, not at import. */
export function defaultExperienceRoot(): string {
	return process.env.GEORSI_EXPERIENCE_ROOT?.trim() || join(ROOT, "knowledge", "experience");
}

export interface ExperienceIndex {
	version: 1;
	updatedAt: string;
	records: number;
	counterExamples: number;
	bySignature: Record<string, string[]>;
	byFamily: Record<string, number>;
	byStatus: Record<string, number>;
	pendingHuman: string[];
}

function readJsonl<T>(path: string): T[] {
	if (!existsSync(path)) return [];
	const out: T[] = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try { out.push(JSON.parse(line) as T); } catch { /* torn tail tolerated */ }
	}
	return out;
}

export class ExperienceStore {
	readonly root: string;
	constructor(root?: string) { this.root = root ?? defaultExperienceRoot(); }

	private file(name: "records" | "counter-examples" | "approvals"): string { return join(this.root, `${name}.jsonl`); }

	private writeJsonl(path: string, items: readonly unknown[]): void {
		mkdirSync(this.root, { recursive: true });
		writeTextAtomic(path, items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : ""));
	}

	records(): ExperienceRecord[] { return readJsonl<ExperienceRecord>(this.file("records")); }
	counterExamples(): ExperienceRecord[] { return readJsonl<ExperienceRecord>(this.file("counter-examples")); }
	all(): ExperienceRecord[] { return [...this.records(), ...this.counterExamples()]; }
	approvals(recordId?: string): ApprovalRecord[] { return readJsonl<ApprovalRecord>(this.file("approvals")).filter((item) => !recordId || item.recordId === recordId); }
	get(id: string): ExperienceRecord | undefined { return this.all().find((record) => record.id === id); }
	knownFamilies(): Set<string> { return new Set(this.records().map((record) => record.family)); }

	/** Add records that are not yet stored. Invalid records are refused with their issues. */
	append(incoming: readonly ExperienceRecord[]): { added: string[]; skipped: string[]; refused: { id: string; issues: string[] }[] } {
		const added: string[] = [];
		const skipped: string[] = [];
		const refused: { id: string; issues: string[] }[] = [];
		const records = this.records();
		const counters = this.counterExamples();
		const known = new Set([...records, ...counters].map((record) => record.id));
		for (const record of incoming) {
			const issues = validateExperienceRecord(record);
			if (issues.length) { refused.push({ id: record.id, issues }); continue; }
			if (known.has(record.id)) { skipped.push(record.id); continue; }
			known.add(record.id);
			(record.status === "counter-example" ? counters : records).push(record);
			added.push(record.id);
		}
		if (added.length) {
			this.writeJsonl(this.file("records"), records);
			this.writeJsonl(this.file("counter-examples"), counters);
			this.rebuildIndex(records, counters);
		}
		return { added, skipped, refused };
	}

	/** Persist an updated record in whichever lane holds it. */
	replace(next: ExperienceRecord): void {
		const issues = validateExperienceRecord(next);
		if (issues.length) throw new Error(`experience record invalid: ${issues.join("; ")}`);
		const records = this.records();
		const counters = this.counterExamples();
		const inRecords = records.findIndex((record) => record.id === next.id);
		const inCounters = counters.findIndex((record) => record.id === next.id);
		if (inRecords < 0 && inCounters < 0) throw new Error(`experience record not found: ${next.id}`);
		if (inRecords >= 0) records[inRecords] = next; else counters[inCounters] = next;
		this.writeJsonl(this.file("records"), records);
		this.writeJsonl(this.file("counter-examples"), counters);
		this.rebuildIndex(records, counters);
	}

	/** Record a human decision and apply it to the record (the operator evidence source). */
	recordApproval(approval: ApprovalRecord): ExperienceRecord {
		const record = this.get(approval.recordId);
		if (!record) throw new Error(`experience record not found: ${approval.recordId}`);
		if (this.approvals().some((item) => item.id === approval.id)) throw new Error(`approval already recorded: ${approval.id}`);
		const next = applyApproval(record, approval);
		this.writeJsonl(this.file("approvals"), [...this.approvals(), approval]);
		this.replace(next);
		return next;
	}

	index(): ExperienceIndex | null {
		const path = join(this.root, "index.json");
		if (!existsSync(path)) return null;
		try { return JSON.parse(readFileSync(path, "utf8")) as ExperienceIndex; } catch { return null; }
	}

	private rebuildIndex(records: readonly ExperienceRecord[], counters: readonly ExperienceRecord[]): void {
		const bySignature: Record<string, string[]> = {};
		const byFamily: Record<string, number> = {};
		const byStatus: Record<string, number> = {};
		const pendingHuman: string[] = [];
		for (const record of [...records, ...counters]) {
			(bySignature[record.signature.exact] ??= []).push(record.id);
			byFamily[record.family] = (byFamily[record.family] ?? 0) + 1;
			byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;
			if (record.gates.human === "pending") pendingHuman.push(record.id);
		}
		const index: ExperienceIndex = { version: 1, updatedAt: new Date().toISOString(), records: records.length, counterExamples: counters.length, bySignature, byFamily, byStatus, pendingHuman: pendingHuman.sort() };
		writeTextAtomic(join(this.root, "index.json"), JSON.stringify(index, null, 2) + "\n");
	}
}
