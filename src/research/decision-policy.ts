/** Validation rules for explicit, auditable scientific decisions. */
import type { DecisionRecord, EvidenceRef, ResearchClaim } from "./contracts.js";

export function validateDecisionRecord(decision: DecisionRecord, evidence: readonly EvidenceRef[]): string[] {
	const issues: string[] = [];
	if (!decision.id.trim()) issues.push("decision id is required");
	if (!decision.nodeId.trim()) issues.push("decision nodeId is required");
	if (!decision.question.trim()) issues.push("decision question is required");
	if (decision.alternatives.length < 2) issues.push("at least two alternatives are required");
	if (!decision.selected.trim() || !decision.alternatives.includes(decision.selected)) issues.push("selected decision must be one of the alternatives");
	if (decision.evidenceIds.length === 0) issues.push("decision requires evidence");
	const known = new Set(evidence.map((item) => item.id));
	for (const id of decision.evidenceIds) if (!known.has(id)) issues.push(`decision references unknown evidence ${id}`);
	if (!decision.expectedObservation.trim()) issues.push("expected observation is required");
	if (!decision.falsifier.trim()) issues.push("falsifier is required");
	if (!decision.uncertainty.trim()) issues.push("uncertainty statement is required");
	return issues;
}

export function validateResearchClaim(claim: ResearchClaim, evidence: readonly EvidenceRef[]): string[] {
	const issues: string[] = [];
	if (!claim.id.trim()) issues.push("claim id is required");
	if (!claim.text.trim()) issues.push("claim text is required");
	const known = new Set(evidence.map((item) => item.id));
	for (const id of claim.evidenceIds) if (!known.has(id)) issues.push(`claim references unknown evidence ${id}`);
	if (claim.status === "supported" && claim.evidenceIds.length === 0) issues.push("supported claim requires evidence");
	if (claim.status === "supported" && !claim.uncertainty.trim()) issues.push("supported claim requires uncertainty");
	if ((claim.status === "contradicted" || claim.status === "retracted") && claim.evidenceIds.length === 0) issues.push(`${claim.status} claim requires contrary evidence`);
	return issues;
}

export function unsupportedClaimRate(claims: readonly ResearchClaim[], evidence: readonly EvidenceRef[]): number {
	if (claims.length === 0) return 0;
	return claims.filter((claim) => validateResearchClaim(claim, evidence).length > 0).length / claims.length;
}
