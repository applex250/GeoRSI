/**
 * The three doors between a freshly extracted record and the experience store. Pure.
 *
 *  1. verifier door — did the family verifier pass? pass → candidate, partial → probation,
 *     fail → counter-example.
 *  2. replay door — did the package replay (verify-only + compute)? unverified replay keeps
 *     a record on probation; it can never become active until a replay confirms it.
 *  3. human door — high-risk records wait for a person: non-retryable failure classes, the
 *     first record of a family, conclusions drawn from user-uploaded data.
 *
 * Fixture runs (deterministic-demo) are retired on arrival: they are regression material,
 * never routing material.
 */
import type { ExperienceRecord, ExperienceStatus } from "./schema.js";

export interface GatePolicy {
	/** Families that already have at least one stored record (first-of-family is high risk). */
	knownFamilies: ReadonlySet<string>;
	/** Failure classes whose counter-examples need a human before they may influence anything. */
	highRiskFailureClasses?: ReadonlySet<string>;
	/** Records derived from uploaded (user) data wait for a human by default. */
	uploadsRequireHuman?: boolean;
}

export const DEFAULT_HIGH_RISK_FAILURES: ReadonlySet<string> = new Set(["tool-routing", "sandbox", "budget"]);

export function isHighRisk(record: ExperienceRecord, policy: GatePolicy): string[] {
	const reasons: string[] = [];
	const highRisk = policy.highRiskFailureClasses ?? DEFAULT_HIGH_RISK_FAILURES;
	if (record.failure && highRisk.has(record.failure.class)) reasons.push(`non-retryable failure class ${record.failure.class}`);
	if (!policy.knownFamilies.has(record.family)) reasons.push(`first record for family ${record.family}`);
	if ((policy.uploadsRequireHuman ?? true) && record.signature.datasetFingerprint && record.status !== "counter-example") reasons.push("conclusions drawn from user-uploaded data");
	return reasons;
}

export function applyGates(record: ExperienceRecord, policy: GatePolicy): ExperienceRecord {
	const notes: string[] = [...record.lineage.notes];
	let status: ExperienceStatus;
	if (record.origin.runMode === "deterministic-demo") {
		status = "retired";
		notes.push("fixture run (deterministic-demo): retired on arrival, never routed");
	} else if (record.failure) {
		status = "counter-example";
	} else if (record.outcome.verifier === "pass") {
		status = "candidate";
	} else if (record.outcome.verifier === "partial") {
		status = "probation";
		notes.push("verifier door: partial pass keeps the record on probation");
	} else {
		status = "counter-example";
		notes.push(`verifier door: ${record.outcome.verifier} — filed as counter-example`);
	}
	const replay = record.outcome.replayable ? "verified" : status === "counter-example" ? "failed" : "unverified";
	if (replay === "unverified" && status === "candidate") {
		status = "probation";
		notes.push("replay door: package did not replay — probation until a replay confirms it");
	}
	const gated: ExperienceRecord = { ...record, status, gates: { verifier: record.outcome.verifier, replay, human: "not-required" }, lineage: { ...record.lineage, notes } };
	const risk = isHighRisk(gated, policy);
	if (risk.length && status !== "retired") {
		gated.gates.human = "pending";
		gated.lineage.notes = [...notes, `human door: ${risk.join("; ")}`];
	}
	return gated;
}
