/** Append-only, hash-chained and redacted research trajectory ledger. */
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ResearchEventInput {
	missionId: string;
	episodeId: string;
	nodeId?: string;
	actor: "controller" | "planner" | "researcher" | "verifier" | "tool" | "evaluator";
	type: string;
	inputHash?: string;
	outputHash?: string;
	artifactIds?: string[];
	status: "start" | "progress" | "success" | "failure";
	payload?: unknown;
	error?: { name: string; message: string; code?: string };
}

export interface ResearchEvent extends ResearchEventInput {
	version: 1;
	seq: number;
	eventId: string;
	previousHash: string | null;
	timestamp: string;
	hash: string;
}

export interface LedgerVerification {
	valid: boolean;
	events: ResearchEvent[];
	issues: string[];
	rootHash: string | null;
	tornTail: boolean;
}

const SECRET_KEY = /(?:api[_-]?key|token|authorization|password|passwd|secret|private[_-]?key|credential)/i;
const SECRET_TEXT = /(?:Bearer\s+[A-Za-z0-9._~+\/-]{12,}|sk-[A-Za-z0-9_-]{20,})/gi;

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]));
	}
	return value;
}

export function stableJson(value: unknown): string {
	return JSON.stringify(stableValue(value));
}

export function sanitizeResearchEvidence(value: unknown, protectedStrings: readonly string[] = []): unknown {
	if (typeof value === "string") {
		let output = value.replace(SECRET_TEXT, "[REDACTED_CREDENTIAL]");
		for (const protectedString of protectedStrings.filter(Boolean)) {
			output = output.split(protectedString).join("[REDACTED_PROTECTED_PATH]");
		}
		return output.slice(0, 100_000);
	}
	if (Array.isArray(value)) return value.map((item) => sanitizeResearchEvidence(item, protectedStrings));
	if (value && typeof value === "object") {
		const output: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
			output[key] = SECRET_KEY.test(key) ? "[REDACTED_CREDENTIAL]" : sanitizeResearchEvidence(item, protectedStrings);
		}
		return output;
	}
	return value;
}

function eventHash(event: Omit<ResearchEvent, "hash">): string {
	return createHash("sha256").update(stableJson(event)).digest("hex");
}

export function readResearchLedger(path: string): LedgerVerification {
	if (!existsSync(path)) return { valid: true, events: [], issues: [], rootHash: null, tornTail: false };
	const text = readFileSync(path, "utf8");
	const rawLines = text.split("\n");
	const events: ResearchEvent[] = [];
	const issues: string[] = [];
	let tornTail = false;
	let previousHash: string | null = null;
	for (let index = 0; index < rawLines.length; index++) {
		const line = rawLines[index]!;
		if (!line.trim()) continue;
		let event: ResearchEvent;
		try {
			event = JSON.parse(line) as ResearchEvent;
		} catch {
			if (index === rawLines.length - 1 || rawLines.slice(index + 1).every((candidate) => !candidate.trim())) {
				tornTail = true;
				break;
			}
			issues.push(`malformed ledger event at line ${index + 1}`);
			break;
		}
		if (event.version !== 1) issues.push(`event ${index + 1} has unsupported version`);
		if (event.seq !== events.length + 1) issues.push(`event ${index + 1} has non-monotonic sequence`);
		if (event.previousHash !== previousHash) issues.push(`event ${index + 1} previousHash mismatch`);
		const { hash, ...unsigned } = event;
		if (hash !== eventHash(unsigned)) issues.push(`event ${index + 1} hash mismatch`);
		events.push(event);
		previousHash = hash;
	}
	return { valid: issues.length === 0, events, issues, rootHash: previousHash, tornTail };
}

export class ResearchEventLedger {
	private readonly handle: number;
	private seq: number;
	private previousHash: string | null;

	constructor(
		readonly path: string,
		private readonly now: () => Date = () => new Date(),
		private readonly protectedStrings: readonly string[] = [],
	) {
		mkdirSync(dirname(path), { recursive: true });
		const existing = readResearchLedger(path);
		if (!existing.valid) throw new Error(`research ledger integrity failure: ${existing.issues.join("; ")}`);
		if (existing.tornTail) {
			const temp = `${path}.recover`;
			writeFileSync(temp, existing.events.map((event) => JSON.stringify(event)).join("\n") + (existing.events.length ? "\n" : ""), "utf8");
			renameSync(temp, path);
		}
		this.seq = existing.events.length;
		this.previousHash = existing.rootHash;
		this.handle = openSync(path, "a", 0o600);
	}

	append(input: ResearchEventInput): ResearchEvent {
		const sanitized = sanitizeResearchEvidence(input, this.protectedStrings) as ResearchEventInput;
		const unsigned: Omit<ResearchEvent, "hash"> = {
			...sanitized,
			version: 1,
			seq: ++this.seq,
			eventId: randomUUID(),
			previousHash: this.previousHash,
			timestamp: this.now().toISOString(),
		};
		const event: ResearchEvent = { ...unsigned, hash: eventHash(unsigned) };
		appendFileSync(this.handle, JSON.stringify(event) + "\n");
		try { fsyncSync(this.handle); } catch { /* append remains a valid OS-cached prefix */ }
		this.previousHash = event.hash;
		return event;
	}

	rootHash(): string | null {
		return this.previousHash;
	}

	close(): void {
		closeSync(this.handle);
	}
}
