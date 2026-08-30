/** Shared deterministic verifier result contracts. */
export type VerificationSeverity = "error" | "warning";

export interface VerificationIssue {
	code: string;
	severity: VerificationSeverity;
	message: string;
	field?: string;
}

export interface ScientificVerificationResult {
	profile: string;
	version: 1;
	passed: boolean;
	score: number;
	issues: VerificationIssue[];
	checks: Record<string, boolean>;
}

export function verificationResult(profile: string, issues: VerificationIssue[], checks: Record<string, boolean>): ScientificVerificationResult {
	const errors = issues.filter((issue) => issue.severity === "error").length;
	const warnings = issues.filter((issue) => issue.severity === "warning").length;
	const denominator = Math.max(1, Object.keys(checks).length);
	const passedChecks = Object.values(checks).filter(Boolean).length;
	const checkScore = passedChecks / denominator;
	const score = Math.max(0, Math.min(1, checkScore - errors * 0.1 - warnings * 0.02));
	return { profile, version: 1, passed: errors === 0 && Object.values(checks).every(Boolean), score, issues, checks };
}

export function errorIssue(code: string, message: string, field?: string): VerificationIssue {
	return { code, severity: "error", message, field };
}

export function warningIssue(code: string, message: string, field?: string): VerificationIssue {
	return { code, severity: "warning", message, field };
}
