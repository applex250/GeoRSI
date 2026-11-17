/** Rewrite `[evidence:sha256:…]` citations in a workspace report into links the frontend can
 * open: the recorded source URL when the evidence was fetched, otherwise the API's evidence
 * content route. Pure; shared by the legacy agent and the research-engine workspace tier. */
import type { EvidenceRef } from "./contracts.js";

export function linkWorkspaceReport(text: string, evidence: readonly EvidenceRef[], runId: string): string {
	const target = (ref: EvidenceRef): string => ref.sourceUrl ?? `/api/research/research-runs/${runId}/evidence/${encodeURIComponent(ref.id)}/content`;
	const citations = text.replace(/\[evidence:(sha256:[a-f0-9]{64})[\]\)]/g, (_, id: string) => {
		const ref = evidence.find((item) => item.id === id);
		return ref ? `[${ref.logicalName.replace(/[\[\]\\]/g, "")}](${target(ref)})` : `[${id}]`;
	});
	return citations.replace(/\]\(([^)]+)\)/g, (match, raw: string) => {
		let name = raw;
		try { name = decodeURIComponent(raw); } catch { return match; }
		const ref = evidence.find((item) => item.logicalName === name);
		return ref ? `](${target(ref)})` : match;
	});
}
