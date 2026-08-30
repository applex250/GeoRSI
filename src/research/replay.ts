/** Deterministic verify-only replay for research packages. */
import { createHash } from "node:crypto";
import type { EvidenceRef, ResearchClaim, ResearchMission, ResearchWorkGraph } from "./contracts.js";
import type { ResearchEnvironment } from "./environment-capture.js";
import type { ResearchRuntimeAttestation } from "./runtime-attestation.js";
import { runtimeAttestationHash } from "./runtime-attestation.js";
import type { ContentAddressedEvidenceStore } from "./evidence-store.js";
import { validateResearchClaim } from "./decision-policy.js";
import { readResearchLedger, stableJson } from "./event-ledger.js";
import { validateWorkGraph, workGraphComplete, workGraphFingerprint } from "./work-graph.js";
import { researchObjectHash, verifyResearchPackageManifest, type ResearchPackageManifest } from "./artifact-manifest.js";

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

function sha256(content: Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

export function verifyResearchPackage(input: {
	manifest: ResearchPackageManifest;
	ledgerPath: string;
	mission: ResearchMission;
	graph: ResearchWorkGraph;
	environment: ResearchEnvironment;
	runtimeAttestation: ResearchRuntimeAttestation;
	evidence: EvidenceRef[];
	claims: ResearchClaim[];
	evidenceStore: Pick<ContentAddressedEvidenceStore, "verify">;
	readDeliverable(path: string): Buffer;
	now?: Date;
}): ResearchReplayReport {
	const checks: ReplayCheck[] = [];
	checks.push({ id: "manifest-hash", passed: verifyResearchPackageManifest(input.manifest), detail: "research package manifest hash" });
	checks.push({ id: "mission", passed: input.manifest.missionId === input.mission.id && input.manifest.missionFingerprint === researchObjectHash(input.mission).slice(0, 24), detail: "mission identity and fingerprint" });
	const ledger = readResearchLedger(input.ledgerPath);
	checks.push({ id: "event-ledger", passed: ledger.valid && !ledger.tornTail && ledger.rootHash === input.manifest.eventLedgerRootHash, detail: ledger.issues.join("; ") || (ledger.tornTail ? "torn tail" : "hash chain and root match") });
	const graphIssues = validateWorkGraph(input.graph);
	const graphMatches = input.manifest.workGraphFingerprint === workGraphFingerprint(input.graph) && input.manifest.workGraphStateHash === researchObjectHash(input.graph);
	checks.push({ id: "work-graph", passed: graphIssues.length === 0 && workGraphComplete(input.graph) && graphMatches, detail: graphIssues.join("; ") || (!workGraphComplete(input.graph) ? "graph is not terminal" : graphMatches ? "DAG and committed state match" : "graph fingerprint mismatch") });
	checks.push({ id: "environment", passed: input.manifest.environmentFingerprint === input.environment.fingerprint && input.manifest.environmentHash === researchObjectHash(input.environment), detail: "environment fingerprint and full object hash" });
	checks.push({ id: "runtime-attestation", passed: input.manifest.runtimeAttestationHash === runtimeAttestationHash(input.runtimeAttestation), detail: "runtime attestation hash" });
	const sortedEvidence = [...input.evidence].sort((left, right) => left.id.localeCompare(right.id));
	const evidenceIssues = sortedEvidence.filter((reference) => !input.evidenceStore.verify(reference)).map((reference) => reference.id);
	const evidenceIndexMatches = input.manifest.evidenceIndexHash === researchObjectHash(sortedEvidence) && stableJson(input.manifest.evidence) === stableJson(sortedEvidence);
	checks.push({ id: "evidence-integrity", passed: evidenceIssues.length === 0 && evidenceIndexMatches, detail: evidenceIssues.length ? `invalid evidence: ${evidenceIssues.join(", ")}` : evidenceIndexMatches ? "all content and metadata hashes match" : "evidence index mismatch" });
	const sortedClaims = [...input.claims].sort((left, right) => left.id.localeCompare(right.id));
	const claimIssues = sortedClaims.flatMap((claim) => validateResearchClaim(claim, sortedEvidence).map((issue) => `${claim.id}: ${issue}`));
	const claimIds = sortedClaims.map((claim) => claim.id);
	const claimHashes = sortedClaims.map((claim) => researchObjectHash(claim));
	const claimMatches = stableJson(claimIds) === stableJson(input.manifest.claimIds) && stableJson(claimHashes) === stableJson(input.manifest.claimHashes);
	checks.push({ id: "claim-evidence", passed: claimIssues.length === 0 && claimMatches, detail: claimIssues.join("; ") || (claimMatches ? "claims and references match manifest" : "claim commitment mismatch") });
	const deliverableIssues: string[] = [];
	for (const deliverable of input.manifest.deliverables) {
		try {
			const content = input.readDeliverable(deliverable.path);
			if (content.byteLength !== deliverable.bytes || sha256(content) !== deliverable.sha256) deliverableIssues.push(deliverable.id);
		} catch {
			deliverableIssues.push(deliverable.id);
		}
	}
	checks.push({ id: "deliverables", passed: deliverableIssues.length === 0, detail: deliverableIssues.length ? `missing or modified: ${deliverableIssues.join(", ")}` : "all deliverable bytes and hashes match" });
	return { version: 1, mode: "verify-only", passed: checks.every((check) => check.passed), checks, verifiedAt: (input.now ?? new Date()).toISOString() };
}
