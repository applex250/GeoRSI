/** Extract → gate → store, for one run directory. Safe to call after packaging: it never
 * touches the sealed ledger, it only reads the package and writes `experience.json` next to
 * it plus the cross-run store lanes. Idempotent per run. */
import { join } from "node:path";
import { atomicWriteJson } from "../../journal.js";
import { extractExperience } from "./extract.js";
import { applyGates } from "./gates.js";
import type { ExperienceRecord } from "./schema.js";
import { ExperienceStore } from "./store.js";

export interface HarvestSummary {
	version: 1;
	runId: string;
	harvestedAt: string;
	runRecord: string | null;
	counterExamples: string[];
	added: string[];
	skipped: string[];
	refused: { id: string; issues: string[] }[];
	pendingHuman: string[];
	statuses: Record<string, string>;
	issues: string[];
}

export function harvestRunExperience(runDir: string, store: ExperienceStore = new ExperienceStore(), now: () => Date = () => new Date()): HarvestSummary {
	const extracted = extractExperience(runDir, now);
	const policy = { knownFamilies: store.knownFamilies() };
	const gated: ExperienceRecord[] = [];
	if (extracted.run) gated.push(applyGates(extracted.run, policy));
	// Counter-examples from the same run see the family as known once the run record exists.
	const counterPolicy = { knownFamilies: new Set([...policy.knownFamilies, ...(extracted.run ? [extracted.run.family] : [])]) };
	for (const counter of extracted.counterExamples) gated.push(applyGates(counter, counterPolicy));
	const result = store.append(gated);
	const summary: HarvestSummary = {
		version: 1,
		runId: extracted.run?.origin.runId ?? gated[0]?.origin.runId ?? runDir.split(/[\\/]/).pop() ?? runDir,
		harvestedAt: now().toISOString(),
		runRecord: extracted.run ? gated[0]!.id : null,
		counterExamples: extracted.counterExamples.map((record) => record.id),
		added: result.added,
		skipped: result.skipped,
		refused: result.refused,
		pendingHuman: gated.filter((record) => record.gates.human === "pending").map((record) => record.id),
		statuses: Object.fromEntries(gated.map((record) => [record.id, record.status])),
		issues: extracted.issues,
	};
	atomicWriteJson(join(runDir, "experience.json"), summary);
	return summary;
}
