/** Deterministic quality gate for quantitative geoscience analyses. */
import { errorIssue, verificationResult, warningIssue, type ScientificVerificationResult, type VerificationIssue } from "./base.js";

export interface QuantitativeVerificationInput {
	rowCount: number;
	missingCount: number;
	duplicateCount: number;
	columnsAudited: string[];
	units: Record<string, string>;
	estimand: string;
	method: string;
	referenceCalibration?: { performed: boolean; expected?: number; actual?: number; tolerance?: number };
	randomSeed?: number;
	stochasticMethod: boolean;
	finiteOutputs: boolean;
	uncertainty?: { method: string; lower: number; upper: number };
	sensitivityRuns: number;
	independentCheck?: { method: string; relativeDifference: number; tolerance: number };
	targetWithinObservedRange?: boolean;
}

export function verifyQuantitativeResearch(input: QuantitativeVerificationInput): ScientificVerificationResult {
	const issues: VerificationIssue[] = [];
	if (!Number.isSafeInteger(input.rowCount) || input.rowCount <= 1) issues.push(errorIssue("row-count", "analysis requires at least two audited rows"));
	if (!Number.isSafeInteger(input.missingCount) || input.missingCount < 0) issues.push(errorIssue("missing-count", "missing count is invalid"));
	if (!Number.isSafeInteger(input.duplicateCount) || input.duplicateCount < 0) issues.push(errorIssue("duplicate-count", "duplicate count is invalid"));
	if (input.columnsAudited.length === 0) issues.push(errorIssue("columns", "no columns were audited"));
	if (!input.estimand.trim()) issues.push(errorIssue("estimand", "estimand is missing"));
	if (!input.method.trim()) issues.push(errorIssue("method", "analysis method is missing"));
	if (Object.keys(input.units).length === 0 || Object.values(input.units).some((unit) => !unit.trim())) issues.push(errorIssue("units", "all measured quantities need explicit units"));
	if (!input.finiteOutputs) issues.push(errorIssue("finite-output", "analysis produced NaN or infinite output"));
	if (input.stochasticMethod && !Number.isSafeInteger(input.randomSeed)) issues.push(errorIssue("random-seed", "stochastic analysis needs a recorded integer seed"));
	if (!input.uncertainty || !Number.isFinite(input.uncertainty.lower) || !Number.isFinite(input.uncertainty.upper) || input.uncertainty.lower > input.uncertainty.upper) issues.push(errorIssue("uncertainty", "valid uncertainty bounds are required"));
	if (input.sensitivityRuns < 2) issues.push(errorIssue("sensitivity", "at least two sensitivity settings are required"));
	if (!input.independentCheck) issues.push(errorIssue("independent-check", "an independent formula or estimator check is required"));
	else if (!Number.isFinite(input.independentCheck.relativeDifference) || input.independentCheck.relativeDifference > input.independentCheck.tolerance) issues.push(errorIssue("independent-check", "independent result exceeds the declared tolerance"));
	if (input.targetWithinObservedRange === false) issues.push(warningIssue("extrapolation", "target lies outside the observed range"));
	if (input.referenceCalibration && input.referenceCalibration.performed) {
		const { expected, actual, tolerance = 0 } = input.referenceCalibration;
		if (!Number.isFinite(expected) || !Number.isFinite(actual) || Math.abs(actual! - expected!) > tolerance) issues.push(errorIssue("reference-calibration", "public reference calibration did not meet tolerance"));
	}
	const checks = {
		dataAudit: input.rowCount > 1 && input.columnsAudited.length > 0 && input.missingCount >= 0 && input.duplicateCount >= 0,
		units: Object.keys(input.units).length > 0 && Object.values(input.units).every(Boolean),
		estimandAndMethod: !!input.estimand.trim() && !!input.method.trim(),
		finiteOutputs: input.finiteOutputs,
		randomSeed: !input.stochasticMethod || Number.isSafeInteger(input.randomSeed),
		uncertainty: !!input.uncertainty && input.uncertainty.lower <= input.uncertainty.upper,
		sensitivity: input.sensitivityRuns >= 2,
		independentCheck: !!input.independentCheck && input.independentCheck.relativeDifference <= input.independentCheck.tolerance,
		referenceCalibration: !input.referenceCalibration?.performed || !issues.some((issue) => issue.code === "reference-calibration"),
	};
	return verificationResult("quantitative-v1", issues, checks);
}
