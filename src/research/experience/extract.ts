/**
 * Run directory → experience records. Reads only sealed package artefacts and the ledger;
 * never throws on a missing or malformed file — the gap is reported in `issues` and the
 * record carries what could be established (the honest-zeros discipline of benchmark.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ResearchMission, ResearchWorkGraph } from "../contracts.js";
import { readResearchLedger } from "../event-ledger.js";
import { failureHypothesis } from "../experience-miner.js";
import type { ResearchFailureClass } from "../failure-taxonomy.js";
import { taskSignature } from "./signature.js";
import { experienceRecordId, type ExperienceRecord, type GateVerdict, type RouteNode } from "./schema.js";

export interface ExtractionResult {
	run: ExperienceRecord | null;
	counterExamples: ExperienceRecord[];
	issues: string[];
}

function readJson<T>(path: string, issues: string[], label: string): T | null {
	if (!existsSync(path)) { issues.push(`${label} missing`); return null; }
	try { return JSON.parse(readFileSync(path, "utf8")) as T; }
	catch (error) { issues.push(`${label} unreadable: ${error instanceof Error ? error.message : String(error)}`); return null; }
}

interface AttestationLike { runMode?: string; familyVerifications?: { profile: string; result?: { passed?: boolean } }[]; totalTokens?: number; wallSeconds?: number; modelCalls?: { nodeId?: string; totalTokens?: number }[] }
interface ScoreLike { eligible?: boolean; scienceScore?: number; components?: Record<string, number> }
interface ReplayLike { passed?: boolean; computeReplay?: { passed?: boolean } }
interface ManifestLike { manifestHash?: string; eventLedgerRootHash?: string; evidence?: { sha256?: string }[]; claimIds?: string[] }
interface EnvironmentLike { gitCommit?: string | null; strategyFingerprint?: string; evaluatorMetrics?: Record<string, string> }
interface ExecutorStateLike { executor?: { modelReceipts?: { nodeId?: string; totalTokens?: number }[]; toolReceipts?: { nodeId?: string; toolId?: string }[] } }

export function extractExperience(runDir: string, now: () => Date = () => new Date()): ExtractionResult {
	const issues: string[] = [];
	const runId = basename(runDir);
	let mission = readJson<ResearchMission>(join(runDir, "mission.json"), [], "mission.json");
	let tier: string | null = null;
	const synthesized = existsSync(join(runDir, "mission-synthesized.json")) ? readJson<{ mission?: ResearchMission; tier?: string }>(join(runDir, "mission-synthesized.json"), issues, "mission-synthesized.json") : null;
	if (synthesized?.tier) tier = synthesized.tier;
	if (!mission && synthesized?.mission) mission = synthesized.mission;
	if (!mission) { issues.push("mission.json missing"); return { run: null, counterExamples: [], issues }; }
	const plan = readJson<ResearchWorkGraph>(join(runDir, "plan.json"), issues, "plan.json");
	if (!plan) return { run: null, counterExamples: [], issues };
	const attestation = readJson<AttestationLike>(join(runDir, "runtime-attestation.json"), issues, "runtime-attestation.json");
	const score = readJson<ScoreLike>(join(runDir, "research-score.json"), issues, "research-score.json");
	const replay = readJson<ReplayLike>(join(runDir, "replay.json"), issues, "replay.json");
	const manifest = readJson<ManifestLike>(join(runDir, "research-manifest.json"), issues, "research-manifest.json");
	const environment = readJson<EnvironmentLike>(join(runDir, "environment.json"), issues, "environment.json");
	const executorState = existsSync(join(runDir, "executor_state.json")) ? readJson<ExecutorStateLike>(join(runDir, "executor_state.json"), issues, "executor_state.json") : null;
	const workspace = existsSync(join(runDir, "workspace-state.json")) ? readJson<{ iterations?: unknown[] }>(join(runDir, "workspace-state.json"), issues, "workspace-state.json") : null;
	const request = existsSync(join(runDir, "request.json")) ? readJson<{ question?: string }>(join(runDir, "request.json"), issues, "request.json") : null;

	// Per-node joins: tools and failures from the ledger, tokens from receipts.
	const toolsByNode = new Map<string, Set<string>>();
	const failures: { nodeId: string; attempt: number; failureClass: string; component: string; message: string }[] = [];
	const attemptsSeen = new Map<string, number>();
	if (existsSync(join(runDir, "events.jsonl"))) {
		try {
			const ledger = readResearchLedger(join(runDir, "events.jsonl"));
			if (!ledger.valid) issues.push("events.jsonl hash chain is not valid");
			for (const event of ledger.events) {
				const payload = (event.payload ?? {}) as Record<string, unknown>;
				if (event.type === "node-start" && event.nodeId) attemptsSeen.set(event.nodeId, (attemptsSeen.get(event.nodeId) ?? 0) + 1);
				if (event.type === "scientific-tool-receipt" && event.nodeId && typeof payload.toolId === "string") {
					if (!toolsByNode.has(event.nodeId)) toolsByNode.set(event.nodeId, new Set());
					toolsByNode.get(event.nodeId)!.add(payload.toolId);
				}
				if (event.type === "node-failed" && event.nodeId) {
					const message = String(payload.message ?? "");
					// A user stop aborts the in-flight node and the scheduler files it as a failure —
					// that is a cancellation, not a research lesson, so it never becomes a counter-example.
					if (/stop requested|stopped by user|was aborted/i.test(message)) continue;
					failures.push({ nodeId: event.nodeId, attempt: attemptsSeen.get(event.nodeId) ?? 1, failureClass: String(payload.class ?? "unknown"), component: String(payload.affectedComponent ?? "recovery"), message: message.slice(0, 400) });
				}
			}
		} catch (error) { issues.push(`events.jsonl unreadable: ${error instanceof Error ? error.message : String(error)}`); }
	} else issues.push("events.jsonl missing");
	for (const receipt of executorState?.executor?.toolReceipts ?? []) {
		if (!receipt.nodeId || !receipt.toolId) continue;
		if (!toolsByNode.has(receipt.nodeId)) toolsByNode.set(receipt.nodeId, new Set());
		toolsByNode.get(receipt.nodeId)!.add(receipt.toolId);
	}
	const receipts = attestation?.modelCalls?.length ? attestation.modelCalls : executorState?.executor?.modelReceipts ?? [];
	const tokensByNode = new Map<string, { calls: number; tokens: number }>();
	for (const receipt of receipts) {
		if (!receipt.nodeId) continue;
		const entry = tokensByNode.get(receipt.nodeId) ?? { calls: 0, tokens: 0 };
		entry.calls += 1;
		entry.tokens += Number(receipt.totalTokens ?? 0);
		tokensByNode.set(receipt.nodeId, entry);
	}
	const nodes: RouteNode[] = plan.nodes.map((node) => ({
		id: node.id,
		kind: node.kind,
		dependsOn: [...node.dependsOn],
		state: node.state,
		attempts: node.attempts,
		toolIds: [...(toolsByNode.get(node.id) ?? [])].sort(),
		modelCalls: tokensByNode.get(node.id)?.calls ?? 0,
		totalTokens: tokensByNode.get(node.id)?.tokens ?? 0,
		...(node.failureCode ? { failureClass: node.failureCode } : {}),
	}));
	const rounds = Math.max(1, workspace?.iterations?.length ?? 0, ...plan.nodes.map((node) => Number(/^r(\d+)-/.exec(node.id)?.[1] ?? 1)));

	const verifications = attestation?.familyVerifications ?? [];
	const passedCount = verifications.filter((item) => item.result?.passed).length;
	const verifier: GateVerdict = !attestation ? "unknown" : verifications.length === 0 ? "unknown" : passedCount === verifications.length ? "pass" : passedCount > 0 ? "partial" : "fail";
	const replayable = replay?.passed === true && replay.computeReplay?.passed === true;
	const modelCalls = receipts.length;
	const signature = taskSignature(mission);
	const createdAt = now().toISOString();
	const base: Omit<ExperienceRecord, "id" | "status" | "failure"> = {
		version: 1,
		createdAt,
		signature,
		family: mission.taskProfile.family,
		tier,
		route: { stages: [...mission.taskProfile.requiredStages], nodes, rounds },
		outcome: { verifier, replayable, eligible: score?.eligible === true, scienceScore: typeof score?.scienceScore === "number" ? score.scienceScore : null, components: score?.components ?? {}, totalTokens: Number(attestation?.totalTokens ?? 0), wallSeconds: Number(attestation?.wallSeconds ?? 0), modelCalls },
		evidence: { manifestHash: manifest?.manifestHash ?? null, ledgerRootHash: manifest?.eventLedgerRootHash ?? null, evidenceHashes: (manifest?.evidence ?? []).map((item) => item.sha256 ?? "").filter((hash) => /^[a-f0-9]{64}$/.test(hash)).sort(), claimIds: [...(manifest?.claimIds ?? [])] },
		origin: { runId, runMode: attestation?.runMode ?? "unknown", gitCommit: environment?.gitCommit ?? null, strategyFingerprint: environment?.strategyFingerprint ?? null, modelPolicyFingerprint: environment?.evaluatorMetrics?.researchModelPolicy ?? null, question: request?.question ?? mission.question ?? null },
		gates: { verifier, replay: replayable ? "verified" : "unverified", human: "not-required" },
		lineage: { approvals: [], notes: issues.length ? [`extraction gaps: ${issues.join("; ")}`] : [] },
	};
	const completed = plan.nodes.length > 0 && plan.nodes.every((node) => node.state === "completed");
	const run: ExperienceRecord | null = completed && score ? { ...base, id: experienceRecordId(runId, "run"), status: "candidate" } : null;
	if (!run) issues.push(completed ? "no research-score.json: run record not created" : "work graph incomplete: run record not created");
	const counterExamples: ExperienceRecord[] = failures.map((failure) => {
		const node = plan.nodes.find((candidate) => candidate.id === failure.nodeId);
		const template = failureHypothesis(failure.failureClass as ResearchFailureClass);
		return { ...base, id: experienceRecordId(runId, "counter", failure.nodeId, failure.attempt), status: "counter-example", failure: { class: failure.failureClass, affectedComponent: failure.component || template.component, nodeId: failure.nodeId, nodeKind: node?.kind ?? "unknown", message: failure.message, hypothesis: template.hypothesis, falsifier: template.falsifier } };
	});
	return { run, counterExamples, issues };
}
