/**
 * Experience records: the structured memory the research engine leaves behind after a run.
 *
 * One record per run (what route was taken, which tools, how it verified, what it cost) plus
 * one counter-example per failed node attempt. Records are STORED before they are ever used:
 * routing by experience is a later stage and is deliberately absent here. Every field is
 * derived from package artefacts (plan, executor snapshot, attestation, score, replay,
 * manifest) — nothing here is model-authored prose.
 *
 * Status vocabulary follows the strategy-promotion lifecycle (candidate → probation → active
 * → retired) plus `counter-example` for what must never be routed to.
 */
import type { ResearchFailureClass } from "../failure-taxonomy.js";
import type { ResearchTaskFamily } from "../contracts.js";

export type ExperienceStatus = "candidate" | "probation" | "active" | "retired" | "counter-example";
export type GateVerdict = "pass" | "partial" | "fail" | "unknown";
export type ReplayGate = "verified" | "unverified" | "failed";
export type HumanGate = "not-required" | "pending" | "approved" | "rejected";

export interface TaskSignature {
	/** Exact key: family | stages | capabilities | verifier profile | dataset fingerprint. */
	exact: string;
	family: ResearchTaskFamily;
	stages: string[];
	capabilities: string[];
	verifierProfile: string;
	datasetFingerprint: string | null;
	/** Lexical key for similarity lookups: bounded, deduplicated question tokens. */
	keywords: string[];
}

export interface RouteNode {
	id: string;
	kind: string;
	dependsOn: string[];
	state: string;
	attempts: number;
	toolIds: string[];
	modelCalls: number;
	totalTokens: number;
	failureClass?: string;
}

export interface ExperienceOutcome {
	verifier: GateVerdict;
	replayable: boolean;
	eligible: boolean;
	scienceScore: number | null;
	components: Record<string, number>;
	totalTokens: number;
	wallSeconds: number;
	modelCalls: number;
}

export interface ExperienceFailure {
	class: ResearchFailureClass | string;
	affectedComponent: string;
	nodeId: string;
	nodeKind: string;
	message: string;
	hypothesis: string;
	falsifier: string;
}

export interface ExperienceRecord {
	version: 1;
	id: string;
	status: ExperienceStatus;
	createdAt: string;
	signature: TaskSignature;
	family: ResearchTaskFamily;
	/** Workspace tier when the run came from the interactive tier; null for competition runs. */
	tier: string | null;
	route: { stages: string[]; nodes: RouteNode[]; rounds: number };
	outcome: ExperienceOutcome;
	failure?: ExperienceFailure;
	/** Durable commitments only: hashes survive the temp CAS being cleared. */
	evidence: { manifestHash: string | null; ledgerRootHash: string | null; evidenceHashes: string[]; claimIds: string[] };
	origin: { runId: string; runMode: string; gitCommit: string | null; strategyFingerprint: string | null; modelPolicyFingerprint: string | null; question: string | null };
	gates: { verifier: GateVerdict; replay: ReplayGate; human: HumanGate };
	lineage: { approvals: string[]; notes: string[] };
}

export interface ApprovalRecord {
	id: string;
	recordId: string;
	decision: "accept" | "modify" | "reject";
	note: string;
	actor: string;
	at: string;
	/** `modify` may correct the route or the tier; nothing else is editable by hand. */
	patch?: { tier?: string | null; stages?: string[] };
}

export function experienceRecordId(runId: string, kind: "run" | "counter", nodeId?: string, attempt?: number): string {
	const suffix = kind === "run" ? "run" : `counter-${(nodeId ?? "node").replace(/[^a-z0-9-]/gi, "_")}-${attempt ?? 0}`;
	return `xp_${runId}_${suffix}`;
}

const STATUSES: readonly ExperienceStatus[] = ["candidate", "probation", "active", "retired", "counter-example"];
const VERDICTS: readonly GateVerdict[] = ["pass", "partial", "fail", "unknown"];

export function validateExperienceRecord(record: ExperienceRecord): string[] {
	const issues: string[] = [];
	if (record.version !== 1) issues.push("version must be 1");
	if (!record.id.startsWith("xp_")) issues.push("id must start with xp_");
	if (!STATUSES.includes(record.status)) issues.push(`unknown status: ${record.status}`);
	if (!/^[a-f0-9]{24}$/.test(record.signature.exact)) issues.push("signature.exact must be a 24-hex digest");
	if (record.route.stages.length === 0) issues.push("route needs at least one stage");
	if (record.route.rounds < 1) issues.push("route.rounds must be >= 1");
	if (!VERDICTS.includes(record.outcome.verifier)) issues.push("outcome.verifier is invalid");
	if (record.outcome.scienceScore !== null && (record.outcome.scienceScore < 0 || record.outcome.scienceScore > 1)) issues.push("scienceScore must be within 0..1");
	if (record.status === "counter-example" && !record.failure) issues.push("counter-example requires a failure");
	if (record.evidence.evidenceHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) issues.push("evidence hashes must be sha256 hex");
	if (!record.origin.runId) issues.push("origin.runId is required");
	return issues;
}
