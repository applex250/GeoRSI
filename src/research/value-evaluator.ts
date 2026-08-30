/** Evidence-gated scientific value and innovation rubric. */
export interface ScientificValueDimension {
	score: 0 | 1 | 2 | 3 | 4;
	rationale: string;
	evidenceIds: string[];
}

export interface ScientificValueCard {
	significance: ScientificValueDimension;
	novelty: ScientificValueDimension;
	falsifiability: ScientificValueDimension;
	dataFeasibility: ScientificValueDimension;
	methodologicalValue: ScientificValueDimension;
	potentialImpact: ScientificValueDimension;
	limitations: string[];
	recommendation: "proceed" | "revise" | "reject";
}

export interface ScientificValueEvaluation {
	passed: boolean;
	score: number;
	issues: string[];
	dimensionScores: Record<string, number>;
}

export function evaluateScientificValue(card: ScientificValueCard, knownEvidenceIds: readonly string[]): ScientificValueEvaluation {
	const evidence = new Set(knownEvidenceIds);
	const dimensions = { significance: card.significance, novelty: card.novelty, falsifiability: card.falsifiability, dataFeasibility: card.dataFeasibility, methodologicalValue: card.methodologicalValue, potentialImpact: card.potentialImpact };
	const issues: string[] = [];
	for (const [name, dimension] of Object.entries(dimensions)) {
		if (!Number.isInteger(dimension.score) || dimension.score < 0 || dimension.score > 4) issues.push(`${name} score must be 0..4`);
		if (!dimension.rationale.trim()) issues.push(`${name} rationale is required`);
		if (dimension.score > 0 && dimension.evidenceIds.length === 0) issues.push(`${name} score requires evidence`);
		for (const id of dimension.evidenceIds) if (!evidence.has(id)) issues.push(`${name} references unknown evidence ${id}`);
	}
	if (card.limitations.length === 0) issues.push("at least one limitation is required");
	const dimensionScores = Object.fromEntries(Object.entries(dimensions).map(([name, dimension]) => [name, dimension.score]));
	const score = Object.values(dimensions).reduce((sum, dimension) => sum + dimension.score, 0) / (Object.keys(dimensions).length * 4);
	const mandatoryFloor = card.falsifiability.score >= 2 && card.dataFeasibility.score >= 2;
	if (!mandatoryFloor && card.recommendation === "proceed") issues.push("proceed requires falsifiability and data feasibility scores >= 2");
	return { passed: issues.length === 0 && card.recommendation !== "reject", score, issues, dimensionScores };
}
