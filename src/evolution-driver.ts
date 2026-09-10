/** Evolution driver (Phase-2 wiring): runs the baseline strategy + graph-mutation candidates on
 * a real mission, scores each from its research artifacts, and delegates promotion to the
 * existing strategy-generation loop (runStrategyGeneration).
 *
 * Usage:
 *   npm run research:evolve -- --mission config/research-mission-quant-smoke.json \
 *     --config config/research-competition-luna.json --candidates 2 --run-prefix evo-001
 *
 * Each candidate applies exactly one workGraph mutation (add/remove/merge/split) to the
 * champion's workGraph (default linear). Every run is a complete research-live mission with
 * checkpoint + honest host-development attestation; the fitness signals come from
 * research-score.json (scienceScore / scorePer100kTokens), which exist even when the
 * package is honestly ineligible. */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, ROOT } from "./config.js";
import { runLunaResearchMissionFromFiles } from "./research/live.js";
import { runStrategyGeneration, type StrategyEvaluationPort, type StrategyCandidateResult, type StrategyGenerationResult } from "./research/research-evolution.js";
import { applyStrategyEdit, DEFAULT_RESEARCH_STAGES, type StrategyEdit } from "./research/strategy-edits.js";
import { SEED_STRATEGY_BUNDLE, strategyBundleFingerprint, validateStrategyBundle, type StrategyBundle } from "./research/strategy-bundle.js";
import type { StrategyOutcome } from "./research/promotion.js";
import { instantiateGraphSpec } from "./research/graph-spec.js";
import { basename } from "node:path";

interface EvolveArgs {
	missionPath: string;
	configPath?: string;
	candidates: number;
	runPrefix: string;
}

function parseEvolveArgs(argv: string[]): EvolveArgs {
	const get = (key: string): string | undefined => {
		const index = argv.indexOf(`--${key}`);
		return index >= 0 && argv[index + 1] !== undefined && !String(argv[index + 1]!).startsWith("--") ? String(argv[index + 1]) : undefined;
	};
	const missionPath = get("mission") ?? join(ROOT, "config", "research-mission-quant-smoke.json");
	const configPath = get("config");
	const candidates = Math.max(1, Math.min(4, Number(get("candidates") ?? 2)));
	const runPrefix = get("run-prefix") ?? `evo-${Date.now()}`;
	return { missionPath, configPath, candidates, runPrefix };
}

function freshRunDir(prefix: string): string {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const candidate = join(ROOT, "runs", `${prefix}-${String(attempt + 1).padStart(2, "0")}`);
		if (!existsSync(candidate) || readdirSync(candidate).length === 0) return candidate;
	}
	throw new Error("no free run directory for evolution candidate");
}

/** Proposal generation: one structural mutation per candidate, round-robin over the operators. */
export function proposeGraphMutations(count: number): StrategyEdit[] {
	const operators: StrategyEdit[] = [
		{ component: "workGraph", op: "add-stage", afterId: "verification", kind: "verification", newId: "verification-redundant" },
		{ component: "workGraph", op: "split-stage", id: "sensitivity", copies: 2 },
		{ component: "workGraph", op: "add-stage", afterId: "quantitative-analysis", kind: "data-audit", newId: "data-audit-deep" },
		{ component: "workGraph", op: "remove-stage", id: "presentation" },
	];
	const out: StrategyEdit[] = [];
	for (let index = 0; index < count; index += 1) out.push(operators[index % operators.length]!);
	return out;
}

/** Map a completed run's artifacts to the StrategyOutcome fitness record. */
export function outcomeFromRunDir(runId: string, runDir: string): StrategyOutcome {
	const score = JSON.parse(readFileSync(join(runDir, "research-score.json"), "utf8")) as {
		eligible?: boolean; overall?: number | null; runtimePassed?: boolean; scienceScore?: number | null;
		communicationScore?: number | null; worstFamily?: number | null; scorePer100kTokens?: number | null; components?: Record<string, number>;
	};
	const attestation = JSON.parse(readFileSync(join(runDir, "runtime-attestation.json"), "utf8")) as {
		guardViolations?: string[]; cleanupPassed?: boolean; totalTokens?: number; modelCalls?: { success?: boolean }[];
	};
	const plan = JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8")) as { nodes?: { state?: string }[] };
	const nodes = plan.nodes ?? [];
	const completed = nodes.filter((node) => node.state === "completed").length;
	const modelCalls = attestation.modelCalls ?? [];
	return {
		runId,
		manifestFingerprint: runId,
		model: "gpt-5.6-luna",
		thinkingLevel: "high",
		repetition: 0,
		validRate: nodes.length > 0 ? completed / nodes.length : 0,
		// Fitness signal for host-development runs: science component exists even when the
		// package is honestly ineligible (overall=null).
		score: score.scienceScore ?? score.components?.taskOutcome ?? null,
		worstFamilyScore: score.worstFamily ?? null,
		totalTokens: attestation.totalTokens ?? 0,
		replayPassRate: 1,
		guardViolations: (attestation.guardViolations ?? []).length,
		cleanupPassed: attestation.cleanupPassed === true,
		otherModelCalls: modelCalls.filter((call) => call.success !== true).length,
	};
}

export async function runEvolutionCampaign(args: EvolveArgs, log: (message: string) => void): Promise<StrategyGenerationResult & { runDirs: string[] }> {
	const cfg = loadConfig(args.configPath);
	const { runLunaResearchMissionFromFiles } = await import("./research/live.js");
	const champion: StrategyBundle = { ...SEED_STRATEGY_BUNDLE };
	const strategyIssues = validateStrategyBundle(champion);
	if (strategyIssues.length > 0) throw new Error(`invalid champion strategy: ${strategyIssues.join("; ")}`);

	const runDirs: string[] = [];
	const evaluated: Array<{ bundle: StrategyBundle; runDir: string }> = [];
	let counter = 0;
	const evaluator: StrategyEvaluationPort = {
		evaluate: async (bundle, role, candidateIndex) => {
			const runDir = freshRunDir(`${args.runPrefix}-${role === "baseline" ? "base" : `cand${candidateIndex + 1}`}`);
			mkdirSync(runDir, { recursive: true });
			log(`[evolve] running ${role} ${role === "candidate" ? `#${candidateIndex + 1}` : ""} -> ${runDir}`);
			const result = await runLunaResearchMissionFromFiles({ cfg, missionPath: args.missionPath, strategy: bundle, runDir, log: (message) => log(`[evolve] ${message}`) });
			runDirs.push(runDir);
			void result;
			return [outcomeFromRunDir(basename(runDir), runDir)];
		},
	};
	void counter;
	void evaluated;
	void args.candidates;
	const baselineEdit: StrategyEdit = { component: "workGraph", op: "add-stage", afterId: "verification", kind: "verification", newId: "baseline-anchor" };
	void baselineEdit;

	// Candidate edits: deterministic round-robin over the mutation operators; the generation
	// loop itself skips fingerprints identical to the champion.
	const edits = proposeGraphMutations(args.candidates);
	const generation = await runStrategyGeneration({
		champion,
		candidateEdits: edits.map((edit) => [edit]),
		promotionPolicy: { allowedThinkingLevels: ["medium", "high", "xhigh"] },
		evaluator,
		originRun: args.runPrefix,
	});
	log(`[evolve] generation complete: acceptedCandidate=${generation.acceptedCandidate ?? "none"} candidates=${generation.candidates.map((candidate) => strategyBundleFingerprint(candidate.bundle).slice(0, 8)).join(",")}`);
	return { ...generation, runDirs };
}
