/** Task signature: the two-level key an experience record is filed under. Pure. */
import { createHash } from "node:crypto";
import type { ResearchMission } from "../contracts.js";
import { stableJson } from "../event-ledger.js";
import type { TaskSignature } from "./schema.js";

const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "over", "under", "请", "的", "和", "与", "并", "对", "在", "是", "了", "及", "其", "以及", "进行", "分析", "研究", "评估", "估计", "说明"]);

/** ASCII words plus CJK bigrams — the same shape the run-scoped context memory scores on, kept
 * local so this module stays free of the memory's I/O dependencies. */
export function signatureTokens(text: string, limit = 24): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const push = (token: string): void => { if (token && !seen.has(token) && !STOP.has(token)) { seen.add(token); out.push(token); } };
	for (const word of text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []) push(word);
	const cjk = text.replace(/[^\u4e00-\u9fff]/g, "");
	for (let index = 0; index + 1 < cjk.length; index += 1) push(cjk.slice(index, index + 2));
	return out.slice(0, limit);
}

export function datasetFingerprint(mission: Pick<ResearchMission, "dataset">): string | null {
	return mission.dataset ? createHash("sha256").update(stableJson(mission.dataset)).digest("hex").slice(0, 16) : null;
}

export function taskSignature(mission: ResearchMission): TaskSignature {
	const stages = [...mission.taskProfile.requiredStages].sort();
	const capabilities = [...mission.taskProfile.capabilities].sort();
	const fingerprint = datasetFingerprint(mission);
	const exact = createHash("sha256").update([mission.taskProfile.family, stages.join(","), capabilities.join(","), mission.taskProfile.verifierProfile, fingerprint ?? "none"].join("|")).digest("hex").slice(0, 24);
	return { exact, family: mission.taskProfile.family, stages, capabilities, verifierProfile: mission.taskProfile.verifierProfile, datasetFingerprint: fingerprint, keywords: signatureTokens(mission.question) };
}

/** Lexical overlap in [0,1] between two signatures' keyword sets (Jaccard). */
export function keywordSimilarity(left: TaskSignature, right: TaskSignature): number {
	const a = new Set(left.keywords);
	const b = new Set(right.keywords);
	if (!a.size || !b.size) return 0;
	let shared = 0;
	for (const token of a) if (b.has(token)) shared += 1;
	return shared / (a.size + b.size - shared);
}
