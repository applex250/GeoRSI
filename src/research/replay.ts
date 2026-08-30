/** Deterministic verify-only replay for research packages. */
import type { EvidenceRef, ResearchClaim, ResearchWorkGraph } from "./contracts.js";
import type { ContentAddressedEvidenceStore } from "./evidence-store.js";
import { validateResearchClaim } from "./decision-policy.js";
import { readResearchLedger } from "./event-ledger.js";
import { validateWorkGraph } from "./work-graph.js";
import { verifyResearchPackageManifest, type ResearchPackageManifest } from "./artifact-manifest.js";

export interface ReplayCheck {
	id: string;
	passed: boolean;
	detail: string;
}

export interface ResearchReplayReport {
	version: 1;
	mode: "verify-only";
	passed: boolean;
	checks: ReplayCheck[];
	verifiedAt: string;
}

export function verifyResearchPackage(input: {
	manifest: ResearchPackageManifest;
	ledgerPath: string;
	graph: ResearchWorkGraph;
	evidence: EvidenceRef[];
	claims: ResearchClaim[];
	evidenceStore: Pick<ContentAddressedEvidenceStore, "verify">;
	now?: Date;
}): ResearchReplayReport {
	const checks: ReplayCheck[] = [];
	checks.push({ id: "manifest-hash", passed: verifyResearchPackageManifest(input.manifest), detail: "research package manifest hash" });
	const ledger = readResearchLedger(input.ledgerPath);
	checks.push({ id: "event-ledger", passed: ledger.valid && !ledger.tornTail && ledger.rootHash === input.manifest.eventLedgerRootHash, detail: ledger.issues.join("; ") || (ledger.tornTail ? "torn tail" : "hash chain and root match") });
	const graphIssues = validateWorkGraph(input.graph);
	checks.push({ id: "work-graph", passed: graphIssues.length === 0, detail: graphIssues.join("; ") || "DAG valid" });
	const evidenceIssues = input.evidence.filter((reference) => !input.evidenceStore.verify(reference)).map((reference) => reference.id);
	checks.push({ id: "evidence-integrity", passed: evidenceIssues.length === 0, detail: evidenceIssues.length ? `invalid evidence: ${evidenceIssues.join(", ")}` : "all content hashes match" });
	const claimIssues = input.claims.flatMap((claim) => validateResearchClaim(claim, input.evidence).map((issue) => `${claim.id}: ${issue}`));
	checks.push({ id: "claim-evidence", passed: claimIssues.length === 0, detail: claimIssues.join("; ") || "all claim references valid" });
	const indexedIds = new Set(input.manifest.evidence.map((reference) => reference.id));
	const missingIndex = input.evidence.filter((reference) => !indexedIds.has(reference.id)).map((reference) => reference.id);
	checks.push({ id: "evidence-index", passed: missingIndex.length === 0 && indexedIds.size === input.evidence.length, detail: missingIndex.length ? `not indexed: ${missingIndex.join(", ")}` : "manifest evidence index complete" });
	return {
		version: 1,
		mode: "verify-only",
		passed: checks.every((check) => check.passed),
		checks,
		verifiedAt: (input.now ?? new Date()).toISOString(),
	};
}
