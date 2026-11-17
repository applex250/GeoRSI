/** Filesystem adapter for sanitized human-facing research deliverables. */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson, writeTextAtomic } from "../journal.js";
import { ALL_DELIVERABLES, type ResearchDeliverableBundle, type ResearchDeliverableId } from "./deliverables.js";

export interface PersistedResearchDeliverable {
	id: ResearchDeliverableId;
	path: string;
	sha256: string;
	bytes: number;
	required: true;
}

function descriptor(id: PersistedResearchDeliverable["id"], path: string, content: string): PersistedResearchDeliverable {
	return { id, path, sha256: createHash("sha256").update(content).digest("hex"), bytes: Buffer.byteLength(content), required: true };
}

/** Write the deliverables the mission requires (default: the full competition set). A
 * report-only development run must not leave template presentation/defense files behind
 * that look like node-authored work. */
export function persistResearchDeliverables(root: string, bundle: ResearchDeliverableBundle, required: ReadonlySet<ResearchDeliverableId> = ALL_DELIVERABLES): PersistedResearchDeliverable[] {
	mkdirSync(root, { recursive: true });
	const persisted: PersistedResearchDeliverable[] = [];
	if (required.has("report")) {
		writeTextAtomic(join(root, "report.md"), bundle.reportMarkdown);
		persisted.push(descriptor("report", "report.md", bundle.reportMarkdown));
	}
	if (required.has("presentation")) {
		writeTextAtomic(join(root, "presentation.md"), bundle.presentationMarkdown);
		persisted.push(descriptor("presentation", "presentation.md", bundle.presentationMarkdown));
	}
	if (required.has("defense")) {
		const defenseText = JSON.stringify(bundle.defense, null, 2);
		atomicWriteJson(join(root, "defense.json"), bundle.defense);
		persisted.push(descriptor("defense", "defense.json", defenseText));
	}
	return persisted;
}
