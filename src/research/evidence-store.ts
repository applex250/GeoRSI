/** Content-addressed quarantine store for untrusted research artifacts. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { EvidenceRef } from "./contracts.js";
import { sanitizeResearchUrl, stableJson } from "./event-ledger.js";

export interface PutEvidenceOptions {
	kind: EvidenceRef["kind"];
	logicalName: string;
	producerNodeId: string;
	mediaType: string;
	sourceUrl?: string;
	retrievedAt?: string;
	license?: string;
}

export class ContentAddressedEvidenceStore {
	constructor(readonly root: string) {
		mkdirSync(root, { recursive: true });
	}

	putBuffer(content: Buffer, options: PutEvidenceOptions): EvidenceRef {
		const sha256 = createHash("sha256").update(content).digest("hex");
		const directory = join(this.root, sha256.slice(0, 2));
		mkdirSync(directory, { recursive: true });
		const dataPath = join(directory, sha256);
		if (!existsSync(dataPath)) writeFileSync(dataPath, content, { flag: "wx", mode: 0o600 });
		return {
			id: `sha256:${sha256}`,
			kind: options.kind,
			sha256,
			logicalName: basename(options.logicalName).slice(0, 160) || "artifact",
			producerNodeId: options.producerNodeId,
			mediaType: options.mediaType,
			bytes: content.byteLength,
			sourceUrl: options.sourceUrl ? sanitizeResearchUrl(options.sourceUrl) : undefined,
			retrievedAt: options.retrievedAt,
			license: options.license,
		};
	}

	putText(content: string, options: PutEvidenceOptions): EvidenceRef {
		return this.putBuffer(Buffer.from(content, "utf8"), options);
	}

	putJson(value: unknown, options: Omit<PutEvidenceOptions, "mediaType"> & { mediaType?: string }): EvidenceRef {
		return this.putText(stableJson(value), { ...options, mediaType: options.mediaType ?? "application/json" });
	}

	pathFor(reference: Pick<EvidenceRef, "sha256">): string {
		return join(this.root, reference.sha256.slice(0, 2), reference.sha256);
	}

	verify(reference: EvidenceRef): boolean {
		const path = this.pathFor(reference);
		if (!existsSync(path)) return false;
		const content = readFileSync(path);
		return content.byteLength === reference.bytes && createHash("sha256").update(content).digest("hex") === reference.sha256;
	}

	read(reference: EvidenceRef): Buffer {
		if (!this.verify(reference)) throw new Error(`evidence integrity failure: ${reference.id}`);
		return readFileSync(this.pathFor(reference));
	}

	/** Rebuild refs by scanning the CAS directory (resume support): metadata is synthetic
	 * (original kind/logicalName live only in the executor snapshot / ledger), but ids and
	 * integrity are exact, which is all downstream context assembly requires. */
	listContents(): EvidenceRef[] {
		const refs: EvidenceRef[] = [];
		if (!existsSync(this.root)) return refs;
		for (const prefix of readdirSync(this.root)) {
			const directory = join(this.root, prefix);
			for (const name of readdirSync(directory)) {
				const path = join(directory, name);
				const content = readFileSync(path);
				const sha256 = createHash("sha256").update(content).digest("hex");
				refs.push({ id: `sha256:${sha256}`, kind: "tool-output", sha256, logicalName: `${sha256.slice(0, 12)}.bin`, producerNodeId: "resumed", mediaType: "application/octet-stream", bytes: content.byteLength });
			}
		}
		return refs.sort((left, right) => left.id.localeCompare(right.id));
	}
}
