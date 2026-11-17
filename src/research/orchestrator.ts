/** End-to-end research application service composed entirely through ports. */
import type { EvidenceRef, HypothesisRecord, ResearchClaim, ResearchMission, ResearchWorkGraph } from "./contracts.js";
import { validateResearchMission } from "./contracts.js";
import type { ResearchEnvironment } from "./environment-capture.js";
import type { ScientificValueCard } from "./value-evaluator.js";
import { evaluateScientificValue } from "./value-evaluator.js";
import type { ResearchNarrative } from "./deliverables.js";
import { buildResearchDeliverablesWithSources, requiredDeliverableIds, validateResearchDeliverables, type CommunicationDrafts, type ResearchDeliverableId } from "./deliverables.js";
import type { PersistedResearchDeliverable } from "./deliverable-store.js";
import { createResearchPackageManifest, createResearchPackageSeal } from "./artifact-manifest.js";
import { verifyResearchPackage, type ResearchReplayReport } from "./replay.js";
import { verifyGenericResearch } from "./verifiers/generic.js";
import { scoreResearchCompetition, type ResearchCompetitionScore } from "./scoring.js";
import { ResearchScheduler, type NodeExecutionResult, type NodeVerificationResult } from "./scheduler.js";
import { validateWorkGraphForMission } from "./work-graph.js";
import type { ContentAddressedEvidenceStore } from "./evidence-store.js";
import { readResearchLedger, type ResearchEventLedger } from "./event-ledger.js";
import { validateRuntimeAttestation, type ComputeReplayAttestation, type ResearchRuntimeAttestation } from "./runtime-attestation.js";

export interface ResearchSynthesis {
	hypotheses: HypothesisRecord[];
	claims: ResearchClaim[];
	valueCard: ScientificValueCard;
	narrative: ResearchNarrative;
}

export interface OutcomeAttestation {
	taskOutcome: number;
	perFamily: Record<string, number | null>;
}

export interface ResearchOrchestratorPorts {
	executeNode(node: ResearchWorkGraph["nodes"][number], graph: ResearchWorkGraph, signal: AbortSignal): Promise<NodeExecutionResult>;
	verifyNode(node: ResearchWorkGraph["nodes"][number], result: NodeExecutionResult, graph: ResearchWorkGraph, signal: AbortSignal): Promise<NodeVerificationResult>;
	checkpointGraph(graph: ResearchWorkGraph): void | Promise<void>;
	currentEvidence(): EvidenceRef[];
			/** Communication node drafts (report/presentation/defense artifacts) for Phase-(a) consumption. */
		communicationDrafts?(): CommunicationDrafts;
synthesize(graph: ResearchWorkGraph, evidence: EvidenceRef[]): Promise<ResearchSynthesis>;
	runtimeAttestation(): ResearchRuntimeAttestation;
	outcomeAttestation(graph: ResearchWorkGraph, evidence: EvidenceRef[]): Promise<OutcomeAttestation>;
	persistJson(path: string, value: unknown): void;
	persistText(path: string, value: string): void;
	/** `required` is the mission's deliverable set; implementations must write exactly those. */
	persistDeliverables(bundle: ReturnType<typeof buildResearchDeliverablesWithSources>["bundle"], required: ReadonlySet<ResearchDeliverableId>): PersistedResearchDeliverable[];
	readDeliverable(path: string): Buffer;
	computeReplay(graph: ResearchWorkGraph, evidence: EvidenceRef[]): Promise<ComputeReplayAttestation>;
	now(): Date;
	stopRequested?(): boolean;
}

export interface ResearchRunResult {
	graph: ResearchWorkGraph;
	evidence: EvidenceRef[];
	hypotheses: HypothesisRecord[];
	claims: ResearchClaim[];
	replay: ResearchReplayReport;
	competitionScore: ResearchCompetitionScore;
	deliverables: PersistedResearchDeliverable[];
	manifestHash: string;
	runtimeAttestation: ResearchRuntimeAttestation;
	computeReplay: ComputeReplayAttestation;
}

