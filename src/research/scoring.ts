/** Three-layer competition score with non-compensable runtime gates. */
export interface ResearchScoreInput {
	runtime: {
		unitTestsPassed: boolean;
		runtimeAttestationPassed: boolean;
		traceComplete: boolean;
		manifestValid: boolean;
		verifyReplayPassed: boolean;
		computeReplayPassed: boolean;
		guardViolations: number;
		cleanupPassed: boolean;
		validResultCount: number;
	};
	science: {
		taskOutcome: number;
		methodValidity: number;
		claimEvidenceQuality: number;
		reproducibility: number;
		scientificValue: number;
	};
	communication: {
		report: number;
		presentation: number;
		defense: number;
	};
	totalTokens: number;
	wallSeconds: number;
	perFamily: Record<string, number | null>;
}

export interface ResearchCompetitionScore {
	eligible: boolean;
	overall: number | null;
	runtimePassed: boolean;
	scienceScore: number;
	communicationScore: number;
	worstFamily: number | null;
	scorePer100kTokens: number | null;
	reasons: string[];
	components: Record<string, number>;
}

function bounded(value: number): number {
	return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function scoreResearchCompetition(input: ResearchScoreInput): ResearchCompetitionScore {
	const reasons: string[] = [];
	const runtimeChecks: [string, boolean][] = [
		["unit tests", input.runtime.unitTestsPassed],
		["runtime attestation", input.runtime.runtimeAttestationPassed],
		["trace completeness", input.runtime.traceComplete],
		["manifest validity", input.runtime.manifestValid],
		["verify replay", input.runtime.verifyReplayPassed],
		["compute replay", input.runtime.computeReplayPassed],
		["cleanup", input.runtime.cleanupPassed],
		["at least one valid result", input.runtime.validResultCount > 0],
		["zero guard violations", input.runtime.guardViolations === 0],
	];
	for (const [label, passed] of runtimeChecks) if (!passed) reasons.push(`runtime gate failed: ${label}`);
	const runtimePassed = reasons.length === 0;
	const communicationScore = (bounded(input.communication.report) + bounded(input.communication.presentation) + bounded(input.communication.defense)) / 3;
	const scienceScore = bounded(input.science.taskOutcome) * 0.3 + bounded(input.science.methodValidity) * 0.2 + bounded(input.science.claimEvidenceQuality) * 0.15 + bounded(input.science.reproducibility) * 0.15 + bounded(input.science.scientificValue) * 0.1 + communicationScore * 0.1;
	const familyScores = Object.values(input.perFamily).filter((value): value is number => value != null && Number.isFinite(value));
	const worstFamily = familyScores.length ? Math.min(...familyScores) : null;
	const overall = runtimePassed ? scienceScore : null;
	return {
		eligible: runtimePassed,
		overall,
		runtimePassed,
		scienceScore,
		communicationScore,
		worstFamily,
		scorePer100kTokens: overall != null && input.totalTokens > 0 ? overall * 100_000 / input.totalTokens : null,
		reasons,
		components: {
			taskOutcome: bounded(input.science.taskOutcome),
			methodValidity: bounded(input.science.methodValidity),
			claimEvidenceQuality: bounded(input.science.claimEvidenceQuality),
			reproducibility: bounded(input.science.reproducibility),
			scientificValue: bounded(input.science.scientificValue),
			communication: communicationScore,
		},
	};
}
