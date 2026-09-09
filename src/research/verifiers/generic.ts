/** Cross-family research-package verifier. */
import type { EvidenceRef, ResearchClaim, ResearchMission, ResearchWorkGraph } from "../contracts.js";
import { validateResearchClaim } from "../decision-policy.js";
import { validateResearchMission } from "../contracts.js";
import { validateWorkGraphForMission } from "../work-graph.js";
import type { FamilyVerificationAttestation, ContraryEvidenceLink } from "../runtime-attestation.js";
import { errorIssue, verificationResult, type ScientificVerificationResult } from "./base.js";

export interface GenericResearchVerificationInput {
	mission: ResearchMission;
	graph: ResearchWorkGraph;
	evidence: EvidenceRef[];
	claims: ResearchClaim[];
	deliverables: { id: string; path: string; bytes: number; sha256: string }[];
	ledgerValid: boolean;
	replayPassed: boolean;
	guardViolations: string[];
	cleanupPassed: boolean;
	familyVerifications: FamilyVerificationAttestation[];
	contraryEvidenceLinks: ContraryEvidenceLink[];
}

export function verifyGenericResearch(input: GenericResearchVerificationInput): ScientificVerificationResult {
	const issues = [];
	const missionIssues = validateResearchMission(input.mission);
	for (const issue of missionIssues) issues.push(errorIssue("mission-contract", issue));
	const graphIssues = validateWorkGraphForMission(input.mission, input.graph);
	for (const issue of graphIssues) issues.push(errorIssue("work-graph", issue));
	const requiredCriteria = input.mission.successCriteria.filter((criterion) => criterion.required).map((criterion) => criterion.id);
	const coveredCriteria = new Set(input.graph.nodes.flatMap((node) => node.acceptanceCriteriaIds));
	const criteriaCoverage = requiredCriteria.every((id) => coveredCriteria.has(id));
	const requiredStages = new Set(input.mission.taskProfile.requiredStages);
	const completedStages = new Set(input.graph.nodes.filter((node) => node.state === "completed").map((node) => node.kind));
	const missingStages = [...requiredStages].filter((stage) => !completedStages.has(stage));
	for (const stage of missingStages) issues.push(errorIssue("missing-stage", `required research stage not completed: ${stage}`));
	if (!criteriaCoverage) issues.push(errorIssue("missing-criterion", "not every required mission acceptance criterion is covered by the work graph"));
	const evidenceIds = new Set(input.evidence.map((item) => item.id));
	for (const claim of input.claims) for (const issue of validateResearchClaim(claim, input.evidence)) issues.push(errorIssue("claim-evidence", `${claim.id}: ${issue}`));
	for (const node of input.graph.nodes) {
		for (const id of [...node.inputEvidenceIds, ...node.acceptanceEvidenceIds, ...node.outputArtifactIds]) {
			if (id && !evidenceIds.has(id)) issues.push(errorIssue("unindexed-evidence", `${node.id} references evidence not in the package: ${id}`));
		}
	}
	const deliverables = new Map(input.deliverables.map((item) => [item.id, item]));
	for (const required of input.mission.requiredDeliverables.filter((item) => item.required)) {
		const actual = deliverables.get(required.id);
		if (!actual || actual.bytes <= 0 || !/^[a-f0-9]{64}$/i.test(actual.sha256)) issues.push(errorIssue("missing-deliverable", `required deliverable invalid or absent: ${required.id}`));
	}
	for (const violation of input.guardViolations) issues.push(errorIssue("guard-violation", violation));
	const sources = input.evidence.filter((item) => item.kind === "source");
	for (const requirement of input.mission.taskProfile.sourceRequirements) {
		if (sources.length < requirement.minimumCount) issues.push(errorIssue("source-requirement", `${requirement.id} requires ${requirement.minimumCount} sources, found ${sources.length}`));
	}
	if (input.mission.sourcePolicy.requireProvenance && sources.some((source) => !source.sourceUrl)) issues.push(errorIssue("source-provenance", "all source evidence needs a source URL"));
	if (input.mission.sourcePolicy.requireContentHash && sources.some((source) => !/^[a-f0-9]{64}$/i.test(source.sha256))) issues.push(errorIssue("source-hash", "all source evidence needs a content hash"));
	if (input.mission.sourcePolicy.requireLicenseMetadata && sources.some((source) => !source.license)) issues.push(errorIssue("source-license", "all source evidence needs license metadata"));
	if (input.mission.sourcePolicy.requireRetrievedAt && sources.some((source) => !source.retrievedAt || Number.isNaN(Date.parse(source.retrievedAt)))) issues.push(errorIssue("source-retrieved-at", "all source evidence needs a retrieval time"));
	if (input.mission.sourcePolicy.requireContraryEvidence && input.contraryEvidenceLinks.length === 0) issues.push(errorIssue("contrary-evidence", "source policy requires explicit source-to-claim contrary evidence links"));
	const requiredProfiles = input.mission.taskProfile.family === "capstone" ? ["gis-v1", "literature-v1", "quantitative-v1"] : [input.mission.taskProfile.verifierProfile];
	const actualProfiles = input.familyVerifications.map((item) => item.profile).sort();
	const exactProfiles = new Set(actualProfiles).size === actualProfiles.length && JSON.stringify(actualProfiles) === JSON.stringify([...requiredProfiles].sort());
	const knownClaims = new Set(input.claims.map((claim) => claim.id));
	const validFamilyAttestations = exactProfiles && input.familyVerifications.every((item) => item.result.profile === item.profile && item.result.passed && !!item.inputHash && item.evidenceIds.length > 0 && item.evidenceIds.every((id) => evidenceIds.has(id)));
	if (!validFamilyAttestations) issues.push(errorIssue("family-verifier", `family verifier attestations must match exactly: ${requiredProfiles.join(",")}`));
	const validContraryLinks = input.contraryEvidenceLinks.every((link) => evidenceIds.has(link.sourceEvidenceId) && input.evidence.find((item) => item.id === link.sourceEvidenceId)?.kind === "source" && knownClaims.has(link.claimId));
	if (!validContraryLinks) issues.push(errorIssue("contrary-evidence", "contrary evidence links must bind a source Evidence ID to a known Claim ID"));
	const checks = {
		mission: missionIssues.length === 0,
		graph: graphIssues.length === 0,
		requiredStages: missingStages.length === 0,
		criterionCoverage: criteriaCoverage,
		ledger: input.ledgerValid,
		replay: input.replayPassed,
		cleanup: input.cleanupPassed,
		guard: input.guardViolations.length === 0,
		familyVerifiers: validFamilyAttestations,
		sourcePolicy: input.mission.taskProfile.sourceRequirements.every((requirement) => sources.length >= requirement.minimumCount) && (!input.mission.sourcePolicy.requireProvenance || sources.every((source) => !!source.sourceUrl)) && (!input.mission.sourcePolicy.requireLicenseMetadata || sources.every((source) => !!source.license)) && (!input.mission.sourcePolicy.requireRetrievedAt || sources.every((source) => !!source.retrievedAt && !Number.isNaN(Date.parse(source.retrievedAt)))) && (!input.mission.sourcePolicy.requireContraryEvidence || input.contraryEvidenceLinks.length > 0) && validContraryLinks,
		claims: input.claims.every((claim) => validateResearchClaim(claim, input.evidence).length === 0),
		deliverables: input.mission.requiredDeliverables.filter((item) => item.required).every((item) => {
			const actual = deliverables.get(item.id);
			return !!actual && actual.bytes > 0 && /^[a-f0-9]{64}$/i.test(actual.sha256);
		}),
	};
	if (!input.ledgerValid) issues.push(errorIssue("ledger", "research event ledger is invalid"));
	if (!input.replayPassed) issues.push(errorIssue("replay", "verify-only replay failed"));
	if (!input.cleanupPassed) issues.push(errorIssue("cleanup", "isolation cleanup was not verified"));
	return verificationResult("generic-research-v1", issues, checks);
}
