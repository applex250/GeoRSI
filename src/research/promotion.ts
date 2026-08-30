/** Honest paired A/B and score/token Pareto policy for StrategyBundle promotion. */
export interface StrategyOutcome {
	runId: string;
	manifestFingerprint: string;
	model: "gpt-5.6-luna";
	thinkingLevel: "xhigh";
	repetition: number;
	validRate: number;
	score: number | null;
	worstFamilyScore: number | null;
	totalTokens: number;
	replayPassRate: number;
	guardViolations: number;
	cleanupPassed: boolean;
	otherModelCalls: number;
}

export type StrategyStatus = "candidate" | "probation" | "active" | "retired";

export interface StrategyPromotionDecision {
	status: StrategyStatus;
	promote: boolean;
	pairedScoreDelta: number | null;
	validRateDelta: number;
	worstFamilyDelta: number | null;
	tokenRatio: number | null;
	scorePer100kTokenRatio: number | null;
	reasons: string[];
}

export function strategyOutcomeEligible(outcome: StrategyOutcome): boolean {
	return outcome.validRate > 0 && outcome.score != null && outcome.replayPassRate === 1 && outcome.guardViolations === 0 && outcome.cleanupPassed && outcome.otherModelCalls === 0 && outcome.model === "gpt-5.6-luna" && outcome.thinkingLevel === "xhigh";
}

function stableNumberList(values: readonly number[]): string {
	return values.join(",");
}

function mean(values: number[]): number {
	return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function nullableMean(values: (number | null)[]): number | null {
	const valid = values.filter((value): value is number => value != null);
	return valid.length ? mean(valid) : null;
}

function scorePer100k(score: number, tokens: number): number {
	return tokens > 0 ? score * 100_000 / tokens : 0;
}

export function decideStrategyPromotion(baseline: readonly StrategyOutcome[], candidate: readonly StrategyOutcome[]): StrategyPromotionDecision {
	const reasons: string[] = [];
	if (baseline.length < 2 || candidate.length < 2) reasons.push("paired promotion requires at least two repetitions per arm");
	if (baseline.length !== candidate.length) reasons.push("paired promotion requires equal arm sizes");
	const baselineKeys = baseline.map((outcome) => outcome.repetition);
	const candidateKeys = candidate.map((outcome) => outcome.repetition);
	if (new Set(baselineKeys).size !== baselineKeys.length || new Set(candidateKeys).size !== candidateKeys.length) reasons.push("repetition keys must be unique within each arm");
	const sortedBaselineKeys = [...baselineKeys].sort((left, right) => left - right);
	const sortedCandidateKeys = [...candidateKeys].sort((left, right) => left - right);
	if (stableNumberList(sortedBaselineKeys) !== stableNumberList(sortedCandidateKeys)) reasons.push("baseline and candidate repetition keys must match exactly");
	const manifests = new Set([...baseline, ...candidate].map((outcome) => outcome.manifestFingerprint));
	if (manifests.size !== 1) reasons.push("all paired runs must use one fixed manifest");
	if ([...baseline, ...candidate].some((outcome) => outcome.model !== "gpt-5.6-luna" || outcome.thinkingLevel !== "xhigh" || outcome.otherModelCalls !== 0)) reasons.push("every model call must be Luna xhigh with no other model receipts");
	if (baseline.some((outcome) => !strategyOutcomeEligible(outcome))) reasons.push("every baseline repetition must pass score/replay/guard/cleanup eligibility");
	if (candidate.some((outcome) => !strategyOutcomeEligible(outcome))) reasons.push("every candidate repetition must pass score/replay/guard/cleanup eligibility");
	const baselineByRepetition = new Map(baseline.map((outcome) => [outcome.repetition, outcome]));
	const candidateByRepetition = new Map(candidate.map((outcome) => [outcome.repetition, outcome]));
	const matchedKeys = sortedBaselineKeys.filter((key) => candidateByRepetition.has(key));
	const scoreDeltas = matchedKeys.map((key) => (candidateByRepetition.get(key)!.score ?? 0) - (baselineByRepetition.get(key)!.score ?? 0));
	const pairs = scoreDeltas.length;
	const pairedScoreDelta = pairs ? mean(scoreDeltas) : null;
	const validRateDelta = mean(candidate.map((outcome) => outcome.validRate)) - mean(baseline.map((outcome) => outcome.validRate));
	const baselineWorst = nullableMean(baseline.map((outcome) => outcome.worstFamilyScore));
	const candidateWorst = nullableMean(candidate.map((outcome) => outcome.worstFamilyScore));
	const worstFamilyDelta = baselineWorst != null && candidateWorst != null ? candidateWorst - baselineWorst : null;
	const baselineTokens = mean(baseline.map((outcome) => outcome.totalTokens));
	const candidateTokens = mean(candidate.map((outcome) => outcome.totalTokens));
	const tokenRatio = baselineTokens > 0 ? candidateTokens / baselineTokens : null;
	const baselineScore = nullableMean(baseline.map((outcome) => outcome.score));
	const candidateScore = nullableMean(candidate.map((outcome) => outcome.score));
	const baselineEfficiency = baselineScore != null ? scorePer100k(baselineScore, baselineTokens) : 0;
	const candidateEfficiency = candidateScore != null ? scorePer100k(candidateScore, candidateTokens) : 0;
	const scorePer100kTokenRatio = baselineEfficiency > 0 ? candidateEfficiency / baselineEfficiency : null;
	if (validRateDelta < 0) reasons.push("valid task rate regressed");
	if (pairedScoreDelta == null || pairedScoreDelta <= 0.01) reasons.push("paired score gain must exceed 0.01");
	if (worstFamilyDelta != null && worstFamilyDelta < -0.05) reasons.push("worst-family regression exceeds 0.05");
	const promote = reasons.length === 0;
	return { status: promote ? "active" : "probation", promote, pairedScoreDelta, validRateDelta, worstFamilyDelta, tokenRatio, scorePer100kTokenRatio, reasons };
}

/** Quality-first ordering: eligibility, valid rate, score, worst family, then
 * token efficiency only within a 0.01 score band. */
export function compareStrategyOutcomes(left: StrategyOutcome, right: StrategyOutcome): number {
	const leftEligible = strategyOutcomeEligible(left);
	const rightEligible = strategyOutcomeEligible(right);
	if (leftEligible !== rightEligible) return leftEligible ? -1 : 1;
	if (left.validRate !== right.validRate) return right.validRate - left.validRate;
	const leftScore = left.score ?? -1;
	const rightScore = right.score ?? -1;
	if (Math.abs(leftScore - rightScore) > 0.01) return rightScore - leftScore;
	const leftWorst = left.worstFamilyScore ?? -1;
	const rightWorst = right.worstFamilyScore ?? -1;
	if (leftWorst !== rightWorst) return rightWorst - leftWorst;
	return left.totalTokens - right.totalTokens;
}
