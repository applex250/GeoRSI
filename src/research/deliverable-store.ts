/** Filesystem adapter for sanitized human-facing research deliverables. */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJson, writeTextAtomic } from "../journal.js";
import type { ResearchDeliverableBundle } from "./deliverables.js";

export interface PersistedResearchDeliverable {
	id: "report" | "presentation" | "defense";
	path: string;
	sha256: string;
	bytes: number;
	required: true;
}

function descriptor(id: PersistedResearchDeliverable["id"], path: string, content: string): PersistedResearchDeliverable {
	return { id, path, sha256: createHash("sha256").update(content).digest("hex"), bytes: Buffer.byteLength(content), required: true };
}

export function persistResearchDeliverables(root: string, bundle: ResearchDeliverableBundle): PersistedResearchDeliverable[] {
	mkdirSync(root, { recursive: true });
	const reportPath = join(root, "report.md");
	const presentationPath = join(root, "presentation.md");
	const defensePath = join(root, "defense.json");
	const defenseText = JSON.stringify(bundle.defense, null, 2);
	writeTextAtomic(reportPath, bundle.reportMarkdown);
	writeTextAtomic(presentationPath, bundle.presentationMarkdown);
	atomicWriteJson(defensePath, bundle.defense);
	return [
		descriptor("report", "report.md", bundle.reportMarkdown),
		descriptor("presentation", "presentation.md", bundle.presentationMarkdown),
		descriptor("defense", "defense.json", defenseText),
	];
}
