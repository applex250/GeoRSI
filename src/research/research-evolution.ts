/** Application service for one typed StrategyBundle generation. */
import { applyStrategyEdit, type StrategyEdit } from "./strategy-edits.js";
import { strategyBundleFingerprint, type StrategyBundle } from "./strategy-bundle.js";
import { compareStrategyOutcomes, decideStrategyPromotion, type StrategyOutcome, type StrategyPromotionDecision } from "./promotion.js";

export interface StrategyEvaluationPort {
	evaluate(bundle: StrategyBundle, role: "baseline" | "candidate", candidateIndex: number): Promise<StrategyOutcome[]>;
}

export interface StrategyCandidateResult {
	bundle: StrategyBundle;
	outcomes: StrategyOutcome[];
	promotion: StrategyPromotionDecision;
}

export interface StrategyGenerationResult {
	champion: StrategyBundle;
	baselineOutcomes: StrategyOutcome[];
	candidates: StrategyCandidateResult[];
	acceptedCandidate: number | null;
}

function aggregate(outcomes: readonly StrategyOutcome[]): StrategyOutcome {
	if (outcomes.length === 0) throw new Error("strategy evaluation produced no outcomes");
	const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
	const nullable = (values: (number | null)[]): number | null => {
		const valid = values.filter((value): value is number => value != null);
		return valid.length ? mean(valid) : null;
	};
	const first = outcomes[0]!;
	return {
		...first,
		runId: outcomes.map((outcome) => outcome.runId).join("+"),
		repetition: 0,
		validRate: mean(outcomes.map((outcome) => outcome.validRate)),
		score: nullable(outcomes.map((outcome) => outcome.score)),
		worstFamilyScore: nullable(outcomes.map((outcome) => outcome.worstFamilyScore)),
		totalTokens: Math.round(mean(outcomes.map((outcome) => outcome.totalTokens))),
		replayPassRate: mean(outcomes.map((outcome) => outcome.replayPassRate)),
		guardViolations: outcomes.reduce((sum, outcome) => sum + outcome.guardViolations, 0),
		cleanupPassed: outcomes.every((outcome) => outcome.cleanupPassed),
		otherModelCalls: outcomes.reduce((sum, outcome) => sum + outcome.otherModelCalls, 0),
	};
}

export async function runStrategyGeneration(input: {
	champion: StrategyBundle;
	candidateEdits: readonly (readonly StrategyEdit[])[];
	evaluator: StrategyEvaluationPort;
	originRun?: string;
}): Promise<StrategyGenerationResult> {
	const baselineOutcomes = await input.evaluator.evaluate(input.champion, "baseline", -1);
	const seen = new Set<string>([strategyBundleFingerprint(input.champion)]);
	const candidates: StrategyCandidateResult[] = [];
	for (let index = 0; index < input.candidateEdits.length; index++) {
		let bundle: StrategyBundle;
		try { bundle = applyStrategyEdit(input.champion, input.candidateEdits[index]!, input.originRun); }
		catch { continue; }
		const fingerprint = strategyBundleFingerprint(bundle);
		if (seen.has(fingerprint)) continue;
		seen.add(fingerprint);
		const outcomes = await input.evaluator.evaluate(bundle, "candidate", index);
		candidates.push({ bundle, outcomes, promotion: decideStrategyPromotion(baselineOutcomes, outcomes) });
	}
	const eligible = candidates.map((candidate, index) => ({ candidate, index, aggregate: aggregate(candidate.outcomes) })).filter((item) => item.candidate.promotion.promote);
	eligible.sort((left, right) => compareStrategyOutcomes(left.aggregate, right.aggregate));
	const winner = eligible[0];
	return { champion: winner?.candidate.bundle ?? input.champion, baselineOutcomes, candidates, acceptedCandidate: winner?.index ?? null };
}