export async function runResearchOrchestrator(input: {
	mission: ResearchMission;
	graph: ResearchWorkGraph;
	environment: ResearchEnvironment;
	ledger: ResearchEventLedger;
	evidenceStore: ContentAddressedEvidenceStore;
	ledgerPath: string;
	ports: ResearchOrchestratorPorts;
}): Promise<ResearchRunResult> {
	const { mission, environment, ledger, ports } = input;
	const missionIssues = validateResearchMission(mission);
	if (missionIssues.length > 0) throw new Error(`invalid research mission: ${missionIssues.join("; ")}`);
	const graphIssues = validateWorkGraphForMission(mission, input.graph);
	if (graphIssues.length > 0) throw new Error(`invalid research work graph: ${graphIssues.join("; ")}`);
	const requiredDeliverables = requiredDeliverableIds(mission);
	let phase = "start";
	let ledgerClosed = false;
	try {
		ledger.append({ missionId: mission.id, episodeId: mission.id, actor: "controller", type: "research-mission-start", status: "start", payload: { family: mission.taskProfile.family, networkMode: mission.taskProfile.networkMode, nodes: input.graph.nodes.length } });
		phase = "schedule";
		const scheduler = new ResearchScheduler({
			now: ports.now,
			execute: ports.executeNode,
			verify: ports.verifyNode,
			checkpoint: ports.checkpointGraph,
			stopRequested: ports.stopRequested,
			onEvent: (event) => ledger.append({ missionId: mission.id, episodeId: mission.id, nodeId: event.nodeId, actor: event.type.includes("verif") ? "verifier" : "controller", type: event.type, status: event.type.includes("failed") ? "failure" : event.type.includes("completed") ? "success" : "progress", payload: event.detail }),
		});
		const scheduled = await scheduler.run(input.graph);
		if (scheduled.stopped) throw new Error("research mission was stopped before finalization");
		if (!scheduled.completed) throw new Error(`research mission did not complete its WorkGraph (stopped=${scheduled.stopped})`);
		phase = "synthesis";
		const evidence = ports.currentEvidence();
		const synthesis = await ports.synthesize(scheduled.graph, evidence);
		const value = evaluateScientificValue(synthesis.valueCard, evidence.map((item) => item.id));
		if (!value.passed) throw new Error(`scientific value card failed: ${value.issues.join("; ")}`);
		phase = "deliverables";
		const drafts = ports.communicationDrafts?.() ?? {};
		const built = buildResearchDeliverablesWithSources({ mission, valueCard: synthesis.valueCard, hypotheses: synthesis.hypotheses, claims: synthesis.claims, evidence, narrative: synthesis.narrative, drafts });
		const bundle = built.bundle;
		// `coercions` records every deterministic shape repair; `draftIssues` records the substance-only
		// reasons a node draft lost to the template. Both are audit evidence, not failures.
		ledger.append({ missionId: mission.id, episodeId: mission.id, actor: "verifier", type: "deliverable-sources", status: "success", payload: { sources: built.sources, coercions: built.coercions, draftIssues: built.draftIssues } });
		const deliverableIssues = validateResearchDeliverables(bundle, evidence, requiredDeliverables);
		if (deliverableIssues.length > 0) throw new Error(`research deliverables failed: ${deliverableIssues.join("; ")}`);
		const deliverables = ports.persistDeliverables(bundle, requiredDeliverables);
		phase = "runtime-attestation";
		const computeReplay = await ports.computeReplay(scheduled.graph, evidence);
		const runtimeAttestation = ports.runtimeAttestation();
		const runtimeIssues = validateRuntimeAttestation(runtimeAttestation, computeReplay, mission, evidence, synthesis.claims.map((claim) => claim.id));
		const outcome = await ports.outcomeAttestation(scheduled.graph, evidence);
		// D4: the expected honest note (host-development not-competition-eligible) is a "noted"
		// condition, not an unexpected failure — only genuinely unexpected issues read as failure.
		const expectedNotes = runtimeIssues.filter((issue) => issue.includes("not competition-eligible"));
		const unexpectedIssues = runtimeIssues.filter((issue) => !issue.includes("not competition-eligible"));
		ledger.append({ missionId: mission.id, episodeId: mission.id, actor: "verifier", type: "research-precommit-attested", status: unexpectedIssues.length || !computeReplay.passed ? "failure" : "success", artifactIds: evidence.map((item) => item.id), payload: { runtimeIssues, expectedNotes, unexpectedIssues, computeReplay } });
		const ledgerRoot = ledger.rootHash();
		ledger.close();
		ledgerClosed = true;
		phase = "manifest-replay";
		const manifest = createResearchPackageManifest({ mission, graph: scheduled.graph, eventLedgerRootHash: ledgerRoot, environment, runtimeAttestation, evidence, claims: synthesis.claims, deliverables, now: ports.now() });
		const replay = verifyResearchPackage({ manifest, ledgerPath: input.ledgerPath, mission, graph: scheduled.graph, environment, runtimeAttestation, evidence, claims: synthesis.claims, evidenceStore: input.evidenceStore, readDeliverable: ports.readDeliverable, now: ports.now() });
		const ledgerVerification = readResearchLedger(input.ledgerPath);
		const generic = verifyGenericResearch({ mission, graph: scheduled.graph, evidence, claims: synthesis.claims, deliverables, ledgerValid: ledgerVerification.valid, replayPassed: replay.passed, guardViolations: runtimeAttestation.guardViolations, cleanupPassed: runtimeAttestation.cleanupPassed, familyVerifications: runtimeAttestation.familyVerifications, contraryEvidenceLinks: runtimeAttestation.contraryEvidenceLinks });
		const familyMethodScore = runtimeAttestation.familyVerifications.length ? runtimeAttestation.familyVerifications.reduce((sum, item) => sum + item.result.score, 0) / runtimeAttestation.familyVerifications.length : 0;
		const runtimeAttestationPassed = runtimeIssues.length === 0;
		// The substance gate above already threw on any issue, so a required deliverable
		// scores 1 here; a deliverable the mission does not require is null (excluded from
		// the average), not a zero — a report-only development run is judged on its report.
		const gate = (id: ResearchDeliverableId): number | null => requiredDeliverables.has(id) ? (deliverableIssues.length ? 0 : 1) : null;
		const competitionScore = scoreResearchCompetition({
			runtime: { unitTestsPassed: runtimeAttestation.unitTestsPassed, runtimeAttestationPassed, traceComplete: generic.passed, manifestValid: replay.checks.find((check) => check.id === "manifest-hash")?.passed === true, verifyReplayPassed: replay.passed, computeReplayPassed: computeReplay.passed, guardViolations: runtimeAttestation.guardViolations.length, cleanupPassed: runtimeAttestation.cleanupPassed, validResultCount: synthesis.claims.filter((claim) => claim.status === "supported").length },
			science: { taskOutcome: outcome.taskOutcome, methodValidity: familyMethodScore, claimEvidenceQuality: generic.score, reproducibility: replay.passed && computeReplay.passed && computeReplay.processOwnershipVerified ? 1 : 0, scientificValue: value.score },
			communication: { report: gate("report"), presentation: gate("presentation"), defense: gate("defense") },
			totalTokens: runtimeAttestation.totalTokens,
			wallSeconds: runtimeAttestation.wallSeconds,
			perFamily: outcome.perFamily,
		});
		const replayDocument = { ...replay, computeReplay };
		const seal = createResearchPackageSeal(manifest, replayDocument, competitionScore, ports.now());
		phase = "persist";
		ports.persistJson("mission.json", mission);
		ports.persistJson("research-manifest.json", manifest);
		ports.persistJson("plan.json", scheduled.graph);
		ports.persistJson("claims.json", synthesis.claims);
		ports.persistJson("evidence-index.json", evidence);
		ports.persistJson("environment.json", environment);
		ports.persistJson("runtime-attestation.json", runtimeAttestation);
		ports.persistJson("replay.json", replayDocument);
		ports.persistJson("research-score.json", competitionScore);
		ports.persistJson("package-seal.json", seal);
		ports.persistText("README.txt", "GeoRSI research package: verify manifest, ledger, attestation, evidence, deliverables, and replay before trusting the score.\n");
		return { graph: scheduled.graph, evidence, hypotheses: synthesis.hypotheses, claims: synthesis.claims, replay, competitionScore, deliverables, manifestHash: manifest.manifestHash, runtimeAttestation, computeReplay };
	} catch (error) {
		if (!ledgerClosed) {
			try { ledger.append({ missionId: mission.id, episodeId: mission.id, actor: "controller", type: "research-mission-failed", status: "failure", payload: { phase, error: error instanceof Error ? error.message : String(error) } }); } catch { /* preserve original failure */ }
		}
		throw error;
	} finally {
		ledger.close();
	}
}
