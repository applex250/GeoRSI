/** Stable failure classes used by recovery policy and evolution telemetry. */
export type ResearchFailureClass =
	| "no-submission"
	| "invalid-artifact"
	| "data-schema"
	| "unit-mismatch"
	| "crs"
	| "network"
	| "citation"
	| "method-selection"
	| "numerical-instability"
	| "timeout"
	| "tool-routing"
	| "verification"
	| "unsupported-claim"
	| "sandbox"
	| "budget"
	| "unknown";

export interface ResearchFailure {
	class: ResearchFailureClass;
	code: string;
	message: string;
	retryable: boolean;
	affectedComponent: "planner" | "recipe" | "verifier" | "context" | "recovery" | "budget" | "communication";
}

const RULES: { class: ResearchFailureClass; pattern: RegExp; retryable: boolean; component: ResearchFailure["affectedComponent"] }[] = [
	{ class: "no-submission", pattern: /no submission|not submitted|did not call submit/i, retryable: true, component: "recipe" },
	{ class: "invalid-artifact", pattern: /invalid artifact|artifact.*missing|non-degenerate|output file/i, retryable: true, component: "verifier" },
	{ class: "data-schema", pattern: /schema|column|parse|malformed|missing field/i, retryable: true, component: "recipe" },
	{ class: "unit-mismatch", pattern: /unit|dimension|conversion/i, retryable: true, component: "verifier" },
	{ class: "crs", pattern: /\bcrs\b|projection|axis order|geometry/i, retryable: true, component: "verifier" },
	{ class: "network", pattern: /network|dns|http|connection|socket|429|502|503|504|upstream|temporarily unavailable|empty assistant response|receipt.*is not successful|is not successful/i, retryable: true, component: "recovery" },
	{ class: "citation", pattern: /citation|doi|reference|source url/i, retryable: true, component: "verifier" },
	{ class: "method-selection", pattern: /method|estimator|model selection/i, retryable: true, component: "planner" },
	{ class: "numerical-instability", pattern: /nan|infinity|singular|overflow|underflow|converge/i, retryable: true, component: "recipe" },
	{ class: "timeout", pattern: /timeout|timed out|wall clock|stalled/i, retryable: true, component: "budget" },
	{ class: "tool-routing", pattern: /tool.*not found|unknown tool|tool routing|unsupported capability/i, retryable: false, component: "planner" },
	{ class: "verification", pattern: /verification|verifier|acceptance criterion/i, retryable: true, component: "verifier" },
	{ class: "unsupported-claim", pattern: /unsupported claim|claim.*evidence/i, retryable: true, component: "communication" },
	{ class: "sandbox", pattern: /sandbox|sbie|isolation|protected path|cleanup|lease/i, retryable: false, component: "recovery" },
	{ class: "budget", pattern: /token budget|cost cap|budget exhausted/i, retryable: false, component: "budget" },
];

export function classifyResearchFailure(error: unknown, code = "runtime-error"): ResearchFailure {
	const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);
	const rule = RULES.find((candidate) => candidate.pattern.test(message));
	return {
		class: rule?.class ?? "unknown",
		code,
		message,
		retryable: rule?.retryable ?? false,
		affectedComponent: rule?.component ?? "recovery",
	};
}
