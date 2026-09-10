/** Deterministic tests for the evolution loop wiring (#79) and the exploratory node-kind
 * registry (#80). No live model calls: the evaluator is mocked, the registry is a temp file. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outcomeFromRunDir, proposeGraphMutations } from "../evolution-driver.js";
import { runStrategyGeneration } from "./research-evolution.js";
import type { WorkNodeKind } from "./contracts.js";
import type { StrategyBundle } from "./strategy-bundle.js";
import type { StrategyOutcome } from "./promotion.js";
import type { StrategyOutcome as PromotionOutcome } from "./promotion.js";
import {
	isBuiltInKind, isKnownStageKind, loadNodeKindRegistry, promoteNodeKind,
	registerExploratoryKind, saveNodeKindRegistry,
} from "./node-registry.js";
import { validateGraphSpec, WORK_NODE_KINDS } from "./graph-spec.js";

let passed = 0;
function check(label: string, condition: unknown): void {
	if (!condition) throw new Error(`FAIL: ${label}`);
	passed += 1;
	console.log(`  ok   ${label}`);
}

function outcome(runId: string, score: number | null, validRate = 1): PromotionOutcome {
	return {
		runId, manifestFingerprint: runId, model: "gpt-5.6-luna", thinkingLevel: "high", repetition: 0,
		validRate, score, worstFamilyScore: score, totalTokens: 50_000, replayPassRate: 1,
		guardViolations: 0, cleanupPassed: true, otherModelCalls: 0,
	};
}

const CHAMPION: StrategyBundle = {
	version: 1,
	scaffold: {} as StrategyBundle["scaffold"],
	planner: { maxNodes: 32, maxReplans: 2, requiredStageOrder: [], requireDecisionRecords: true },
	recipes: {}, verifiers: {},
	context: { roleBudgets: {}, includeOnlyDirectDependencies: true, artifactSummaryChars: 2000 },
	recovery: { maxNodeAttempts: 2, retryableFailureClasses: ["network", "timeout"], checkpointAfterEveryTransition: true },
	routing: { allowFallbackModels: false },
	communication: { reportTemplate: "research-report-v1", presentationSlides: 8, minimumDefenseQuestions: 12, requireEvidenceCitations: true },
	budget: { roleOutputCaps: {}, maxEscalationsPerCall: 1, escalationFactor: 2, hardRequestMaxTokens: 32768 },
	lineage: { parentFingerprint: null, generation: 0, changedComponent: null },
};

async function main(): Promise<void> {
	console.log("== evolution driver: proposals ==");
	const proposals = proposeGraphMutations(4);
	check("proposals are deterministic round-robin", proposals.length === 4 && proposals[0]!.op === "add-stage" && proposals[1]!.op === "split-stage" && proposals[2]!.op === "add-stage" && proposals[3]!.op === "remove-stage");

	console.log("== evolution driver: outcome parsing ==");
	const runDir = mkdtempSync(join(tmpdir(), "georsi-evo-run-"));
	writeFileSync(join(runDir, "research-score.json"), JSON.stringify({ eligible: false, overall: null, scienceScore: 0.82, worstFamily: 0.7, scorePer100kTokens: 1.4 }));
	writeFileSync(join(runDir, "runtime-attestation.json"), JSON.stringify({ guardViolations: [], cleanupPassed: true, totalTokens: 88_000, modelCalls: [{ success: true }] }));
	writeFileSync(join(runDir, "plan.json"), JSON.stringify({ nodes: [{ state: "completed" }, { state: "completed" }, { state: "ready" }] }));
	const parsed = outcomeFromRunDir("evo-test", runDir);
	check("outcome parses scienceScore as fitness", parsed.score === 0.82);
	check("outcome parses validRate from plan", Math.abs(parsed.validRate - 2 / 3) < 1e-9);
	check("outcome parses tokens", parsed.totalTokens === 88_000);

	console.log("== evolution loop: promotion on better fitness ==");
	const generation = await runStrategyGeneration({
		champion: CHAMPION,
		candidateEdits: [[{ component: "workGraph", op: "split-stage", id: "sensitivity", copies: 2 }]],
		promotionPolicy: { allowedThinkingLevels: ["high", "xhigh"] },
		evaluator: {
			evaluate: async (bundle, role, candidateIndex) => [
				{ ...outcome(`run-${role}-${candidateIndex}-rep0`, role === "candidate" ? 0.95 : 0.5), repetition: 0, manifestFingerprint: "manifest-fixed" },
				{ ...outcome(`run-${role}-${candidateIndex}-rep1`, role === "candidate" ? 0.93 : 0.52), repetition: 1, manifestFingerprint: "manifest-fixed" },
				],
			},
	});
	check("candidate promoted on better score", generation.acceptedCandidate === 0 && generation.champion.workGraph !== undefined);
	check("champion workGraph split applied", (generation.champion.workGraph?.stages.filter((stage) => stage.id.startsWith("sensitivity")).length ?? 0) === 2);

	console.log("== evolution loop: no promotion on worse fitness ==");
	const worse = await runStrategyGeneration({
		champion: CHAMPION,
		candidateEdits: [[{ component: "workGraph", op: "add-stage", afterId: "synthesis", kind: "hypothesis", newId: "extra-hypothesis" }]],
		evaluator: {
			evaluate: async (bundle, role, candidateIndex) => [outcome(`worse-${role}-${candidateIndex}`, role === "candidate" ? 0.3 : 0.8)],
		},
	});
	check("worse candidate not promoted", worse.acceptedCandidate === null && worse.champion.workGraph === undefined);

	console.log("== #80 exploratory node-kind registry ==");
	const registryPath = mkdtempSync(join(tmpdir(), "georsi-registry-")) + "/node-registry.json";
	check("built-in kinds recognized", isBuiltInKind("quantitative-analysis") && !isBuiltInKind("stationarity-check"));
	check("unknown kind not known before registration", !isKnownStageKind(registryPath, "stationarity-check"));
	registerExploratoryKind(registryPath, { kind: "stationarity-check", purpose: "ADF test on the synthetic catalog", originRun: "luna-smoke-021" });
	check("exploratory kind becomes known", isKnownStageKind(registryPath, "stationarity-check"));
	check("exploratory kind validates against the spec vocabulary", validateGraphSpec({ stages: [{ id: "stationarity-check", kind: "stationarity-check" as WorkNodeKind & string, dependsOn: [] as never }] }, [...WORK_NODE_KINDS, "stationarity-check"] as never).length === 0);
	let duplicateRejected = false;
	try { registerExploratoryKind(registryPath, { kind: "stationarity-check", purpose: "dup" }); } catch { duplicateRejected = true; }
	check("duplicate registration rejected", duplicateRejected);
	promoteNodeKind(registryPath, "stationarity-check", "quantitative-v1");
	const promoted = loadNodeKindRegistry(registryPath).kinds.find((record) => record.kind === "stationarity-check");
	check("promotion sets status + verifier profile", promoted?.status === "promoted" && promoted?.verifierProfile === "quantitative-v1");
	let promoteUnknownRejected = false;
	try { promoteNodeKind(registryPath, "ghost-kind", "quantitative-v1"); } catch { promoteUnknownRejected = true; }
	check("promoting unknown kind rejected", promoteUnknownRejected);
	rmSync(registryPath, { force: true });
	rmSync(runDir, { recursive: true, force: true });

	console.log(`evolution/registry selftest passed (${passed} checks)`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
