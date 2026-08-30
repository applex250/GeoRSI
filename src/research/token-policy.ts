/** Role-scoped xhigh output caps and token-efficiency telemetry. */
import type { BudgetPolicy } from "./strategy-bundle.js";

export interface DetailedTokenUsage {
	input: number | null;
	output: number | null;
	reasoning: number | null;
	cacheRead: number | null;
	cacheWrite: number | null;
	total: number;
}

export interface RoleTokenOutcome {
	role: string;
	calls: number;
	failedCalls: number;
	usage: DetailedTokenUsage;
	validArtifacts: number;
	supportedClaims: number;
	score: number | null;
}

export function roleOutputCap(policy: BudgetPolicy, role: string): number {
	const value = policy.roleOutputCaps[role];
	if (!Number.isSafeInteger(value) || value! <= 0) throw new Error(`no valid output-token cap for role ${role}`);
	return Math.min(value!, policy.hardRequestMaxTokens);
}

export function escalatedOutputCap(input: {
	policy: BudgetPolicy;
	role: string;
	attemptedEscalations: number;
	stopReason: string | null;
	validArtifactProduced: boolean;
}): number | null {
	if (input.validArtifactProduced || input.stopReason !== "length" || input.attemptedEscalations >= input.policy.maxEscalationsPerCall) return null;
	return Math.min(input.policy.hardRequestMaxTokens, Math.floor(roleOutputCap(input.policy, input.role) * input.policy.escalationFactor));
}

export function tokenEfficiency(outcome: RoleTokenOutcome): {
	tokensPerValidArtifact: number | null;
	tokensPerSupportedClaim: number | null;
	scorePer100kTokens: number | null;
} {
	const total = outcome.usage.total;
	return {
		tokensPerValidArtifact: outcome.validArtifacts > 0 ? total / outcome.validArtifacts : null,
		tokensPerSupportedClaim: outcome.supportedClaims > 0 ? total / outcome.supportedClaims : null,
		scorePer100kTokens: outcome.score != null && total > 0 ? outcome.score * 100_000 / total : null,
	};
}
