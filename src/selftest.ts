/**
 * Selftest: no-LLM verification of every piece of pure logic plus the real
 * eval protocol against a scratch python script. Fast enough to run before
 * any paid episode.
 */
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { applyEdits, builtinDomainKnowledge, composeSystemPrompt, scaffoldFingerprint, SEED_SCAFFOLD } from "./scaffold.js";
import { Journal, atomicWriteJson, loadRunState, saveRunState, fingerprint, readJournalTail, type RunState } from "./journal.js";
import { runEval, guessGenre, makeEvalContext, type Problem } from "./bench/eval.js";
import { openMemory, emptyMemory, addMemory, recall, renderMemory, defaultObservation } from "./memory.js";
import { deterministicTrend } from "./goal.js";
import { durableRunArtifacts } from "./rsi.js";
import { renderLeaderboard, renderFindings } from "./board.js";
import { loadConfig, SUPPORTED_MODELS, modelSpec, configuredModelIds } from "./config.js";
import { loadCorpus, queryTermsFromStatement, regionsForTask, renderRetrieved, retrieve } from "./retrieval.js";
import { meanWithFailures, weightedFitnessMean } from "./metrics.js";
import {
	examHasValidTrainingResult,
	runExam,
	runHeldoutExam,
	type ExamEvidenceStore,
	type ExamProblemResult,
} from "./exam.js";
import { buildModelsJson, loadAiPixelApiKey, resolveRequestMaxTokens } from "./provider.js";
import { TokenLedger } from "./budget.js";
import { failedEpisodeResult, type EpisodeExecutor } from "./inner/episode-contract.js";
import { evaluateScaffold } from "./rsi_eval.js";
import { buildFollowupPrompt, buildInitialEpisodePrompt } from "./inner/prompt-policy.js";
import { createSubmissionState, recordPublicSubmission, validateQuizSubmission } from "./inner/submission-policy.js";
import {
	checkPythonExecutionPolicy,
	ForegroundPythonRunner,
	formatForegroundPythonResult,
	type ForegroundPythonRequest,
} from "./inner/python-execution.js";
import { BackgroundJobRegistry, type BackgroundJob, type BackgroundJobPort } from "./inner/background-jobs.js";
import { persistEpisodeArtifacts, prepareEpisodeArtifacts } from "./inner/artifact-store.js";
import { SandboxieCli, formatSandboxieCommand } from "./sandboxie-cli.js";
import { SandboxieIni } from "./sandboxie-ini.js";
import { SandboxieGlobalLease } from "./sandboxie-lease.js";
import {
	advanceSandboxieCleanup,
	initialSandboxieCleanupState,
	sandboxieCleanupReadyForLease,
	sandboxieCleanupResult,
	sandboxiePartialCleanupReadyForLease,
} from "./sandboxie-cleanup.js";
import { selectTopSurvivors } from "./outer/critique.js";
import { validateResearchMission, type ResearchMission } from "./research/contracts.js";
import { createWorkGraph, createWorkNode, readyWorkNodes, transitionWorkNode, validateWorkGraph, validateWorkGraphForMission, workGraphComplete, workGraphFingerprint } from "./research/work-graph.js";
import { validateDecisionRecord, validateResearchClaim } from "./research/decision-policy.js";
import { classifyResearchFailure } from "./research/failure-taxonomy.js";
import { profileResearchTask } from "./research/task-profile.js";
import { ResearchEventLedger, readResearchLedger, sanitizeResearchEvidence, sanitizeResearchHeaders } from "./research/event-ledger.js";
import { ContentAddressedEvidenceStore } from "./research/evidence-store.js";
import { captureResearchEnvironment } from "./research/environment-capture.js";
import { createResearchPackageManifest } from "./research/artifact-manifest.js";
import { verifyResearchPackage } from "./research/replay.js";
import { ScientificToolRegistry, type ScientificToolReceipt } from "./research/tool-registry.js";
import { buildContextPack } from "./research/context-manager.js";
import { ResearchScheduler } from "./research/scheduler.js";
import { createWebFetchTool, crossrefWorksUrl, openAlexWorksUrl } from "./research/network-tools.js";
import { verifyQuantitativeResearch } from "./research/verifiers/quantitative.js";
import { verifyGisResearch } from "./research/verifiers/gis.js";
import { verifyLiteratureResearch } from "./research/verifiers/literature.js";
import { verifyGenericResearch } from "./research/verifiers/generic.js";
import { evaluateScientificValue, type ScientificValueCard } from "./research/value-evaluator.js";
import { buildResearchDeliverables, validateResearchDeliverables } from "./research/deliverables.js";
import { persistResearchDeliverables } from "./research/deliverable-store.js";
import { SEED_STRATEGY_BUNDLE, strategyBundleFingerprint, validateStrategyBundle } from "./research/strategy-bundle.js";
import { applyStrategyEdit } from "./research/strategy-edits.js";
import { compareStrategyOutcomes, decideStrategyPromotion, type StrategyOutcome } from "./research/promotion.js";
import { mineStrategyExperience } from "./research/experience-miner.js";
import { escalatedOutputCap, roleOutputCap, tokenEfficiency } from "./research/token-policy.js";
import { runStrategyGeneration } from "./research/research-evolution.js";
import { validateRuntimeAttestation, type ResearchRuntimeAttestation } from "./research/runtime-attestation.js";
import { scoreResearchCompetition } from "./research/scoring.js";
import { validateResearchBenchmarkManifest, freezeResearchBenchmarkManifest, benchmarkTasksForStage, benchmarkTaskDenominator, benchmarkManifestUsesOnlyFrozenHeldOut, researchBenchmarkManifestFingerprint, RESEARCH_BENCHMARK_MANIFEST } from "./research/benchmark.js";
import type { Proposal } from "./outer/improve.js";
import { execFileSync } from "node:child_process";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
	if (cond) {
		passed++;
		console.log(`  ok   ${name}`);
	} else {
		failed++;
		console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

export async function selftest(): Promise<boolean> {
	console.log("== scaffold edits ==");
	const s1 = applyEdits(SEED_SCAFFOLD, [
		{ op: "add_tip", text: "check data completeness first" },
		{ op: "add_tip", text: "validate on reference data" },
	]);
	check("add_tip appends", s1.tips.length === 2);
	const s2 = applyEdits(s1, [{ op: "delete_tip", index: 0 }]);
	check("delete_tip removes", s2.tips.length === 1 && s2.tips[0] === "validate on reference data");
	const s3 = applyEdits(s2, [{ op: "replace_tip", index: 5, text: "x" }]);
	check("out-of-range replace is a no-op", s3.tips.length === 1);
	const s4 = applyEdits(s3, [
		{ op: "add_domain_tip", genre: "seismology", text: "use Aki MLE for b-value" },
		{ op: "set_eval_budget", value: 99 },
	]);
	check("domain tip stored", s4.domain_knowledge["seismology"]?.length === 1);
	check("budget edit clamped", s4.eval_budget_hint === 10);
	check("edit lr bounds ops", applyEdits(s4, [
		{ op: "add_tip", text: "1" }, { op: "add_tip", text: "2" }, { op: "add_tip", text: "3" }, { op: "add_tip", text: "4" },
	]).tips.length === s4.tips.length + 3);
	check("seed scaffold untouched", SEED_SCAFFOLD.tips.length === 0);
	const s5 = applyEdits(SEED_SCAFFOLD, [{ op: "prompt_append", text: "Always plot residuals." }]);
	const sysp = composeSystemPrompt(s5, "seismology");
	check("scientific playbook is genre-routed", builtinDomainKnowledge("seismology")[0]!.includes("Aki") && builtinDomainKnowledge("hydrology")[0]!.includes("Gumbel"));
	const { profileTask } = await import("./task-profile.js");
	const quizProfile = profileTask({ id: "k2_c001", genre: "quiz-k2", overrides: { type: "quiz" } });
	const judgeProfile = profileTask({ id: "gabench_01", genre: "gabench", overrides: { judge: true } });
	check("task profile is the single routing taxonomy", quizProfile.isQuiz && quizProfile.preferredInnerRole === "quiz" && !quizProfile.usesOutsideTruth && judgeProfile.usesJudge && judgeProfile.preferredInnerRole === "gis");
	check("scaffold fingerprint ignores generation", scaffoldFingerprint({ ...SEED_SCAFFOLD, generation: 99 }) === scaffoldFingerprint(SEED_SCAFFOLD));
	const scopedTipScaffold = applyEdits(SEED_SCAFFOLD, [{ op: "add_tip", text: "retain scope", genres: ["seismology"] }]);
	check("replace preserves scoped tip metadata", typeof applyEdits(scopedTipScaffold, [{ op: "replace_tip", index: 0, text: "updated" }]).tips[0] === "object");
	const initialQuizPrompt = buildInitialEpisodePrompt({ statement: "task", isQuiz: true, evalCap: 2, softSubmitTarget: 1, memoryBlock: "memory" });
	check("episode initial prompt policy preserves quiz contract", initialQuizPrompt.includes("QUIZ FIRST-PASS CONTRACT") && initialQuizPrompt.includes("georsi_science.py") && initialQuizPrompt.includes("memory"));
	const finalNudge = buildFollowupPrompt({ isQuiz: false, turnsCompleted: 2, submits: 2, budgetLeft: 0, patience: 2, staleSubmits: 0, lastFeedback: "", bestPublic: 0.5, previousTurnAborted: false });
	check("episode follow-up policy enforces finalization", finalNudge.includes("BUDGET EXHAUSTED") && finalNudge.includes("final=true"));
	const submissionState = createSubmissionState();
	recordPublicSubmission(submissionState, { a: "first" }, 0.5);
	recordPublicSubmission(submissionState, { a: "newest-tie" }, 0.5);
	check("submission policy retains newest public tie", submissionState.bestPublic === 0.5 && submissionState.bestAnswer?.a === "newest-tie" && submissionState.staleSubmits === 0);
	const quizPreflight = validateQuizSubmission(
		{ q1: "not-a-letter", unknown: "A" },
		[
			{ qid: "q1", kind: "mcq", options: ["one", "two"] },
			{ qid: "q2", kind: "tf" }, { qid: "q3" }, { qid: "q4" }, { qid: "q5" },
		],
	);
	check("quiz preflight is gold-free and catches shape errors", quizPreflight.issues.length === 3 && quizPreflight.covered === 2);

	console.log("== research mission and work graph ==");
	const researchProfile = profileResearchTask({ id: "seismic-capstone", genre: "capstone-seismology", research: { networkMode: "open" } });
	check("research task profile routes capstone stages and capabilities", researchProfile.family === "capstone" && researchProfile.requiredStages.includes("literature-search") && researchProfile.requiredStages.includes("gis-analysis") && researchProfile.capabilities.includes("network"));
	const mission: ResearchMission = {
		version: 1,
		id: "mission-1",
		question: "Does seismic b-value vary across time and space?",
		scope: "A frozen Southern California catalog",
		estimands: ["b-value"],
		units: ["dimensionless"],
		assumptions: ["catalog magnitude scale is comparable"],
		constraints: ["private truth is unavailable"],
		successCriteria: [{ id: "criterion-frame", description: "research question and estimand are explicit", kind: "evidence", required: true }],
		requiredDeliverables: [{ id: "report", kind: "report", path: "report.md", required: true, description: "scientific report" }],
		sourcePolicy: { networkMode: "open", requireProvenance: true, requireContentHash: true, requireLicenseMetadata: true, requireRetrievedAt: true, requireContraryEvidence: true },
		taskProfile: researchProfile,
	};
	check("research mission contract validates explicit estimand and deliverable", validateResearchMission(mission).length === 0);
	const nodeBudget = { wallMs: 60_000, maxModelCalls: 1, maxToolCalls: 5, maxOutputTokens: 4096, maxAttempts: 2 };
	const frameNode = createWorkNode({ id: "frame", kind: "frame-question", title: "Frame question", dependsOn: [], inputEvidenceIds: [], expectedOutputs: ["mission"], acceptanceCriteriaIds: ["criterion-frame"], allowedCapabilities: ["claim-record"], budget: nodeBudget });
	const auditNode = createWorkNode({ id: "audit", kind: "data-audit", title: "Audit data", dependsOn: ["frame"], inputEvidenceIds: [], expectedOutputs: ["audit-table"], acceptanceCriteriaIds: ["criterion-frame"], allowedCapabilities: ["python"], budget: nodeBudget });
	const missionGraphProfile = { ...mission, taskProfile: { ...mission.taskProfile, requiredStages: mission.taskProfile.requiredStages.filter((kind) => kind === "frame-question" || kind === "data-audit") } };
	check("work graph binds required criteria and capabilities to mission", validateWorkGraphForMission(missionGraphProfile, createWorkGraph(mission.id, [frameNode, auditNode])).length === 0 && validateWorkGraphForMission(missionGraphProfile, createWorkGraph(mission.id, [{ ...frameNode, allowedCapabilities: ["host-shell"] }, auditNode])).some((issue) => issue.includes("outside mission profile")));
	let researchGraph = createWorkGraph(mission.id, [frameNode, auditNode], new Date("2026-08-30T00:00:00Z"));

	const initialGraphFingerprint = workGraphFingerprint(researchGraph);
	researchGraph = transitionWorkNode(researchGraph, "frame", "running", {}, new Date("2026-08-30T00:01:00Z"));
	let missingOutputRejected = false;
	try { transitionWorkNode(researchGraph, "frame", "verifying"); }
	catch { missingOutputRejected = true; }
	check("work graph refuses verification without expected artifacts", missingOutputRejected);
	researchGraph = transitionWorkNode(researchGraph, "frame", "verifying", { outputArtifactIds: ["artifact-mission"] });
	let missingAcceptanceRejected = false;
	try { transitionWorkNode(researchGraph, "frame", "completed"); }
	catch { missingAcceptanceRejected = true; }
	check("work graph refuses completion without acceptance evidence", missingAcceptanceRejected);
	researchGraph = transitionWorkNode(researchGraph, "frame", "completed", { acceptanceEvidenceIds: ["evidence-frame"] });
	check("work graph unlocks dependent nodes only after verified completion", readyWorkNodes(researchGraph).map((node) => node.id).join(",") === "audit" && workGraphFingerprint(researchGraph) === initialGraphFingerprint);
	let prematureRunRejected = false;
	const blockedGraph = createWorkGraph(mission.id, [frameNode, auditNode]);
	try { transitionWorkNode(blockedGraph, "audit", "running"); }
	catch { prematureRunRejected = true; }
	check("work graph rejects running nodes before dependencies", prematureRunRejected);
	const cycleA = createWorkNode({ ...frameNode, id: "a", dependsOn: ["b"] });
	const cycleB = createWorkNode({ ...auditNode, id: "b", dependsOn: ["a"] });
	check("work graph validator detects dependency cycles", validateWorkGraph({ version: 1, missionId: mission.id, createdAt: "now", updatedAt: "now", nodes: [cycleA, cycleB] }).some((issue) => issue.includes("cycle")));
	const evidence = [{ id: "ev-1", kind: "verifier" as const, sha256: "a".repeat(64), logicalName: "verification", producerNodeId: "frame", mediaType: "application/json", bytes: 10 }];
	check("decision policy rejects unsupported selections", validateDecisionRecord({ id: "d-1", nodeId: "frame", question: "Which estimator?", alternatives: ["Aki", "OLS"], selected: "Aki", evidenceIds: ["missing"], assumptions: [], expectedObservation: "stable b", falsifier: "sensitivity fails", uncertainty: "sampling uncertainty" }, evidence).some((issue) => issue.includes("unknown evidence")));
	check("claim policy requires evidence for supported conclusions", validateResearchClaim({ id: "c-1", text: "b is stable", status: "supported", evidenceIds: [], uncertainty: "bootstrap", limitations: [] }, evidence).some((issue) => issue.includes("requires evidence")));
	check("research failure taxonomy routes CRS and timeout failures", classifyResearchFailure("CRS projection mismatch").class === "crs" && classifyResearchFailure("execution timed out").affectedComponent === "budget");
	console.log("== research tools context and scheduler ==");
	const toolReceipts: ScientificToolReceipt[] = [];
	let toolClock = Date.parse("2026-08-30T00:10:00Z");
	const toolRegistry = new ScientificToolRegistry(() => new Date(toolClock += 10), () => `receipt-${toolClock}`, (receipt) => toolReceipts.push(receipt));
	toolRegistry.register({
		id: "inspect-table",
		version: "1",
		capability: "statistics",
		validate: (input) => typeof (input as { rows?: unknown }).rows === "number" ? [] : ["rows must be numeric"],
		execute: async (_context, input: { rows: number; apiKey?: string }) => ({ output: { rows: input.rows, apiKey: input.apiKey }, artifactIds: ["artifact-table"] }),
	});
	const scientificToolRun = await toolRegistry.execute("inspect-table", { missionId: mission.id, episodeId: "episode-1", nodeId: "audit", allowedCapabilities: ["statistics"], remainingWallMs: 1000 }, { rows: 12, apiKey: "must-redact" });
	check("scientific tool registry records typed success receipts", scientificToolRun.receipt.status === "success" && scientificToolRun.receipt.artifactIds[0] === "artifact-table" && toolReceipts.length === 1);
	check("scientific tool receipts redact credential-shaped fields", (scientificToolRun.receipt.input as { apiKey?: string }).apiKey === "[REDACTED_CREDENTIAL]" && (scientificToolRun.receipt.output as { apiKey?: string }).apiKey === "[REDACTED_CREDENTIAL]");
	let disallowedCapabilityRejected = false;
	try { await toolRegistry.execute("inspect-table", { missionId: mission.id, episodeId: "episode-1", nodeId: "frame", allowedCapabilities: ["filesystem"], remainingWallMs: 1000 }, { rows: 1 }); }
	catch { disallowedCapabilityRejected = true; }
	check("scientific tool registry enforces node capabilities", disallowedCapabilityRejected);
	const contextPack = buildContextPack([
		{ id: "policy", kind: "policy", content: "never access private truth", priority: 100, mandatory: true },
		{ id: "node", kind: "node", content: "audit the dataset", priority: 90, mandatory: true },
		{ id: "useful", kind: "evidence", content: "x".repeat(80), priority: 50, mandatory: false },
		{ id: "noise", kind: "evidence", content: "y".repeat(800), priority: 1, mandatory: false },
	], 100);
	check("context pack keeps mandatory and highest-value evidence within budget", contextPack.entries.some((entry) => entry.id === "useful") && contextPack.skippedBlockIds.includes("noise") && contextPack.estimatedTokens <= 100);
	let oversizedMandatoryRejected = false;
	try { buildContextPack([{ id: "too-large", kind: "policy", content: "x".repeat(1000), priority: 1, mandatory: true }], 10); }
	catch { oversizedMandatoryRejected = true; }
	check("context pack fails closed when mandatory policy exceeds budget", oversizedMandatoryRejected);
	let schedulerGraph = createWorkGraph("scheduler-mission", [frameNode, auditNode], new Date("2026-08-30T00:20:00Z"));
	let auditAttempts = 0;
	let schedulerNow = Date.parse("2026-08-30T00:20:00Z");
	const checkpoints: string[] = [];
	const scheduler = new ResearchScheduler({
		now: () => new Date(schedulerNow += 1000),
		execute: async (node) => {
			if (node.id === "audit" && auditAttempts++ === 0) throw new Error("execution timed out");
			return { artifactIds: [`artifact-${node.id}`], usage: { modelCalls: 0, toolCalls: 1, outputTokens: 0 } };
		},
		verify: async (node) => ({ passed: true, evidenceIds: [`verify-${node.id}`], issues: [], usage: { modelCalls: 0, toolCalls: 0, outputTokens: 0 } }),
		checkpoint: (graph) => { checkpoints.push(graph.updatedAt); },
	});
	const scheduled = await scheduler.run(schedulerGraph);
	schedulerGraph = scheduled.graph;
	check("research scheduler retries only the failed node and completes DAG", scheduled.completed && scheduled.executedNodes.join(",") === "frame,audit,audit" && scheduled.failures[0]?.failure.class === "timeout" && workGraphComplete(schedulerGraph));
	check("research scheduler checkpoints every state transition", checkpoints.length >= 8);
	const budgetNode = createWorkNode({ ...frameNode, id: "budget-node", budget: { ...nodeBudget, maxToolCalls: 0, maxAttempts: 1 } });
	const budgetScheduler = new ResearchScheduler({ now: () => new Date(), execute: async () => ({ artifactIds: ["artifact"], usage: { modelCalls: 0, toolCalls: 1, outputTokens: 0 } }), verify: async () => ({ passed: true, evidenceIds: ["verify"], issues: [], usage: { modelCalls: 0, toolCalls: 0, outputTokens: 0 } }), checkpoint: () => {} });
	const budgetScheduled = await budgetScheduler.run(createWorkGraph("budget-mission", [budgetNode]));
	check("research scheduler enforces attested tool-call budget", !budgetScheduled.completed && budgetScheduled.graph.nodes[0]?.state === "failed");
	const invalidUsageScheduler = new ResearchScheduler({ now: () => new Date(), execute: async () => ({ artifactIds: ["artifact"], usage: { modelCalls: Number.NaN, toolCalls: 0, outputTokens: 0 } }), verify: async () => ({ passed: true, evidenceIds: ["verify"], issues: [], usage: { modelCalls: 0, toolCalls: 0, outputTokens: 0 } }), checkpoint: () => {} });
	const invalidUsageScheduled = await invalidUsageScheduler.run(createWorkGraph("invalid-usage-mission", [createWorkNode({ ...frameNode, id: "invalid-usage-node", budget: { ...nodeBudget, maxAttempts: 1 } })]));
	check("research scheduler fails closed on invalid usage receipts", !invalidUsageScheduled.completed && invalidUsageScheduled.failures[0]?.failure.message.includes("usage must be"));
	const timeoutNode = createWorkNode({ ...frameNode, id: "timeout-node", budget: { ...nodeBudget, wallMs: 5, maxAttempts: 1 } });
	const timeoutScheduler = new ResearchScheduler({ now: () => new Date(), execute: async (_node, _graph, signal) => new Promise((resolve, reject) => { const timer = setTimeout(() => resolve({ artifactIds: ["late"], usage: { modelCalls: 0, toolCalls: 0, outputTokens: 0 } }), 100); signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }); }), verify: async () => ({ passed: true, evidenceIds: ["verify"], issues: [], usage: { modelCalls: 0, toolCalls: 0, outputTokens: 0 } }), checkpoint: () => {} });
	const timeoutScheduled = await timeoutScheduler.run(createWorkGraph("timeout-mission", [timeoutNode]));
	check("research scheduler aborts work at node wall-clock deadline", !timeoutScheduled.completed && timeoutScheduled.failures[0]?.failure.class === "timeout");
	console.log("== research scientific verifiers ==");
	const quantitativePass = verifyQuantitativeResearch({ rowCount: 100, missingCount: 0, duplicateCount: 0, columnsAudited: ["magnitude"], units: { magnitude: "Mw", b: "dimensionless" }, estimand: "Gutenberg-Richter b-value", method: "Aki MLE", referenceCalibration: { performed: true, expected: 0.9, actual: 0.91, tolerance: 0.02 }, randomSeed: 7, stochasticMethod: true, finiteOutputs: true, uncertainty: { method: "bootstrap", lower: 0.75, upper: 0.95 }, sensitivityRuns: 3, independentCheck: { method: "alternate Mc", relativeDifference: 0.02, tolerance: 0.05 }, targetWithinObservedRange: true });
	check("quantitative verifier accepts audited uncertainty and independent check", quantitativePass.passed && quantitativePass.score === 1);
	const quantitativeFail = verifyQuantitativeResearch({ rowCount: 10, missingCount: 0, duplicateCount: 0, columnsAudited: ["x"], units: {}, estimand: "value", method: "fit", stochasticMethod: true, finiteOutputs: false, sensitivityRuns: 0 });
	check("quantitative verifier rejects missing units seed uncertainty and sensitivity", !quantitativeFail.passed && quantitativeFail.issues.filter((issue) => issue.severity === "error").length >= 5);
	const gisPass = verifyGisResearch({ inputCrs: ["EPSG:4326"], outputCrs: "EPSG:32611", metricOperations: true, projectedForMetricOperations: true, axisOrderChecked: true, artifacts: [{ path: "hotspots.geojson", kind: "vector", bytes: 1024, sha256: "c".repeat(64), crs: "EPSG:4326", bounds: [-120, 32, -115, 36], featureCount: 10, invalidGeometryCount: 0, emptyGeometryCount: 0 }, { path: "map.png", kind: "figure", bytes: 2048, sha256: "d".repeat(64) }], requestedOutputPaths: ["hotspots.geojson", "map.png"], spatialJoinRowCount: 10, nullJoinCount: 0, replayStatisticsMatch: true });
	check("GIS verifier accepts projected metric workflow and valid artifacts", gisPass.passed);
	const gisFail = verifyGisResearch({ inputCrs: ["EPSG:4326"], outputCrs: "EPSG:4326", metricOperations: true, projectedForMetricOperations: false, axisOrderChecked: false, artifacts: [{ path: "../escape.geojson", kind: "vector", bytes: 5, sha256: "bad", featureCount: 0, invalidGeometryCount: 1 }], requestedOutputPaths: ["../escape.geojson"], replayStatisticsMatch: false });
	check("GIS verifier rejects CRS artifact and replay failures", !gisFail.passed && gisFail.issues.some((issue) => issue.code === "metric-crs") && gisFail.issues.some((issue) => issue.code === "artifact-path"));
	const literatureClaim = { id: "lit-claim", text: "Magnitude completeness affects b-value", status: "supported" as const, evidenceIds: ["source-1"], uncertainty: "scope-limited", limitations: [] };
	const literaturePass = verifyLiteratureResearch({ sources: [{ id: "source-1", title: "Completeness and b-value", authors: ["A. Researcher"], year: 2024, doi: "10.1234/example", retrievedAt: "2026-08-30T00:00:00Z", contentHash: "e".repeat(64), primary: true, supportsClaimIds: ["lit-claim"], contradictsClaimIds: [] }], claims: [literatureClaim], hypotheses: [{ id: "h-1", statement: "b varies after completeness control", rationaleEvidenceIds: ["source-1"], expectedObservation: "paired difference", falsifier: "interval covers zero", status: "proposed" }], searchQueries: ["seismic magnitude completeness b value"], minimumSources: 1, requireContraryEvidence: false, noveltyScope: "Crossref and OpenAlex", noveltySearchCutoff: "2026-08-30" });
	check("literature verifier accepts traceable source and falsifiable hypothesis", literaturePass.passed);
	const literatureFail = verifyLiteratureResearch({ sources: [{ id: "source-1", title: "", authors: [], year: 0, doi: "not-a-doi", retrievedAt: "bad", contentHash: "bad", primary: false, supportsClaimIds: [], contradictsClaimIds: [] }], claims: [literatureClaim], hypotheses: [], searchQueries: [], minimumSources: 3, requireContraryEvidence: true, noveltyScope: "", noveltySearchCutoff: "" });
	check("literature verifier rejects fabricated or incomplete citations", !literatureFail.passed && literatureFail.issues.some((issue) => issue.code === "source-identity"));
	const valueDimension = { score: 3 as const, rationale: "supported by the frozen catalog", evidenceIds: ["source-1"] };
	const valueCard: ScientificValueCard = { significance: valueDimension, novelty: valueDimension, falsifiability: valueDimension, dataFeasibility: valueDimension, methodologicalValue: valueDimension, potentialImpact: valueDimension, limitations: ["regional scope"], recommendation: "proceed" };
	check("scientific value evaluator requires evidence and explicit limitations", evaluateScientificValue(valueCard, ["source-1"]).passed && !evaluateScientificValue({ ...valueCard, novelty: { ...valueDimension, evidenceIds: ["missing"] } }, ["source-1"]).passed);
	console.log("== research StrategyBundle evolution ==");
	check("seed StrategyBundle has no fallback and delegates model identity to config", validateStrategyBundle(SEED_STRATEGY_BUNDLE).length === 0 && SEED_STRATEGY_BUNDLE.routing.allowFallbackModels === false);
	const budgetStrategy = applyStrategyEdit(SEED_STRATEGY_BUNDLE, [{ component: "budget", op: "set-role-output-cap", role: "quantitative", tokens: 12000 }], "selftest");
	check("StrategyBundle edits one component with lineage", budgetStrategy.budget.roleOutputCaps.quantitative === 12000 && budgetStrategy.lineage.changedComponent === "budget" && budgetStrategy.lineage.parentFingerprint === strategyBundleFingerprint(SEED_STRATEGY_BUNDLE));
	let multiComponentEditRejected = false;
	try { applyStrategyEdit(SEED_STRATEGY_BUNDLE, [{ component: "planner", op: "set-max-replans", value: 1 }, { component: "budget", op: "set-role-output-cap", role: "quantitative", tokens: 12000 }]); }
	catch { multiComponentEditRejected = true; }
	check("StrategyBundle rejects multi-component challengers", multiComponentEditRejected);
	let strategyNoopRejected = false;
	try { applyStrategyEdit(SEED_STRATEGY_BUNDLE, [{ component: "planner", op: "set-max-replans", value: SEED_STRATEGY_BUNDLE.planner.maxReplans }]); }
	catch { strategyNoopRejected = true; }
	check("StrategyBundle rejects no-op edits", strategyNoopRejected);
	check("role output caps remain xhigh-efficient and bounded", roleOutputCap(SEED_STRATEGY_BUNDLE.budget, "quantitative") === 16384 && escalatedOutputCap({ policy: SEED_STRATEGY_BUNDLE.budget, role: "quantitative", attemptedEscalations: 0, stopReason: "length", validArtifactProduced: false }) === 32768 && escalatedOutputCap({ policy: SEED_STRATEGY_BUNDLE.budget, role: "quantitative", attemptedEscalations: 1, stopReason: "length", validArtifactProduced: false }) === null);
	check("token efficiency reports artifacts claims and score", tokenEfficiency({ role: "quantitative", calls: 1, failedCalls: 0, usage: { input: 50000, output: 10000, reasoning: null, cacheRead: null, cacheWrite: null, total: 60000 }, validArtifacts: 2, supportedClaims: 1, score: 0.9 }).scorePer100kTokens === 1.5);
	const makeOutcome = (runId: string, repetition: number, score: number, tokens: number, worstFamilyScore = 0.7): StrategyOutcome => ({ runId, manifestFingerprint: "fixed-manifest", model: "gpt-5.6-luna", thinkingLevel: "xhigh", repetition, validRate: 1, score, worstFamilyScore, totalTokens: tokens, replayPassRate: 1, guardViolations: 0, cleanupPassed: true, otherModelCalls: 0 });
	const baselineOutcomes = [makeOutcome("b1", 1, 0.70, 100000), makeOutcome("b2", 2, 0.71, 100000)];
	const candidateOutcomes = [makeOutcome("c1", 1, 0.74, 70000), makeOutcome("c2", 2, 0.75, 70000)];
	const promotion = decideStrategyPromotion(baselineOutcomes, candidateOutcomes);
	check("paired StrategyBundle promotion requires quality and honest gates", promotion.promote && promotion.status === "active" && (promotion.pairedScoreDelta ?? 0) > 0.01 && (promotion.tokenRatio ?? 1) === 0.7);
	const invalidBaselinePromotion = decideStrategyPromotion([{ ...baselineOutcomes[0]!, replayPassRate: 0 }, baselineOutcomes[1]!], candidateOutcomes);
	const mismatchedPromotion = decideStrategyPromotion(baselineOutcomes, [{ ...candidateOutcomes[0]!, repetition: 1 }, { ...candidateOutcomes[1]!, repetition: 3 }]);
	const duplicatePromotion = decideStrategyPromotion(baselineOutcomes, [{ ...candidateOutcomes[0]!, repetition: 1 }, { ...candidateOutcomes[1]!, repetition: 1 }]);
	check("Strategy promotion rejects invalid baselines and mismatched pairs", !invalidBaselinePromotion.promote && !mismatchedPromotion.promote && !duplicatePromotion.promote);
	check("Strategy selection is quality-first then token-efficient within score band", compareStrategyOutcomes(makeOutcome("quality", 1, 0.8, 200000), makeOutcome("cheap", 1, 0.7, 10000)) < 0 && compareStrategyOutcomes(makeOutcome("same-cheap", 1, 0.795, 50000), makeOutcome("same-expensive", 1, 0.8, 100000)) < 0);
	const timeoutExperience = mineStrategyExperience({ failure: classifyResearchFailure("execution timed out"), taskFamily: "quantitative", evidenceIds: ["ev-timeout"], runId: "run", episodeId: "episode", nodeId: "analysis", id: "experience-1" });
	check("experience miner creates evidence-linked probation hypotheses", timeoutExperience?.status === "probation" && timeoutExperience.component === "budget" && timeoutExperience.evidenceIds[0] === "ev-timeout");
	const evolvedGeneration = await runStrategyGeneration({
		champion: SEED_STRATEGY_BUNDLE,
		candidateEdits: [
			[{ component: "budget" as const, op: "set-role-output-cap" as const, role: "quantitative", tokens: 12000 }],
			[{ component: "planner" as const, op: "set-max-replans" as const, value: 1 }],
		],
		evaluator: {
			evaluate: async (_bundle, role, index) => role === "baseline" ? baselineOutcomes : index === 0 ? candidateOutcomes : [makeOutcome("p1", 1, 0.69, 50000), makeOutcome("p2", 2, 0.70, 50000)],
		},
		originRun: "selftest-evolution",
	});
	check("typed research evolution accepts only paired promoted winner", evolvedGeneration.acceptedCandidate === 0 && evolvedGeneration.champion.lineage.changedComponent === "budget" && evolvedGeneration.candidates.length === 2 && !evolvedGeneration.candidates[1]?.promotion.promote);
	const lunaReceipt = { id: "call-1", provider: "geiliapi", model: "gpt-5.6-luna", api: "openai-completions", requestedThinking: "xhigh", effectiveThinking: "xhigh", inputTokens: 100, outputTokens: 50, reasoningTokens: null, totalTokens: 150, success: true };
	const attestationMission: ResearchMission = { ...mission, sourcePolicy: { ...mission.sourcePolicy, requireContraryEvidence: false }, taskProfile: { ...mission.taskProfile, family: "quantitative", verifierProfile: "quantitative-v1", sourceRequirements: [] } };
	const competitionAttestation: ResearchRuntimeAttestation = { version: 1, runMode: "competition", modelPolicy: { provider: "geiliapi", base_url: "https://sub.geiliapi.com/v1", model: "gpt-5.6-luna", api: "openai-completions", thinking_level: "xhigh", max_tokens_field: "max_completion_tokens", credential_env: "GEILIAPI_API_KEY", fallback: "none", context_window: 600000, max_output: 128000, supports_developer_role: true, supports_reasoning_effort: true, supports_usage: true, supports_tool_loop: true, require_provider_observed_thinking: true }, modelPolicyFingerprint: "2f6d1b695a00cc1006a7250b", unitTestsPassed: true, guardViolations: [], cleanupPassed: true, isolationBackend: "sandboxie-app-level", modelCalls: [lunaReceipt], familyVerifications: [{ profile: "quantitative-v1", result: quantitativePass, inputHash: "a".repeat(64), evidenceIds: [evidence[0]!.id] }], contraryEvidenceLinks: [], totalTokens: 150, wallSeconds: 10 };
	const sandboxReplay = { passed: true, backend: "sandboxie-app-level" as const, processOwnershipVerified: true };
	check("competition attestation requires receipt-backed configured xhigh model and Sandboxie", validateRuntimeAttestation({ ...competitionAttestation, modelPolicy: { provider: "geiliapi", base_url: "https://sub.geiliapi.com/v1", model: "gpt-5.6-luna", api: "openai-completions", thinking_level: "xhigh", max_tokens_field: "max_completion_tokens", credential_env: "GEILIAPI_API_KEY", fallback: "none", context_window: 600000, max_output: 128000, supports_developer_role: true, supports_reasoning_effort: true, supports_usage: true, supports_tool_loop: true, require_provider_observed_thinking: true }, modelPolicyFingerprint: "2f6d1b695a00cc1006a7250b" }, sandboxReplay, attestationMission, evidence, []).some((issue) => issue.includes("fingerprint")) === false && validateRuntimeAttestation({ ...competitionAttestation, modelCalls: [], totalTokens: 0 }, sandboxReplay, attestationMission, evidence, []).some((issue) => issue.includes("model-call receipts")));
	const attestedScore = scoreResearchCompetition({ runtime: { unitTestsPassed: true, runtimeAttestationPassed: true, traceComplete: true, manifestValid: true, verifyReplayPassed: true, computeReplayPassed: true, guardViolations: 0, cleanupPassed: true, validResultCount: 1 }, science: { taskOutcome: 1, methodValidity: 1, claimEvidenceQuality: 1, reproducibility: 1, scientificValue: 1 }, communication: { report: 1, presentation: 1, defense: 1 }, totalTokens: 100000, wallSeconds: 10, perFamily: { quantitative: 1 } });
	check("three-layer score is non-compensable and token-aware", attestedScore.eligible && attestedScore.overall === 1 && attestedScore.scorePer100kTokens === 1 && !scoreResearchCompetition({ runtime: { unitTestsPassed: true, runtimeAttestationPassed: false, traceComplete: true, manifestValid: true, verifyReplayPassed: true, computeReplayPassed: true, guardViolations: 0, cleanupPassed: true, validResultCount: 1 }, science: { taskOutcome: 1, methodValidity: 1, claimEvidenceQuality: 1, reproducibility: 1, scientificValue: 1 }, communication: { report: 1, presentation: 1, defense: 1 }, totalTokens: 1, wallSeconds: 1, perFamily: {} }).eligible);
	check("research benchmark manifest fixes five-task Stage-A and unified model policy", validateResearchBenchmarkManifest(RESEARCH_BENCHMARK_MANIFEST).length === 0 && benchmarkTasksForStage(RESEARCH_BENCHMARK_MANIFEST, "stage-a").length === 5 && RESEARCH_BENCHMARK_MANIFEST.modelPolicy.model === "gpt-5.6-luna" && RESEARCH_BENCHMARK_MANIFEST.modelPolicy.provider === "geiliapi");
	const frozenBenchmark = freezeResearchBenchmarkManifest(RESEARCH_BENCHMARK_MANIFEST);
	check("held-out benchmark requires immutable frozen manifest", frozenBenchmark.frozen && benchmarkManifestUsesOnlyFrozenHeldOut(frozenBenchmark) && benchmarkTaskDenominator(frozenBenchmark, "held-out") === 1 && researchBenchmarkManifestFingerprint(frozenBenchmark) !== researchBenchmarkManifestFingerprint(RESEARCH_BENCHMARK_MANIFEST));
	const malformedBenchmark = structuredClone(RESEARCH_BENCHMARK_MANIFEST);
	malformedBenchmark.stages["stage-a"] = malformedBenchmark.stages["stage-a"].slice(0, 4);
	check("benchmark manifest rejects Stage-A denominator drift", validateResearchBenchmarkManifest(malformedBenchmark).some((issue) => issue.includes("exactly five")));


	const tmp = join(process.cwd(), "runs", ".selftest");
	rmSync(tmp, { recursive: true, force: true });
	mkdirSync(tmp, { recursive: true });
	console.log("== research evidence and replay ==");
	const researchDir = join(tmp, "research-evidence");
	const ledgerPath = join(researchDir, "events.jsonl");
	const researchLedger = new ResearchEventLedger(ledgerPath, () => new Date("2026-08-30T01:00:00Z"), ["C:/private/truth"]);
	researchLedger.append({ missionId: mission.id, episodeId: "episode-1", nodeId: "frame", actor: "planner", type: "node-start", status: "start", payload: { apiKey: "must-not-survive", path: "C:/private/truth", header: "Bearer " + "x".repeat(24) } });
	researchLedger.append({ missionId: mission.id, episodeId: "episode-1", nodeId: "frame", actor: "verifier", type: "node-verified", status: "success", artifactIds: ["pending-artifact"] });
	const ledgerRoot = researchLedger.rootHash();
	researchLedger.close();
	const ledgerRead = readResearchLedger(ledgerPath);
	check("research event ledger is hash-chained and monotonic", ledgerRead.valid && ledgerRead.events.length === 2 && ledgerRead.events[1]?.previousHash === ledgerRead.events[0]?.hash && ledgerRead.rootHash === ledgerRoot);
	const redactedPayload = ledgerRead.events[0]?.payload as { apiKey?: string; path?: string; header?: string };
	check("research event ledger redacts credentials and protected paths", redactedPayload.apiKey === "[REDACTED_CREDENTIAL]" && redactedPayload.path === "[REDACTED_PROTECTED_PATH]" && redactedPayload.header === "[REDACTED_CREDENTIAL]");
	const tamperedLedgerPath = join(researchDir, "events-tampered.jsonl");
	writeFileSync(tamperedLedgerPath, readFileSync(ledgerPath, "utf8").replace("node-start", "node-tampered"));
	check("research event replay detects tampering", !readResearchLedger(tamperedLedgerPath).valid);
	const tornLedgerPath = join(researchDir, "events-torn.jsonl");
	writeFileSync(tornLedgerPath, readFileSync(ledgerPath, "utf8") + "{\"version\":1");
	const recoveredLedger = new ResearchEventLedger(tornLedgerPath, () => new Date("2026-08-30T01:01:00Z"));
	recoveredLedger.close();
	check("research event ledger recovers only a torn final record", readResearchLedger(tornLedgerPath).valid && !readResearchLedger(tornLedgerPath).tornTail && readResearchLedger(tornLedgerPath).events.length === 2);
	check("research evidence sanitizer catches generated secret text", JSON.stringify(sanitizeResearchEvidence({ token: "x", text: "sk-" + "a".repeat(24) })).includes("REDACTED_CREDENTIAL"));
	const sanitizedUrl = String(sanitizeResearchEvidence("https://user:pass@example.com/data?api_key=opaque&X-Amz-Signature=signed&safe=1"));
	const sanitizedHeaders = sanitizeResearchHeaders({ "set-cookie": "session=opaque", "x-api-key": "opaque", "content-type": "text/plain" });
	check("research evidence sanitizer strips URL userinfo query secrets and cookies", !sanitizedUrl.includes("opaque") && !sanitizedUrl.includes("user") && sanitizedUrl.includes("safe=1") && sanitizedHeaders["set-cookie"] === "[REDACTED_CREDENTIAL]" && sanitizedHeaders["x-api-key"] === "[REDACTED_CREDENTIAL]");
	const evidenceStore = new ContentAddressedEvidenceStore(join(researchDir, "cas"));
	const evidenceRef = evidenceStore.putJson({ estimate: 0.85, unit: "dimensionless" }, { kind: "verifier", logicalName: "results/verification.json", producerNodeId: "frame" });
	check("content-addressed evidence verifies bytes and hash", evidenceRef.logicalName === "verification.json" && evidenceStore.verify(evidenceRef) && evidenceStore.read(evidenceRef).length > 0);
	const genericMission: ResearchMission = { ...mission, sourcePolicy: { networkMode: "blocked", requireProvenance: false, requireContentHash: true, requireLicenseMetadata: false, requireRetrievedAt: false, requireContraryEvidence: false }, taskProfile: { ...mission.taskProfile, family: "quantitative", requiredStages: ["frame-question"], capabilities: ["claim-record"], verifierProfile: "quantitative-v1", deliverableSchema: "generic-test", sourceRequirements: [], networkMode: "blocked" } };
	let genericGraph = createWorkGraph(genericMission.id, [frameNode]);
	genericGraph = transitionWorkNode(genericGraph, "frame", "running");
	genericGraph = transitionWorkNode(genericGraph, "frame", "verifying", { outputArtifactIds: [evidenceRef.id] });
	genericGraph = transitionWorkNode(genericGraph, "frame", "completed", { acceptanceEvidenceIds: [evidenceRef.id] });
	const genericClaim = { id: "generic-claim", text: "verified estimate", status: "supported" as const, evidenceIds: [evidenceRef.id], uncertainty: "fixture", limitations: [] };
	const genericPass = verifyGenericResearch({ mission: genericMission, graph: genericGraph, evidence: [evidenceRef], claims: [genericClaim], deliverables: [{ id: "report", path: "report.md", bytes: 100, sha256: "f".repeat(64) }], ledgerValid: true, replayPassed: true, guardViolations: [], cleanupPassed: true, familyVerifications: [{ profile: "quantitative-v1", result: quantitativePass, inputHash: "a".repeat(64), evidenceIds: [evidenceRef.id] }], contraryEvidenceLinks: [] });
	check("generic research verifier enforces complete package gates", genericPass.passed);
	const genericGuardFail = verifyGenericResearch({ mission: genericMission, graph: genericGraph, evidence: [evidenceRef], claims: [genericClaim], deliverables: [{ id: "report", path: "report.md", bytes: 100, sha256: "f".repeat(64) }], ledgerValid: true, replayPassed: true, guardViolations: ["protected path"], cleanupPassed: true, familyVerifications: [{ profile: "quantitative-v1", result: quantitativePass, inputHash: "a".repeat(64), evidenceIds: [evidenceRef.id] }], contraryEvidenceLinks: [] });
	check("generic research verifier makes guard violations ineligible", !genericGuardFail.passed && genericGuardFail.issues.some((issue) => issue.code === "guard-violation"));
	const deliverableSource = evidenceStore.putJson({ title: "fixture source" }, { kind: "source", logicalName: "source.json", producerNodeId: "frame", sourceUrl: "https://example.com/source", retrievedAt: "2026-08-30T00:00:00Z", license: "fixture" });
	const deliverableGeo = evidenceStore.putJson({ type: "FeatureCollection", features: [] }, { kind: "geodata", logicalName: "map.geojson", producerNodeId: "frame" });
	const deliverableTable = evidenceStore.putJson({ sensitivity: [0.8, 0.9] }, { kind: "table", logicalName: "sensitivity.json", producerNodeId: "frame" });
	const deliverableEvidence = [evidenceRef, deliverableSource, deliverableGeo, deliverableTable];
	const sourceGatedMission: ResearchMission = { ...genericMission, sourcePolicy: { networkMode: "open", requireProvenance: true, requireContentHash: true, requireLicenseMetadata: true, requireRetrievedAt: true, requireContraryEvidence: true }, taskProfile: { ...genericMission.taskProfile, sourceRequirements: [{ id: "sources", description: "sources", minimumCount: 2 }] } };
	const sourceGated = verifyGenericResearch({ mission: sourceGatedMission, graph: genericGraph, evidence: [evidenceRef, deliverableSource], claims: [genericClaim], deliverables: [{ id: "report", path: "report.md", bytes: 100, sha256: "f".repeat(64) }], ledgerValid: true, replayPassed: true, guardViolations: [], cleanupPassed: true, familyVerifications: [{ profile: "quantitative-v1", result: quantitativePass, inputHash: "a".repeat(64), evidenceIds: [evidenceRef.id] }], contraryEvidenceLinks: [] });
	check("generic verifier enforces source counts metadata contrary evidence and family gates", !sourceGated.passed && sourceGated.issues.some((issue) => issue.code === "source-requirement") && sourceGated.issues.some((issue) => issue.code === "contrary-evidence"));
	const deliverableValueDimension = { score: 3 as const, rationale: "verified fixture evidence", evidenceIds: [evidenceRef.id] };
	const deliverableValueCard: ScientificValueCard = { significance: deliverableValueDimension, novelty: deliverableValueDimension, falsifiability: deliverableValueDimension, dataFeasibility: deliverableValueDimension, methodologicalValue: deliverableValueDimension, potentialImpact: deliverableValueDimension, limitations: ["frozen fixture"], recommendation: "proceed" };
	const deliverableBundle = buildResearchDeliverables({
		mission: genericMission,
		valueCard: deliverableValueCard,
		hypotheses: [{ id: "hypothesis-1", statement: "the estimate is stable", rationaleEvidenceIds: [evidenceRef.id], expectedObservation: "small sensitivity delta", falsifier: "delta exceeds tolerance", status: "supported" }],
		claims: [genericClaim],
		evidence: deliverableEvidence,
		narrative: {
			dataSummary: { text: "A frozen, hashed fixture was audited.", evidenceIds: [deliverableTable.id] },
			methodSummary: { text: "A deterministic estimator, GIS artifact, and independent check were executed.", evidenceIds: [evidenceRef.id, deliverableGeo.id], claimIds: [genericClaim.id] },
			resultSummary: { text: "The verified fixture estimate is supported.", evidenceIds: [evidenceRef.id], claimIds: [genericClaim.id] },
			uncertaintySummary: { text: "Sensitivity and uncertainty were evaluated.", evidenceIds: [deliverableTable.id, evidenceRef.id], claimIds: [genericClaim.id] },
			innovationSummary: { text: "The workflow links every conclusion to replayable evidence.", evidenceIds: [deliverableSource.id] },
			reproducibilitySummary: { text: "Run verify-only replay and then compute replay in Sandboxie.", evidenceIds: [evidenceRef.id] },
		},
	});
	check("research deliverables include report eight slides and grounded defense", validateResearchDeliverables(deliverableBundle, deliverableEvidence).length === 0 && deliverableBundle.defense.items.length === 12);
	const persistedDeliverables = persistResearchDeliverables(join(researchDir, "deliverables"), deliverableBundle);
	check("research deliverable store writes hashed report presentation and defense", persistedDeliverables.length === 3 && persistedDeliverables.every((item) => /^[a-f0-9]{64}$/.test(item.sha256) && existsSync(join(researchDir, "deliverables", item.path))));
	const networkTool = createWebFetchTool({
		fetch: async (request) => ({ finalUrl: request.url, status: 200, headers: { "content-type": "application/json" }, body: Buffer.from('{"items":[]}'), retrievedAt: "2026-08-30T01:01:30Z" }),
	}, evidenceStore);
	toolRegistry.register(networkTool);
	const networkRun = await toolRegistry.execute("web-fetch", { missionId: mission.id, episodeId: "episode-1", nodeId: "literature", allowedCapabilities: ["network"], remainingWallMs: 10_000 }, { url: crossrefWorksUrl("Gutenberg Richter", 5) });
	check("network research tool stores fetched content as evidence", networkRun.receipt.status === "success" && networkRun.receipt.artifactIds.length === 1 && evidenceStore.verify({ ...evidenceRef, id: networkRun.receipt.artifactIds[0]!, sha256: networkRun.receipt.artifactIds[0]!.replace("sha256:", ""), bytes: Buffer.byteLength('{"items":[]}') }));
	check("literature URL builders bound and encode queries", crossrefWorksUrl("a b", 100).includes("rows=50") && openAlexWorksUrl("a b", 0).includes("per-page=1"));
	const environment = captureResearchEnvironment({ gitCommit: "fake", gitDirty: false, configFingerprint: "cfg", strategyFingerprint: "strategy", modelProfileVersion: "profile", modelProfileFingerprint: "profile-hash", pythonPath: "python", pythonPackages: ["numpy==2", "pandas==2"], networkMode: "open", evaluatorMetrics: { private: "v1" }, randomSeeds: [7] }, new Date("2026-08-30T01:02:00Z"));
	const replayClaims = [{ id: "claim-1", text: "The computed estimate is 0.85", status: "supported" as const, evidenceIds: [evidenceRef.id], uncertainty: "bootstrap interval pending", limitations: ["frozen fixture"] }];
	const replayRuntimeAttestation = { version: 1 as const, runMode: "deterministic-demo" as const, unitTestsPassed: true, guardViolations: [], cleanupPassed: true, isolationBackend: "deterministic-test-double" as const, modelCalls: [], familyVerifications: [{ profile: "quantitative-v1", result: quantitativePass, inputHash: "a".repeat(64), evidenceIds: [evidenceRef.id] }], contraryEvidenceLinks: [], totalTokens: 0, wallSeconds: 0 };
	const replayDeliverable = { id: "report", path: "verification.json", sha256: evidenceRef.sha256, bytes: evidenceRef.bytes, required: true };
	const packageManifest = createResearchPackageManifest({ mission: genericMission, graph: genericGraph, eventLedgerRootHash: ledgerRoot, environment, runtimeAttestation: replayRuntimeAttestation, evidence: [evidenceRef], claims: replayClaims, deliverables: [replayDeliverable], now: new Date("2026-08-30T01:03:00Z") });
	const replayInput = { manifest: packageManifest, ledgerPath, mission: genericMission, graph: genericGraph, environment, runtimeAttestation: replayRuntimeAttestation, evidence: [evidenceRef], claims: replayClaims, evidenceStore, readDeliverable: () => evidenceStore.read(evidenceRef), now: new Date("2026-08-30T01:04:00Z") };
	const replayReport = verifyResearchPackage(replayInput);
	check("verify-only research replay validates all manifest commitments", replayReport.passed && replayReport.checks.every((item) => item.passed));
	check("verify-only replay rejects a swapped valid graph", !verifyResearchPackage({ ...replayInput, graph: { ...genericGraph, nodes: genericGraph.nodes.map((node) => ({ ...node, title: node.title + " tampered" })) } }).passed);
	check("verify-only replay rejects changed claims and deliverable bytes", !verifyResearchPackage({ ...replayInput, claims: [{ ...replayClaims[0]!, text: "tampered claim" }] }).passed && !verifyResearchPackage({ ...replayInput, readDeliverable: () => Buffer.from("tampered") }).passed);
	const artifactProblem = join(tmp, "artifact-problem");
	const artifactScratch = join(tmp, "artifact-scratch");
	const artifactDurable = join(tmp, "artifact-durable");
	mkdirSync(join(artifactProblem, "data"), { recursive: true });
	writeFileSync(join(artifactProblem, "data", "input.csv"), "x\n1\n");
	prepareEpisodeArtifacts({ workspace: artifactScratch, requestedWorkspace: artifactDurable, problemDir: artifactProblem });
	check("artifact store prepares only public inputs and toolkit", existsSync(join(artifactScratch, "data", "input.csv")) && existsSync(join(artifactScratch, "georsi_science.py")) && existsSync(join(artifactScratch, "solutions")));
	writeFileSync(join(artifactScratch, "agent-script.py"), "print('untrusted')\n");
	const artifactResult = failedEpisodeResult("artifact", artifactScratch, "test evidence");
	persistEpisodeArtifacts({ workspace: artifactScratch, requestedWorkspace: artifactDurable, problemId: "artifact", result: artifactResult, selectedAnswer: { value: 1 } });
	const durableEntries = readdirSync(artifactDurable).sort();
	check("artifact store persists sanitized evidence only", JSON.stringify(durableEntries) === JSON.stringify(["episode.json", "solutions"]) && existsSync(join(artifactDurable, "solutions", "artifact.json")) && !existsSync(join(artifactDurable, "agent-script.py")));

	const j = new Journal(tmp);
	j.append({ kind: "note", ts: "t", generation: 1, text: "hello" });
	j.append({ kind: "episode", ts: "t", generation: 1, role: "challenger", fitness: 0.5, detail: [] });
	j.close();
	const tail = readJournalTail(tmp);
	check("journal reads back", tail.length === 2 && tail[1]!.fitness === 0.5);
	writeFileSync(join(tmp, "board.jsonl"), readFileSync(join(tmp, "board.jsonl"), "utf8") + '{"kind":"note","ts":"t2",'); // torn tail
	check("torn journal tail tolerated", readJournalTail(tmp).length === 2);

	const st: RunState = {
		version: 1,
		name: "selftest",
		startedAt: "now",
		updatedAt: "now",
		fingerprint: fingerprint(["a", 1]),
		generation: 3,
		champion: s4,
		bestFitness: 0.62,
		fitnessHistory: [0.4, 0.5, 0.62],
		stagnation: 0,
		tokensUsed: 12345,
		finalization: { heldoutCompleted: true, heldoutSummary: "heldout=0.8", completedAt: "now" },
	};
	saveRunState(tmp, st);
	const st2 = loadRunState(tmp);
	check("state roundtrip", st2?.bestFitness === 0.62 && st2?.champion.tips.length === 1 && st2?.finalization?.heldoutCompleted === true);
	check("no tmp files left", !existsSync(join(tmp, "state.json.tmp")));
	check("fingerprint deterministic", fingerprint(["a", 1]) === fingerprint(["a", 1]) && fingerprint(["a", 1]) !== fingerprint(["a", 2]));
	atomicWriteJson(join(tmp, "x.json"), { a: 1 });
	check("atomicWriteJson works", JSON.parse(readFileSync(join(tmp, "x.json"), "utf8")).a === 1);
	const existingRun = join(tmp, "existing-run");
	mkdirSync(existingRun, { recursive: true });
	writeFileSync(join(existingRun, "control.json"), "");
	check("control-only run directory remains reusable", durableRunArtifacts(existingRun).length === 0);
	writeFileSync(join(existingRun, "state.json"), "{}");
	check("durable run artifacts block accidental fresh-name reuse", durableRunArtifacts(existingRun).includes("state.json"));

	console.log("== eval protocol (python) ==");
	const prob: Problem = {
		id: "fake",
		dir: tmp,
		statement: "",
		weight: 1,
		heldout: false,
		genre: "general",
		overrides: {},
	};
	writeFileSync(
		join(tmp, "eval.py"),
		[
			"import argparse, json, os, sys",
			"ap = argparse.ArgumentParser()",
			"ap.add_argument('--submission', required=True)",
			"ap.add_argument('--split', default='private')",
			"a = ap.parse_args()",
			"t = 0.9 if a.split == 'public' else float(open(os.environ['RSILAB_PRIVATE_TRUTH']).read())",
			"b = json.load(open(a.submission))['b']",
			"s = max(0.0, 1 - abs(b - t) / 0.5)",
			"print(f'##SCORE##{s:.4f}')",
			"print(json.dumps({'b': b, 'truth': t}))",
		].join("\n"),
	);
	const truthDir = join(tmp, "private");
	mkdirSync(truthDir, { recursive: true });
	writeFileSync(join(truthDir, "fake.txt"), "0.85\n");
	writeFileSync(join(tmp, "sub.json"), '{"b": 0.80}');
	const pub = await runEval(prob, { pythonCmd: "python", privateTruthDir: truthDir, truthFile: (id) => join(truthDir, `${id}.txt`) }, join(tmp, "sub.json"), "public");
	check("public eval scores", pub.score != null && Math.abs(pub.score - 0.8) < 1e-6, `got ${pub.score}`);
	const priv = await runEval(prob, { pythonCmd: "python", privateTruthDir: truthDir, truthFile: (id) => join(truthDir, `${id}.txt`) }, join(tmp, "sub.json"), "private");
	check("private eval uses truth file", priv.score != null && Math.abs(priv.score - 0.9) < 0.06 + 1e-9, `got ${priv.score}`);
	writeFileSync(join(tmp, "bad.json"), "not json");
	const bad = await runEval(prob, { pythonCmd: "python", privateTruthDir: truthDir, truthFile: (id) => join(truthDir, `${id}.txt`) }, join(tmp, "bad.json"), "public");
	check("invalid submission -> null score", bad.score === null);
	writeFileSync(join(tmp, "eval.py"), "print('##SCORE##2')\n");
	const invalidScore = await runEval(prob, { pythonCmd: "python", privateTruthDir: truthDir, truthFile: (id) => join(truthDir, `${id}.txt`) }, join(tmp, "sub.json"), "public");
	check("out-of-range evaluator score is rejected", invalidScore.score === null);
	const absoluteTruthContext = makeEvalContext({ ...loadConfig(), private_truth_dir: truthDir }, process.cwd());
	check("absolute private truth paths remain absolute", absoluteTruthContext.privateTruthDir === truthDir && absoluteTruthContext.truthFile("toy") === join(truthDir, "toy.txt"));

	console.log("== memory ==");
	const store = openMemory(tmp);
	addMemory(store, { ts: Date.now() - 1000, problem: "quake_b", genre: "seismology", tag: "note", text: "Mc choice matters most", publicScore: 0.8 });
	addMemory(store, { ts: Date.now(), problem: "flood_rp", genre: "hydrology", tag: "note", text: "use L-moments for Gumbel", publicScore: 0.9 });
	const rec = recall(store, "quake_b", "seismology", 2);
	check("recall ranks same problem first", rec[0]?.text === "Mc choice matters most");
	check("render memory non-empty", renderMemory(rec).includes("Mc choice"));
	check("memory labels public evidence as probation", renderMemory(rec).includes("probation") && renderMemory(rec).includes("public-only"));
	check("high public score stays a hypothesis", !defaultObservation("x", 1, false)[0]!.includes("same approach generalizes"));
	const ledger = new TokenLedger();
	ledger.record(17);
	ledger.record(3, true);
	check("token ledger isolates accounting from provider", ledger.total === 20 && ledger.calls === 2 && ledger.failed === 1 && ledger.snapshotValue().total === 20);

	check("trend: improving", deterministicTrend([0.1, 0.2, 0.3, 0.4]) === true);
	check("trend: flat/declining", deterministicTrend([0.5, 0.4, 0.4, 0.3]) === false);
	check("trend: single point defaults on-track", deterministicTrend([0.3]) === true);

	console.log("== board ==");
	const md = renderLeaderboard([{ generation: 1, role: "challenger", fitness: 0.55, mean: 0.55, detail: [{ problem: "quake_b", fitness: 0.55, bestPublic: 0.6, submits: 2, secs: 30, error: null }] }]);
	check("leaderboard renders", md.includes("| 1 | challenger | 0.5500 |") && md.includes("quake_b:0.550"));
	const fmd = renderFindings([{ generation: 2, mechanism: "adds L-moment estimator tip | pipe", expected: "+0.05", fitness: 0.61, accepted: true }]);
	check("findings escapes pipes", fmd.includes("adds L-moment estimator tip / pipe") && fmd.includes("ACCEPTED"));

	console.log("== supported model list ==");
	check("10 models fixed including GeiliAPI Luna", SUPPORTED_MODELS.length === 10);
	const luna = modelSpec("gpt-5.6-luna");
	check("Luna is GeiliAPI Completions with full xhigh mapping", luna?.endpoint === "geiliapi" && luna.api === "openai-completions" && luna.contextWindow === 600000 && luna.maxOutput === 128000 && luna.thinkingLevelMap?.xhigh === "xhigh" && luna.compat?.supportsReasoningEffort === true);
	const lunaCfgPath = join(tmp, "luna-config.json");
	writeFileSync(lunaCfgPath, JSON.stringify({ research_model: { provider: "geiliapi", base_url: "https://sub.geiliapi.com/v1", model: "gpt-5.6-luna", api: "openai-completions", thinking_level: "xhigh", max_tokens_field: "max_completion_tokens", credential_env: "GEILIAPI_API_KEY", fallback: "none", context_window: 600000, max_output: 128000, supports_developer_role: true, supports_reasoning_effort: true, supports_usage: true, supports_tool_loop: true, require_provider_observed_thinking: true }, inner_model: "gpt-5.6-luna", inner_thinking_level: "xhigh", outer_model: "gpt-5.6-luna", outer_thinking_level: "xhigh", quiz_inner_model: "gpt-5.6-luna", single_model_id: "gpt-5.6-luna", single_model_thinking_level: "xhigh", problems: [{ id: "quake_b" }] }));
	const lunaCfg = loadConfig(lunaCfgPath);
	check("Luna-only config exposes one routed model", JSON.stringify(configuredModelIds(lunaCfg, tmp)) === JSON.stringify(["gpt-5.6-luna"]));
	const researchLunaCfg = loadConfig(join(process.cwd(), "config", "research-competition-luna.json"));
	check("research competition config is Luna xhigh open-network GIS", researchLunaCfg.single_model_id === "gpt-5.6-luna" && researchLunaCfg.single_model_thinking_level === "xhigh" && researchLunaCfg.network_mode === "open" && /GeoRSI[\\/]venvs[\\/]gis/i.test(researchLunaCfg.python_cmd));
	let mixedLunaRouteRejected = false;
	try { configuredModelIds({ ...lunaCfg, quiz_inner_model: "hy3" }, tmp); }
	catch (error) { mixedLunaRouteRejected = String(error).includes("single-model policy"); }
	check("Luna-only policy rejects another routed model", mixedLunaRouteRejected);
	let wrongLunaThinkingRejected = false;
	try { configuredModelIds({ ...lunaCfg, outer_thinking_level: "high" }, tmp); }
	catch (error) { wrongLunaThinkingRejected = String(error).includes("outer_thinking_level"); }
	check("Luna-only policy rejects non-xhigh thinking", wrongLunaThinkingRejected);
	const lunaModelsJson = buildModelsJson(lunaCfg, { zen: "unused", local: "unused", openrouter: "unused", emooo: "unused", research: "selftest-placeholder" }, ["gpt-5.6-luna"]) as { providers?: Record<string, { models?: { id?: string; api?: string }[] }> };
	check("provider composition includes only selected research model", Object.keys(lunaModelsJson.providers ?? {}).join(",") === "geiliapi" && lunaModelsJson.providers?.geiliapi?.models?.[0]?.id === "gpt-5.6-luna");
	const priorGeiliKey = process.env.GEILIAPI_API_KEY;
	process.env.GEILIAPI_API_KEY = "selftest-placeholder";
	const lunaJudgeContext = makeEvalContext(lunaCfg, tmp);
	check("research judge uses configured GeiliAPI Completions xhigh and declares non-independence", lunaJudgeContext.judgeEnv?.RSILAB_JUDGE_MODEL === "gpt-5.6-luna" && lunaJudgeContext.judgeEnv.RSILAB_JUDGE_API === "chat-completions" && lunaJudgeContext.judgeEnv.RSILAB_JUDGE_REASONING_EFFORT === "xhigh" && lunaJudgeContext.judgeEnv.RSILAB_JUDGE_INDEPENDENT === "false");
	if (priorGeiliKey === undefined) delete process.env.GEILIAPI_API_KEY;
	else process.env.GEILIAPI_API_KEY = priorGeiliKey;
	const muse = modelSpec("muse-spark-1.2-contributor");
	check("muse is proxy + responses", muse?.route === "proxy" && muse?.api === "openai-responses");
	check("hy3/ox-alpha/mimo direct chat", ["hy3", "ox-alpha-free", "mimo-v2.5"].every((id) => modelSpec(id)?.route === "direct" && modelSpec(id)?.api === "openai-completions"));
	const emoooMimo = modelSpec("mimo-v2.5-pro");
	check("temporary emooo mimo-v2.5-pro is chat + zai thinking", emoooMimo?.endpoint === "emooo" && emoooMimo.route === "direct" && emoooMimo.api === "openai-completions" && emoooMimo.contextWindow === 1048576 && emoooMimo.maxOutput === 131072 && emoooMimo.compat?.thinkingFormat === "zai" && emoooMimo.thinkingLevelMap?.xhigh === "xhigh" && emoooMimo.thinkingLevelMap?.max === null);
	const emoooCfgPath = join(tmp, "emooo-config.json");
	writeFileSync(emoooCfgPath, JSON.stringify({ inner_model: "mimo-v2.5-pro", inner_thinking_level: "xhigh", outer_model: "hy3", outer_thinking_level: "minimal", problems: [{ id: "quake_b" }] }));
	const emoooCfg = loadConfig(emoooCfgPath);
	check("config exposes emooo thinking levels", emoooCfg.inner_thinking_level === "xhigh" && emoooCfg.outer_thinking_level === "minimal");
	const invalidThinkingPath = join(tmp, "invalid-thinking.json");
	writeFileSync(invalidThinkingPath, JSON.stringify({ inner_thinking_level: "turbo", problems: [{ id: "quake_b" }] }));
	let invalidThinkingRejected = false;
	try {
		loadConfig(invalidThinkingPath);
	} catch (error) {
		invalidThinkingRejected = String(error).includes("inner_thinking_level must be one of");
	}
	check("config rejects unknown thinking levels", invalidThinkingRejected);
	const invalidProblemsPath = join(tmp, "invalid-problems.json");
	writeFileSync(invalidProblemsPath, JSON.stringify({ problems: [{ id: "quake_b", weight: 0 }, { id: "quake_b" }] }));
	let invalidProblemsRejected = false;
	try {
		loadConfig(invalidProblemsPath);
	} catch (error) {
		invalidProblemsRejected = /duplicate problem|weight must be/.test(String(error));
	}
	check("config rejects duplicate or non-positive weighted problems", invalidProblemsRejected);
	const retiredQuizRoutePath = join(tmp, "retired-quiz-route.json");
	writeFileSync(retiredQuizRoutePath, JSON.stringify({ quiz_inner_model: "ox-alpha-free", problems: [{ id: "quake_b" }] }));
	let retiredQuizRouteRejected = false;
	try {
		loadConfig(retiredQuizRoutePath);
	} catch (error) {
		retiredQuizRouteRejected = String(error).includes("quiz_inner_model") && String(error).includes("retired");
	}
	check("config validates routed quiz model", retiredQuizRouteRejected);
	check("request token cap rejects invalid overrides", resolveRequestMaxTokens("-1") === 16_384 && resolveRequestMaxTokens("1.5") === 16_384);
	check("request token cap accepts positive integers", resolveRequestMaxTokens("8192") === 8192);
	const dsv4f = modelSpec("dsv4f");
	check("dsv4f is local endpoint", dsv4f?.endpoint === "local" && dsv4f?.route === "direct" && dsv4f?.contextWindow === 262144 && dsv4f?.maxOutput === 65536);
	const glm = modelSpec("z-ai/glm-5.3-flash");
	check("GLM 5.3 Flash is openrouter chat", glm?.endpoint === "openrouter" && glm?.route === "direct" && glm?.api === "openai-completions" && glm.thinkingLevelMap?.max === "max");
	check("hy3 preserves verified xhigh in Pi model map", modelSpec("hy3")?.thinkingLevelMap?.xhigh === "xhigh");
	check("context windows set on all models", SUPPORTED_MODELS.every((m) => m.contextWindow > 0 && m.maxOutput > 0));
	const badCfgPath = join(tmp, "bad-config.json");
	writeFileSync(badCfgPath, JSON.stringify({ inner_model: "deepseek-v4-flash", problems: [{ id: "quake_b" }] }));
	let rejected = false;
	try {
		loadConfig(badCfgPath);
	} catch (e) {
		rejected = (e as Error).message.includes("not in the supported gateway list");
	}
	check("config rejects unsupported model", rejected);
	const retiredCfgPath = join(tmp, "retired-model.json");
	writeFileSync(retiredCfgPath, JSON.stringify({ inner_model: "ox-alpha-free", problems: [{ id: "quake_b" }] }));
	let retiredRejected = false;
	try {
		loadConfig(retiredCfgPath);
	} catch (e) {
		retiredRejected = (e as Error).message.includes("retired by the provider");
	}
	check("config rejects provider-retired model", retiredRejected);
	const retiredOpenRouterPath = join(tmp, "retired-openrouter-model.json");
	writeFileSync(retiredOpenRouterPath, JSON.stringify({ inner_model: "stealth/ox-alpha", problems: [{ id: "quake_b" }] }));
	let retiredOpenRouterRejected = false;
	try {
		loadConfig(retiredOpenRouterPath);
	} catch (e) {
		retiredOpenRouterRejected = (e as Error).message.includes("retired by the provider");
	}
	check("config rejects retired OpenRouter alias", retiredOpenRouterRejected);
	const goodCfg = loadConfig(join(process.cwd(), "config.json"));
	check("config models are supported", !!modelSpec(goodCfg.inner_model) && !!modelSpec(goodCfg.outer_model));
	check("local_base_url present", /^http:\/\/.+\/v1$/.test(goodCfg.local_base_url));
	check("RAG disabled by default", goodCfg.rag_enabled === false && goodCfg.rag_budget_chars === 2400);
	check("fitness mean keeps failed tasks in denominator", meanWithFailures([1, null]) === 0.5);
	check("weighted fitness honors failed task weight", weightedFitnessMean([{ fitness: 1, weight: 1 }, { fitness: null, weight: 3 }]) === 0.25);
	const fakeExecutor: EpisodeExecutor = async (request) => {
		if (request.problem.id === "fail") throw new Error("synthetic episode failure");
		return { ...failedEpisodeResult(request.problem.id, request.workspace, "unused"), fitness: 1, bestPublic: 0.8, error: null };
	};
	const fakeEvalContext = { pythonCmd: "python", privateTruthDir: truthDir, truthFile: (id: string) => join(truthDir, `${id}.txt`) };
	const portEvaluation = await evaluateScaffold({
		cfg: { ...goodCfg, episodes_per_problem: 1 },
		problems: [{ ...prob, id: "ok", weight: 1 }, { ...prob, id: "fail", weight: 3 }],
		scaffold: SEED_SCAFFOLD,
		runDir: tmp,
		role: "fake-port",
		model: {} as never,
		memory: emptyMemory(join(tmp, "fake-memory")),
		executeEpisode: fakeExecutor,
		evalCtx: fakeEvalContext,
	});
	check("episode executor port keeps thrown task in weighted denominator", portEvaluation.mean === 0.25 && portEvaluation.detail.length === 2 && portEvaluation.detail[1]?.fitness === null);
	const allFailedPortEvaluation = await evaluateScaffold({
		cfg: { ...goodCfg, episodes_per_problem: 1 }, problems: [{ ...prob, id: "fail" }],
		scaffold: SEED_SCAFFOLD, runDir: tmp, role: "fake-all-fail", model: {} as never,
		memory: emptyMemory(join(tmp, "fake-memory-all")), executeEpisode: fakeExecutor, evalCtx: fakeEvalContext,
	});
	check("episode executor port keeps all-failed suite ineligible", allFailedPortEvaluation.mean === null);
	const failedContract = failedEpisodeResult("p", "workspace", new Error("boom"));

	check("episode failure factory preserves fixed-denominator contract", failedContract.problemId === "p" && failedContract.fitness === null && failedContract.knowledgeIds.length === 0 && failedContract.error?.includes("boom") === true);
	const failedExam: ExamProblemResult[] = [{ problem: "quake_b", heldout: false, weight: 1, fitness: null, bestPublic: null, submits: 0, secs: 0, error: "failed", warnings: [], tokens: 0 }];

	check("all-error standalone exam is not successful", !examHasValidTrainingResult(failedExam));
	check("standalone exam succeeds only with valid training fitness", examHasValidTrainingResult([{ ...failedExam[0]!, fitness: 0 }]));
	const examWrites = new Map<string, unknown>();
	const examDirs: string[] = [];
	const fakeExamStore: ExamEvidenceStore = {
		ensureDir: (path) => examDirs.push(path),
		writeText: (path, content) => examWrites.set(path, content),
		writeJson: (path, value) => examWrites.set(path, value),
	};
	const examProblems = [
		{ ...prob, id: "exam-train", heldout: false, weight: 2 },
		{ ...prob, id: "exam-heldout", heldout: true, weight: 1 },
	];
	const fakeExamExecutor: EpisodeExecutor = async (request) => {
		if (request.problem.heldout) throw new Error("synthetic heldout failure");
		return { ...failedEpisodeResult(request.problem.id, request.workspace, "unused"), fitness: 0.6, bestPublic: 0.7, error: null, secs: 1.4, tokens: 12 };
	};
	const examPorts = {
		loadRuntime: async () => ({ inner: {} as never, problems: examProblems, evalCtx: fakeEvalContext }),
		executeEpisode: fakeExamExecutor,
		tokenTotal: () => 0,
		now: () => new Date("2026-08-30T12:00:00Z"),
		gitSnapshot: () => ({ commit: "fake-commit", dirty: false }),
		profileEvidence: () => ({ version: "fake-profile", fingerprint: "fake-fingerprint" }),
		gradingAssets: (problem: { id: string }) => ({ [`${problem.id}/eval.py`]: "fake-hash" }),
		evidenceStore: fakeExamStore,
	};
	const examPortRunDir = join(tmp, "exam-port-run");
	const portExam = await runExam({ ...goodCfg, episodes_per_problem: 1 }, SEED_SCAFFOLD, "fake", examPortRunDir, () => {}, examPorts);
	const capturedExamReport = examWrites.get(join(examPortRunDir, "exam-report.json")) as { generatedAt?: string; git?: { commit?: string }; profileVersion?: string } | undefined;
	check("standalone exam runs through injected runtime and executor", portExam.results.length === 2 && portExam.trainMean === 0.6 && portExam.heldoutMean === 0 && !portExam.complete);
	check("standalone exam recovers injected executor errors", portExam.results[1]?.fitness === null && portExam.results[1]?.error?.includes("synthetic heldout failure") === true);
	check("exam evidence store captures deterministic metadata", examDirs.includes(examPortRunDir) && capturedExamReport?.generatedAt === "2026-08-30T12:00:00.000Z" && capturedExamReport.git?.commit === "fake-commit" && capturedExamReport.profileVersion === "fake-profile");
	examWrites.clear();
	const heldoutPortExam = await runHeldoutExam(
		{ ...goodCfg, episodes_per_problem: 1 },
		"selftest-port-heldout",
		SEED_SCAFFOLD,
		() => {},
		undefined,
		{
			...examPorts,
			executeEpisode: async (request) => ({ ...failedEpisodeResult(request.problem.id, request.workspace, "unused"), fitness: 0.75, bestPublic: 0.7, error: null }),
		},
	);
	check("held-out exam filters runtime problems and uses injected executor", heldoutPortExam.results.length === 1 && heldoutPortExam.results[0]?.problem === "exam-heldout" && heldoutPortExam.heldoutMean === 0.75 && heldoutPortExam.complete);
	check("held-out exam writes through injected evidence store", [...examWrites.keys()].some((path) => path.endsWith("heldout-report.json")));
	check("submit budget is positive", goodCfg.eval_cap > 0);
	const proposalA = { angle: "a" } as Proposal;
	const proposalB = { angle: "b" } as Proposal;
	const proposalC = { angle: "c" } as Proposal;
	const limited = selectTopSurvivors(
		[proposalA, proposalB, proposalC],
		[proposalA, proposalB, proposalC],
		[
			{ index: 0, quality: 6, keepVotes: 1 },
			{ index: 1, quality: 9, keepVotes: 1 },
			{ index: 2, quality: 7, keepVotes: 1 },
		],
		1,
	);
	check("survivor limit keeps the highest-quality proposal", limited.length === 1 && limited[0] === proposalB);

	console.log("== quiz grader (python) ==");
	const graderOut = execFileSync("python", ["scripts/quiz_selftest.py"], { encoding: "utf-8", timeout: 60_000 });
	check("quiz grader unit tests pass", graderOut.includes("GRADER_OK"), graderOut.slice(-200));

	console.log("== suite structure (python) ==");
	const structOut = execFileSync("python", ["scripts/struct_selftest.py"], { encoding: "utf-8", timeout: 120_000 });
	check("suite structure checks pass", structOut.includes("STRUCT_OK"), structOut.slice(-400));

	console.log("== knowledge base ==");
	const { loadKnowledge, selectKnowledge, renderKnowledge, KNOWLEDGE_CHAR_BUDGET } = await import("./knowledge.js");
	const kb = loadKnowledge();
	check("knowledge nodes load", kb.length >= 5, `got ${kb.length}`);
	const ksel1 = selectKnowledge(kb, { genre: "quiz-k2", id: "k2_c001" });
	const ksel2 = selectKnowledge(loadKnowledge(), { genre: "quiz-k2", id: "k2_c001" });
	check(
		"knowledge selection deterministic",
		JSON.stringify(ksel1.nodes.map((n) => n.id)) === JSON.stringify(ksel2.nodes.map((n) => n.id)) &&
			ksel1.version === ksel2.version,
	);
	const krender = renderKnowledge(ksel1);
	check("knowledge render within budget", krender.length <= KNOWLEDGE_CHAR_BUDGET + 200, `${krender.length} chars`);
	const { deriveTags } = await import("./knowledge.js");
	const ktags = deriveTags("quiz-k2", "k2_c001");
	check(
		"knowledge routes by region",
		ksel1.nodes.length > 0 && ksel1.nodes.some((n) => n.tags.some((t) => ktags.includes(t))),
		`tags=${ktags.join(",")} picked=${ksel1.nodes.map((n) => n.id).join(",")}`,
	);
	const probationNode = {
		id: "selftest-probation",
		text: "probation lesson",
		tags: ["quiz-k2"],
		scope: "regional" as const,
		stats: { uses: 0, wins: 0, fitness_sum: 0 },
		origin: { run: "selftest", gen: 0 },
		status: "probation" as const,
	};
	const previousProbationFlag = process.env.RSILAB_KB_INCLUDE_PROBATION;
	delete process.env.RSILAB_KB_INCLUDE_PROBATION;
	const probationHidden = selectKnowledge([probationNode], { genre: "quiz-k2", id: "k2_c001" });
	process.env.RSILAB_KB_INCLUDE_PROBATION = "1";
	const probationIncluded = selectKnowledge([probationNode], { genre: "quiz-k2", id: "k2_c001" });
	if (previousProbationFlag === undefined) delete process.env.RSILAB_KB_INCLUDE_PROBATION;
	else process.env.RSILAB_KB_INCLUDE_PROBATION = previousProbationFlag;
	check("probation knowledge requires explicit pilot flag", probationHidden.nodes.length === 0 && probationIncluded.nodes.length === 1);

	console.log("== RAG ==");
	const corpus = loadCorpus();
	check("RAG corpus loads", corpus.length >= 5, `got ${corpus.length}`);
	check(
		"RAG corpus metadata complete",
		corpus.every((d) => d.id && d.region && d.source && d.license),
	);
	check(
		"RAG corpus excludes benchmark truth markers",
		corpus.every((d) => !/(answers\.private|reasoning_chain|gold answer|private truth)/i.test(d.text)),
	);
	const k2Regions = regionsForTask("quiz-k2", "k2_c008");
	const stepRegions = regionsForTask("quiz-stepgame", "stepgame_c005");
	check("RAG routes K2 to formula region", k2Regions.includes("geoscience_formulas"));
	check("RAG routes StepGame to spatial region", stepRegions.includes("spatial_reasoning"));
	const terms = queryTermsFromStatement("Use UTM coordinates to measure distance");
	check("RAG query terms are normalized", terms.includes("utm") && terms.includes("coordinates"));
	const mapDocs = retrieve(["map_projection"], ["utm", "coordinates"], 900);
	const mapChars = mapDocs.reduce((n, d) => n + d.text.length, 0);
	check("RAG retrieval is region-scoped", mapDocs.length > 0 && mapDocs.every((d) => d.region === "map_projection"));
	check("RAG retrieval respects char budget", mapChars <= 900, `${mapChars} chars`);
	check("RAG render non-empty", renderRetrieved(mapDocs).includes("Reference material retrieved"));
	check("RAG skips an oversized first document", retrieve(["map_projection"], ["utm"], 100).length === 0);

	console.log("== model profiles ==");
	const { loadProfiles, resolveThinking, assertVisionAllowed, getProfile } = await import("./models.js");
	loadProfiles();
	check("model profiles parse", !!getProfile("hy3") && !!getProfile("dsv4f") && !!getProfile("mimo-v2.5-pro"));
	const oxA = getProfile("stealth/ox-alpha");
	check("retired OpenRouter alias profile preserved", oxA.vision_raw_api === true);
	const glmProfile = getProfile("z-ai/glm-5.3-flash");
	check("GLM 5.3 Flash profile loaded", glmProfile.vision_raw_api === true && !!glmProfile.reasoning.mandatory);
	const emoooProfile = getProfile("mimo-v2.5-pro");
	check("emooo profile records zai thinking levels", emoooProfile.endpoint === "emooo" && emoooProfile.api_style === "chat-completions" && emoooProfile.reasoning.thinking_format === "zai" && emoooProfile.reasoning.verified_disabled === true && emoooProfile.reasoning.verified_real_levels?.length === 5);
	check(
		"supported model registry matches profile endpoints and APIs",
		SUPPORTED_MODELS.every((model) => {
			const profile = getProfile(model.id);
			return profile.endpoint === model.endpoint && profile.api_style === (model.api === "openai-responses" ? "responses" : "chat-completions");
		}),
	);
	const rHy3Max = resolveThinking("hy3", "max");
	check("hy3 max clamps to real ceiling xhigh", rHy3Max.level === "xhigh" && rHy3Max.clamped);
	check("ox-alpha-free high clamps to trusted medium", resolveThinking("ox-alpha-free", "high").level === "medium");
	const rDsv = resolveThinking("dsv4f", "max");
	check("dsv4f deep thinking uses thinking_budget", (rDsv.extraBody as Record<string, unknown>).thinking_budget === 16384);
	check(
		"muse strips reasoning params",
		Object.keys(resolveThinking("muse-spark-1.2-contributor", "high").extraBody).length === 0,
	);
	check("emooo off remains a disable request", resolveThinking("mimo-v2.5-pro", "off").level === "off");
	const emoooMax = resolveThinking("mimo-v2.5-pro", "max");
	check("emooo max clamps to xhigh", emoooMax.level === "xhigh" && emoooMax.clamped);
	const lunaXhigh = resolveThinking("gpt-5.6-luna", "xhigh");
	check("Luna xhigh remains exact and emits reasoning effort", lunaXhigh.level === "xhigh" && !lunaXhigh.clamped && lunaXhigh.extraBody.reasoning_effort === "xhigh");
	let visionBlocked = false;
	try {
		assertVisionAllowed("dsv4f", true);
	} catch {
		visionBlocked = true;
	}
	check("vision gate blocks unsupported model", visionBlocked);
	assertVisionAllowed("ox-alpha-free", true); // raw API supports images - must not throw

	console.log("== anti-cheat guard ==");
	const { scanWorkspaceForBreaches, scanWorkspaceForBreachesStrict, scanPythonExecutionPolicy } = await import("./guard.js");
	const { resolveInWorkspace } = await import("./inner/solve.js");
	const guardDir = join(tmp, "guard");
	mkdirSync(join(guardDir, "data"), { recursive: true });
	writeFileSync(join(guardDir, "clean.py"), "print('hello')\n");
	writeFileSync(join(guardDir, "data", "quiz.jsonl"), '{"qid":"q1"}\n'); // copied inputs are exempt
	const noBreach = scanWorkspaceForBreaches(guardDir);
	writeFileSync(join(guardDir, "cheat.py"), 'open("../../problems/k2_c001/answers.private.jsonl")\n');
	const breach = scanWorkspaceForBreaches(guardDir);
	check("guard passes clean workspace", noBreach.length === 0);
	check("guard detects gold-path access", breach.length === 1 && breach[0].file === "cheat.py");
	const strictSweep = scanWorkspaceForBreachesStrict(guardDir);
	check("competition guard sweep is strict and reports breaches", strictSweep.errors.length === 0 && strictSweep.breaches.length === 1 && strictSweep.breaches[0]?.file === "cheat.py");
	check("workspace fence contains relative paths", resolveInWorkspace(guardDir, "sub/a.py") !== null && resolveInWorkspace(guardDir, "a.py") !== null);
	check("workspace fence blocks traversal", resolveInWorkspace(guardDir, "../escape.py") === null && resolveInWorkspace(guardDir, "../../problems/x/answers.private.jsonl") === null);
	const { runPythonHost } = await import("./inner/solve.js");
	const hostAuditScript = join(guardDir, "host-audit.py");
	writeFileSync(hostAuditScript, "print('host-audit-ok')\n");
	const hostAuditResult = await runPythonHost(guardDir, loadConfig().python_cmd, hostAuditScript, 5_000);
	check("explicit host-audit Python runner works", hostAuditResult.includes("exit=0") && hostAuditResult.includes("host-audit-ok"));
	let capturedForegroundRequest: ForegroundPythonRequest | undefined;
	const recordedForegroundPids: number[] = [];
	const removedForegroundWrappers: string[] = [];
	const foregroundRunner = new ForegroundPythonRunner({
		workspace: guardDir,
		pythonCmd: "python-test",
		now: () => 12345,
		port: {
			execute: async (request) => {
				capturedForegroundRequest = request;
				return { exitCode: null, timedOut: true, stdout: "tail-out", stderr: "tail-err", targetPids: [71, 72], wrapperPath: "wrapper.cmd" };
			},
		},
		recordTargetPids: (pids) => recordedForegroundPids.push(...pids),
		removeWrapper: (path) => removedForegroundWrappers.push(path),
	});
	const foregroundText = await foregroundRunner.run(hostAuditScript, 321);
	check("foreground Python runner injects evidence paths and deadline", capturedForegroundRequest?.timeoutMs === 321 && capturedForegroundRequest.stdoutPath.endsWith(join("runtime", "001-9ix.stdout.log")));
	check("foreground Python runner records strict pids and removes wrapper", recordedForegroundPids.join(",") === "71,72" && removedForegroundWrappers[0] === "wrapper.cmd");
	check("foreground Python runner formats timeout and stderr", foregroundText.includes("[execution timed out]") && foregroundText.includes("tail-out") && foregroundText.includes("tail-err"));
	check("foreground Python formatter preserves start errors", formatForegroundPythonResult({ exitCode: null, timedOut: false, stdout: "", stderr: "", error: "missing", startError: true }) === "failed to start python: missing");

	const { protectedManifest, verifyManifest, scanTextForBreaches } = await import("./guard.js");
	const fakeProblem = join(tmp, "fakeproblem");
	mkdirSync(join(fakeProblem, "reference"), { recursive: true });
	writeFileSync(join(fakeProblem, "eval.py"), "print(1)\n");
	writeFileSync(join(fakeProblem, "reference", "solution.py"), "x = 1\n");
	const externalTruth = join(tmp, "external-truth.txt");
	writeFileSync(externalTruth, "0.75\n");
	const manifest = protectedManifest(fakeProblem, [externalTruth]);
	check("manifest hashes grading assets", Object.keys(manifest).length === 4 && Object.keys(manifest).some((key) => key.startsWith("__directory__:")));
	check("manifest verifies untouched dir", verifyManifest(fakeProblem, manifest).length === 0);
	writeFileSync(join(fakeProblem, "eval.py"), "print(2)\n");
	check("manifest detects eval.py tampering", verifyManifest(fakeProblem, manifest).includes("eval.py"));
	writeFileSync(join(fakeProblem, "reference", "extra.txt"), "new hidden asset\n");
	check("manifest detects new grading asset", verifyManifest(fakeProblem, manifest).some((file) => file.includes("directory-listing")));
	writeFileSync(externalTruth, "0.8\n");
	check("manifest detects external truth tampering", verifyManifest(fakeProblem, manifest).includes(externalTruth));
	const toolBreaches = scanTextForBreaches("tool_execution_start read file=../../problems/k2_c001/answers.private.jsonl");
	const policyBreaches = scanPythonExecutionPolicy(
		"import subprocess\nimport urllib.request\nos.system('echo risky')",
		"analysis.py",
	);
	check("execution policy flags common escape hatches", policyBreaches.length === 3 && policyBreaches[0]?.rule === "child-process import");
	const restrictedScript = join(guardDir, "restricted-policy.py");
	writeFileSync(restrictedScript, "import subprocess\nsubprocess.run(['echo', 'x'])\n");
	const restrictedPolicy = checkPythonExecutionPolicy(restrictedScript, "restricted-policy.py", "restricted");
	check("python execution policy adapter blocks restricted escape", restrictedPolicy.blocked && restrictedPolicy.notice.includes("restricted execution policy"));
	const fakeStatuses = new Map<string, { state?: unknown; exitCode?: unknown }>();
	const fakeAlive = new Set<number>([42]);
	const terminated: number[] = [];
	let fakeNow = 1_000;
	const fakeJobPort: BackgroundJobPort = {
		now: () => fakeNow,
		writeStatus: (job) => fakeStatuses.set(job.name, { state: job.state, exitCode: job.exitCode }),
		readLogTail: () => "tail",
		isAlive: (pid) => fakeAlive.has(pid),
		terminate: (pid) => { terminated.push(pid); fakeAlive.delete(pid); },
	};
	const jobRegistry = new BackgroundJobRegistry(fakeJobPort, 100);
	const fakeJob: BackgroundJob = { name: "job", file: "x.py", pid: 42, startedAt: fakeNow, state: "running", exitCode: null, sandboxTargetPids: [43] };
	jobRegistry.register(fakeJob);
	fakeNow += 101;
	jobRegistry.refresh(fakeJob);
	check("background job state machine times out and verifies all pids", fakeJob.state === "timeout" && fakeJob.killVerified === true && terminated.includes(42) && terminated.includes(43));
	const terminatedAfterTimeout = terminated.length;
	jobRegistry.kill(fakeJob, "killed");
	check("background job state machine never signals terminal pid", terminated.length === terminatedAfterTimeout && fakeJob.state === "timeout");
	check("background job status rendering is adapter-backed", jobRegistry.statusText().includes("[job] timeout") && jobRegistry.statusText().includes("tail"));


	check("genre guess", guessGenre("quake_b") === "seismology" && guessGenre("flood_rp") === "hydrology" && guessGenre("poro_perm") === "petrophysics");

	console.log("== Sandboxie adapter logic ==");
	const {
		sanitizeSandboxieBoxName,
		makeSandboxieBoxName,
		resolveExchangeWorkspace,
		sandboxieRootCommandArgs,
		sandboxieDeleteCommandArgs,
		sandboxieRulePaths,
		sandboxieSettingValuesMatch,
		assertSandboxPythonCommand,
		isSandboxieBackend,
		sanitizeSandboxEnvironment,
	} = await import("./sandboxie.js");
	check("Sandboxie box names are strict ASCII", sanitizeSandboxieBoxName("bad/name DefaultBox") === "bad_name_DefaultBox");
	const cliProbe = new SandboxieCli(5_000).runSync(process.execPath, ["-e", "process.stdout.write('cli-ok')"]);
	check("Sandboxie CLI adapter captures sync command output", cliProbe.code === 0 && cliProbe.stdout === "cli-ok");
	check("Sandboxie CLI command rendering quotes whitespace", formatSandboxieCommand("C:/Program Files/tool.exe", ["query", "a b"]).includes('"C:/Program Files/tool.exe"') && formatSandboxieCommand("x", ["a b"]).includes('"a b"'));
	const iniCommands: string[][] = [];
	const fakeIniCli = {
		run: async (_file: string, args: readonly string[]) => ({ code: 0, stdout: args[0] === "query" ? "a\r\nb\r\n" : "", stderr: "" }),
		runSync: (_file: string, args: readonly string[]) => { iniCommands.push([...args]); return { code: 0, stdout: "", stderr: "" }; },
	} as unknown as SandboxieCli;
	const iniAdapter = new SandboxieIni(fakeIniCli, "SbieIni.exe");
	check("Sandboxie INI adapter parses query output", JSON.stringify(await iniAdapter.queryRaw("Box", "Setting")) === JSON.stringify(["a", "b"]));
	iniAdapter.restoreSync("GlobalSettings", "NetworkEnableWFP", ["y", "n"]);
	check("Sandboxie INI adapter preserves multi-value restore order", iniCommands[0]?.join("|") === "set|GlobalSettings|NetworkEnableWFP|y" && iniCommands[1]?.join("|") === "append|GlobalSettings|NetworkEnableWFP|n");
	let failedRestoreCalls = 0;
	const failingSyncIni = new SandboxieIni({
		run: async () => ({ code: 1, stdout: "", stderr: "failed" }),
		runSync: () => { failedRestoreCalls += 1; return { code: 1, stdout: "", stderr: "failed" }; },
	} as unknown as SandboxieCli, "SbieIni.exe");
	failingSyncIni.restoreSync("GlobalSettings", "NetworkEnableWFP", ["y", "n"]);
	check("Sandboxie sync INI restore stops after first failure", failedRestoreCalls === 1);
	check("Sandboxie WFP read-back preserves exact enabled multi-values", sandboxieSettingValuesMatch(["y", "n"], ["y", "n"]) && !sandboxieSettingValuesMatch(["y"], ["y", "n"]));
	let cleanupState = initialSandboxieCleanupState();
	cleanupState = advanceSandboxieCleanup(cleanupState, { type: "termination", ok: true });
	cleanupState = advanceSandboxieCleanup(cleanupState, { type: "data-deletion", ok: true });
	cleanupState = advanceSandboxieCleanup(cleanupState, { type: "config-removal", ok: true });
	cleanupState = advanceSandboxieCleanup(cleanupState, { type: "global-wfp-write", ok: true });
	cleanupState = advanceSandboxieCleanup(cleanupState, { type: "reload", ok: true });
	check("Sandboxie cleanup cannot release before both read-backs", !sandboxieCleanupReadyForLease(cleanupState));
	cleanupState = advanceSandboxieCleanup(cleanupState, { type: "read-back", globalWfpRestored: true, boxReadbackVerified: true, boxStillEnabled: false });
	check("Sandboxie cleanup releases only after complete evidence", cleanupState.stage === "release-lease" && sandboxieCleanupReadyForLease(cleanupState));
	cleanupState = advanceSandboxieCleanup(cleanupState, { type: "lease-release", ok: true });
	check("Sandboxie cleanup complete result preserves all gates", cleanupState.stage === "complete" && sandboxieCleanupResult(cleanupState).leaseReleased);
	let uncertainCleanup = initialSandboxieCleanupState();
	uncertainCleanup = advanceSandboxieCleanup(uncertainCleanup, { type: "termination", ok: true });
	uncertainCleanup = advanceSandboxieCleanup(uncertainCleanup, { type: "data-deletion", ok: true });
	uncertainCleanup = advanceSandboxieCleanup(uncertainCleanup, { type: "config-removal", ok: true });
	uncertainCleanup = advanceSandboxieCleanup(uncertainCleanup, { type: "global-wfp-write", ok: true });
	uncertainCleanup = advanceSandboxieCleanup(uncertainCleanup, { type: "reload", ok: true });
	uncertainCleanup = advanceSandboxieCleanup(uncertainCleanup, { type: "read-back", globalWfpRestored: true, boxReadbackVerified: false, boxStillEnabled: false, errors: ["query failed"] });
	check("Sandboxie cleanup treats failed box read-back as enabled and blocks lease", uncertainCleanup.stage === "blocked" && uncertainCleanup.boxStillEnabled && !uncertainCleanup.leaseReleased);
	let invalidCleanupTransitionRejected = false;
	try { advanceSandboxieCleanup(initialSandboxieCleanupState(), { type: "data-deletion", ok: true }); }
	catch { invalidCleanupTransitionRejected = true; }
	check("Sandboxie cleanup rejects out-of-order transitions", invalidCleanupTransitionRejected);
	const verifiedPartialCleanup = {
		globalWfpSnapshotCaptured: true,
		removedConfig: true,
		globalWfpWriteSucceeded: true,
		reloaded: true,
		globalWfpRestored: true,
		boxReadbackVerified: true,
		boxStillEnabled: false,
	};
	check("Sandboxie partial cleanup releases only after snapshot and read-backs", sandboxiePartialCleanupReadyForLease(verifiedPartialCleanup));
	check("Sandboxie partial cleanup retains lease after failed box query", !sandboxiePartialCleanupReadyForLease({ ...verifiedPartialCleanup, boxReadbackVerified: false }));
	check("Sandboxie partial cleanup retains lease without WFP snapshot", !sandboxiePartialCleanupReadyForLease({ ...verifiedPartialCleanup, globalWfpSnapshotCaptured: false }));
	const leasePath = join(tmp, "sandboxie-test.lock");
	const leaseManager = new SandboxieGlobalLease(leasePath, 1234, () => new Date("2026-08-30T00:00:00Z"));
	const leaseHandle = leaseManager.acquire("GeoRSI_test");
	let duplicateLeaseRejected = false;
	try { new SandboxieGlobalLease(leasePath, 5678).acquire("GeoRSI_other"); }
	catch (error) { duplicateLeaseRejected = String(error).includes("pid=1234") && String(error).includes("GeoRSI_test"); }
	check("Sandboxie WFP lease rejects concurrent owner with diagnostics", duplicateLeaseRejected);
	check("Sandboxie WFP lease rejects wrong token", !leaseManager.release(leaseHandle.path, "wrong-token") && existsSync(leasePath));
	check("Sandboxie WFP lease releases only matching owner token", leaseManager.release(leaseHandle.path, leaseHandle.token) && !existsSync(leasePath));
	check("generated box names retain the GeoRSI separator", /^GeoRSI_[0-9a-f]{16}$/.test(makeSandboxieBoxName("selftest")));
	check("Sandboxie box names are length bounded", sanitizeSandboxieBoxName("x".repeat(100)).length <= 38);
	const exchange = resolveExchangeWorkspace(join(process.cwd(), "runs", "demo", "episodes", "tag"));
	check("strict exchange workspace leaves repository", !exchange.toLowerCase().startsWith(process.cwd().toLowerCase()));
	const blockedNetworkRules = sandboxieRulePaths(process.cwd(), join(process.cwd(), "..", "rsi-lab-private"), exchange);
	const openNetworkRules = sandboxieRulePaths(process.cwd(), join(process.cwd(), "..", "rsi-lab-private"), exchange, "open");
	check("Sandboxie network modes preserve file denies while changing egress", blockedNetworkRules.networkAccess === "*,Block" && openNetworkRules.networkAccess === "*,Allow" && blockedNetworkRules.closedFilePaths.join("|") === openNetworkRules.closedFilePaths.join("|"));
	check("open-network rules close netrc config and browser credential stores", ["_netrc", ".config", "Chrome", "Edge", "Firefox"].every((name) => openNetworkRules.closedFilePaths.some((path) => path.toLowerCase().includes(name.toLowerCase()))));
	const rootArgs = sandboxieRootCommandArgs("GeoRSI_test", "python.exe", "C:/tmp/runner.py");
	check("/box root command does not misuse /fcp", rootArgs[0] === "/box:GeoRSI_test" && !rootArgs.includes("/fcp"));
	check("delete sandbox uses command token", sandboxieDeleteCommandArgs("GeoRSI_test")[1] === "delete_sandbox_silent");
	check("Windows defaults to Sandboxie backend", isSandboxieBackend({} as import("./config.js").Config) === (process.platform === "win32"));
	check("explicit host-audit override disables Sandboxie", !isSandboxieBackend({ execution_backend: "host-audit" } as import("./config.js").Config));
	check("explicit sandboxie override enables backend", isSandboxieBackend({ execution_backend: "sandboxie" } as import("./config.js").Config));
	const perProblemCfg = Object.assign({ execution_backend: "sandboxie" }, { execution_backend: "host-audit" });
	check("per-problem host-audit override wins", !isSandboxieBackend(perProblemCfg as import("./config.js").Config));
	let interpreterBoundaryRejected = false;
	try {
		assertSandboxPythonCommand(join(process.cwd(), "fake-venv", "Scripts", "python.exe"), [process.cwd()]);
	} catch {
		interpreterBoundaryRejected = true;
	}
	check("strict Sandboxie rejects repo-local interpreters", interpreterBoundaryRejected);
	const cleanEnv = sanitizeSandboxEnvironment({ RSILAB_API_KEY: "secret", OPENAI_API_KEY: "secret", AWS_ACCESS_KEY_ID: "secret", GITHUB_TOKEN: "secret", HTTP_PROXY: "proxy", SSH_AUTH_SOCK: "pipe", KUBECONFIG: "config", SAFE_VALUE: "ok" });
	check("agent environment strips credentials and proxies", !cleanEnv.RSILAB_API_KEY && !cleanEnv.OPENAI_API_KEY && !cleanEnv.AWS_ACCESS_KEY_ID && !cleanEnv.GITHUB_TOKEN && !cleanEnv.HTTP_PROXY && !cleanEnv.SSH_AUTH_SOCK && !cleanEnv.KUBECONFIG && cleanEnv.SAFE_VALUE === "ok");
	const { createExchangeToolDefinitions, assertExchangeWorkspace } = await import("./workspace-tools.js");
	const exchangeTools = createExchangeToolDefinitions(guardDir);
	check(
		"official pi tools are exchange-wrapped",
		["read", "write", "edit", "ls", "grep"].every((name) => exchangeTools.some((tool) => tool.name === name)),
	);
	const { shouldAttachExchangeTools, resolveHarnessThinking } = await import("./piharness.js");
	check("Pi harness preserves emooo max clamp as xhigh", resolveHarnessThinking(modelSpec("mimo-v2.5-pro") as never, "max") === "xhigh");
	check("Pi harness preserves Luna xhigh without downgrade", resolveHarnessThinking(modelSpec("gpt-5.6-luna") as never, "xhigh") === "xhigh");
	check("Pi harness preserves GLM max", resolveHarnessThinking(modelSpec("z-ai/glm-5.3-flash") as never, "max") === "max");
	let dsvDeepRejected = false;
	try {
		resolveHarnessThinking(modelSpec("dsv4f") as never, "max");
	} catch (error) {
		dsvDeepRejected = String(error).includes("thinking_budget") && String(error).includes("cannot serialize");
	}
	check("Pi harness rejects unsupported dsv4f budget translation", dsvDeepRejected);
	check("inner harness opts into exchange tools", shouldAttachExchangeTools(undefined));
	check("advisor harness with builtinTools=[] has no exchange tools", !shouldAttachExchangeTools([]));
	check("exchange tool opt-in can be explicit", shouldAttachExchangeTools([], true) && !shouldAttachExchangeTools(undefined, false));
	let outsideToolRejected = false;
	try {
		const writeTool = exchangeTools.find((tool) => tool.name === "write")!;
		await writeTool.execute("selftest", { path: "../outside-tool.txt", content: "x" }, undefined, undefined, undefined as never);
	} catch {
		outsideToolRejected = true;
	}
	check("official write tool rejects traversal", outsideToolRejected);
	let danglingRejected = false;
	let danglingSupported = false;
	try {
		const dangling = join(guardDir, "dangling-link.txt");
		symlinkSync(join(tmp, "does-not-exist.txt"), dangling, "file");
		danglingSupported = true;
		const writeTool = exchangeTools.find((tool) => tool.name === "write")!;
		try {
			await writeTool.execute("selftest", { path: "dangling-link.txt", content: "x" }, undefined, undefined, undefined as never);
		} catch {
			danglingRejected = true;
		}
	} catch {
		/* symlink creation may require elevated Windows developer settings */
	}
	check("official write tool rejects dangling symlinks", !danglingSupported || danglingRejected, danglingSupported ? "" : "symlink creation unavailable; skipped");
	let existingReparseRejected = false;
	try {
		const target = join(guardDir, "inside-target.txt");
		const link = join(guardDir, "inside-link.txt");
		writeFileSync(target, "inside");
		symlinkSync(target, link, "file");
		const readTool = exchangeTools.find((tool) => tool.name === "read")!;
		try {
			await readTool.execute("selftest", { path: "inside-link.txt" }, undefined, undefined, undefined as never);
		} catch {
			existingReparseRejected = true;
		}
	} catch {
		existingReparseRejected = true; // symlink creation unavailable is already covered above
	}
	check("official tools reject existing reparse components", existingReparseRejected);
	const backgroundGuardTools = createExchangeToolDefinitions(guardDir, () => {
		throw new Error("background job active");
	});
	let backgroundGuardRejected = false;
	try {
		const readTool = backgroundGuardTools.find((tool) => tool.name === "read")!;
		await readTool.execute("selftest", { path: "clean.py" }, undefined, undefined, undefined as never);
	} catch (error) {
		backgroundGuardRejected = String(error).includes("background job active");
	}
	check("exchange operation guard can block concurrent background jobs", backgroundGuardRejected);
	let overlapRejected = false;
	try {
		assertExchangeWorkspace(guardDir, guardDir, join(tmp, "private"));
	} catch {
		overlapRejected = true;
	}
	check("exchange workspace rejects protected overlap", overlapRejected);


	const { applyEdits: applyEdits2, composeSystemPrompt: compose2 } = await import("./scaffold.js");
	const SEED2 = SEED_SCAFFOLD;
	const scoped = applyEdits2(SEED2, [
		{ op: "add_tip", text: "spatial-solver discipline", genres: ["quiz-stepgame"] },
		{ op: "add_tip", text: "universal discipline" },
	]);
	const forStep = compose2(scoped, "quiz-stepgame");
	const forK2 = compose2(scoped, "quiz-k2");
	check("scoped tip injected for its genre", forStep.includes("spatial-solver discipline"));
	check("scoped tip hidden from other genres", !forK2.includes("spatial-solver discipline"));
	check("universal tip injected everywhere", forStep.includes("universal discipline") && forK2.includes("universal discipline"));
	const legacy = compose2({ ...SEED2, tips: ["plain old tip"] }, "quiz-k2");
	check("legacy string tips still universal", legacy.includes("plain old tip"));

	rmSync(tmp, { recursive: true, force: true });
	console.log(`\n${passed} passed, ${failed} failed`);
	return failed === 0;
}
