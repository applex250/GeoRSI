/** Cross-family research-package verifier. */
import type { EvidenceRef, ResearchClaim, ResearchMission, ResearchWorkGraph } from "../contracts.js";
import { validateResearchClaim } from "../decision-policy.js";
import { validateResearchMission } from "../contracts.js";
import { validateWorkGraph } from "../work-graph.js";
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
}

export function verifyGenericResearch(input: GenericResearchVerificationInput): ScientificVerificationResult {
	const issues = [];
	const missionIssues = validateResearchMission(input.mission);
	for (const issue of missionIssues) issues.push(errorIssue("mission-contract", issue));
	const graphIssues = validateWorkGraph(input.graph);
	for (const issue of graphIssues) issues.push(errorIssue("work-graph", issue));
	const requiredStages = new Set(input.mission.taskProfile.requiredStages);
	const completedStages = new Set(input.graph.nodes.filter((node) => node.state === "completed").map((node) => node.kind));
	const missingStages = [...requiredStages].filter((stage) => !completedStages.has(stage));
	for (const stage of missingStages) issues.push(errorIssue("missing-stage", `required research stage not completed: ${stage}`));
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
	const checks = {
		mission: missionIssues.length === 0,
		graph: graphIssues.length === 0,
		requiredStages: missingStages.length === 0,
		ledger: input.ledgerValid,
		replay: input.replayPassed,
		cleanup: input.cleanupPassed,
		guard: input.guardViolations.length === 0,
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
