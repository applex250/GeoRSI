/**
 * Human approval: the operator evidence source the classic track declared but never wrote.
 * Pure — the store persists the approval and the returned record.
 *
 *  accept  → human door approved; a candidate whose replay is verified becomes active,
 *            an unverified one stays on probation (a person cannot vouch for replay).
 *  modify  → as accept, after applying the bounded patch (tier / stages).
 *  reject  → human door rejected; the record is retired (kept for audit, never routed).
 */
import type { ApprovalRecord, ExperienceRecord } from "./schema.js";

export function applyApproval(record: ExperienceRecord, approval: ApprovalRecord): ExperienceRecord {
	if (approval.recordId !== record.id) throw new Error(`approval ${approval.id} targets ${approval.recordId}, not ${record.id}`);
	const notes = [...record.lineage.notes, `${approval.at} ${approval.actor}: ${approval.decision}${approval.note ? ` — ${approval.note.slice(0, 300)}` : ""}`];
	const approvals = [...record.lineage.approvals, approval.id];
	if (approval.decision === "reject") {
		return { ...record, status: "retired", gates: { ...record.gates, human: "rejected" }, lineage: { approvals, notes } };
	}
	let next: ExperienceRecord = { ...record, gates: { ...record.gates, human: "approved" }, lineage: { approvals, notes } };
	if (approval.decision === "modify" && approval.patch) {
		next = {
			...next,
			tier: approval.patch.tier !== undefined ? approval.patch.tier : next.tier,
			route: approval.patch.stages ? { ...next.route, stages: [...approval.patch.stages] } : next.route,
		};
	}
	if (next.status === "candidate" || next.status === "probation") {
		next.status = next.gates.replay === "verified" && next.gates.verifier === "pass" ? "active" : "probation";
	}
	return next;
}

export function approvalId(recordId: string, at: string): string {
	return `apv_${recordId.replace(/^xp_/, "")}_${at.replace(/[^0-9]/g, "").slice(0, 14)}`;
}
