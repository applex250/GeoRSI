/** Typed, bounded evolution object for long-horizon research behavior. */
import { createHash } from "node:crypto";
import { SEED_SCAFFOLD, type Scaffold } from "../scaffold.js";
import { stableJson } from "./event-ledger.js";
import type { WorkNodeKind } from "./contracts.js";

export type StrategyComponent = "scaffold" | "planner" | "recipe" | "verifier" | "context" | "recovery" | "budget" | "communication";

export interface PlannerPolicy {
	maxNodes: number;
	maxReplans: number;
	requiredStageOrder: WorkNodeKind[];
	requireDecisionRecords: boolean;
}

export interface ToolRecipe {
	id: string;
	family: string;
	steps: string[];
	verificationSteps: string[];
}

export interface VerifierPolicy {
	profile: string;
	requireUncertainty: boolean;
	minimumSensitivityRuns: number;
	requireIndependentCheck: boolean;
	requireReplay: boolean;
}

export interface RecoveryPolicy {
	maxNodeAttempts: number;
	retryableFailureClasses: string[];
	checkpointAfterEveryTransition: boolean;
}

export interface ContextPolicy {
	roleBudgets: Record<string, number>;
	includeOnlyDirectDependencies: boolean;
	artifactSummaryChars: number;
}

export interface RoutingPolicy {
	/** Model identity is owned by Config.research_model, never by StrategyBundle. */
	allowFallbackModels: false;
}

export interface CommunicationPolicy {
	reportTemplate: "research-report-v1";
	presentationSlides: 8;
	minimumDefenseQuestions: number;
	requireEvidenceCitations: boolean;
}

export interface BudgetPolicy {
	roleOutputCaps: Record<string, number>;
	maxEscalationsPerCall: number;
	escalationFactor: number;
	hardRequestMaxTokens: number;
}

export interface StrategyLineage {
	parentFingerprint: string | null;
	generation: number;
	changedComponent: StrategyComponent | null;
	originRun?: string;
}

export interface StrategyBundle {
	version: 1;
	scaffold: Scaffold;
	planner: PlannerPolicy;
	recipes: Record<string, ToolRecipe[]>;
	verifiers: Record<string, VerifierPolicy>;
	context: ContextPolicy;
	recovery: RecoveryPolicy;
	routing: RoutingPolicy;
	communication: CommunicationPolicy;
	budget: BudgetPolicy;
	lineage: StrategyLineage;
}

export const SEED_STRATEGY_BUNDLE: StrategyBundle = {
	version: 1,
	scaffold: SEED_SCAFFOLD,
	planner: { maxNodes: 32, maxReplans: 2, requiredStageOrder: ["frame-question", "value-assessment", "hypothesis", "data-audit", "verification", "synthesis", "report", "presentation", "defense"], requireDecisionRecords: true },
	recipes: {},
	verifiers: {
		quantitative: { profile: "quantitative-v1", requireUncertainty: true, minimumSensitivityRuns: 2, requireIndependentCheck: true, requireReplay: true },
		gis: { profile: "gis-v1", requireUncertainty: true, minimumSensitivityRuns: 2, requireIndependentCheck: true, requireReplay: true },
		literature: { profile: "literature-v1", requireUncertainty: true, minimumSensitivityRuns: 1, requireIndependentCheck: true, requireReplay: true },
	},
	context: { roleBudgets: { planner: 48_000, literature: 64_000, quantitative: 96_000, gis: 96_000, verifier: 48_000, synthesis: 96_000, defense: 64_000 }, includeOnlyDirectDependencies: true, artifactSummaryChars: 2000 },
	recovery: { maxNodeAttempts: 2, retryableFailureClasses: ["network", "timeout", "data-schema", "verification", "citation", "numerical-instability"], checkpointAfterEveryTransition: true },
	routing: { allowFallbackModels: false },
	communication: { reportTemplate: "research-report-v1", presentationSlides: 8, minimumDefenseQuestions: 12, requireEvidenceCitations: true },
	budget: { roleOutputCaps: { goal: 4096, proposal: 4096, critic: 4096, planner: 6144, literature: 8192, quantitative: 16384, gis: 24576, verifier: 6144, report: 12288, defense: 8192, judge: 8192 }, maxEscalationsPerCall: 1, escalationFactor: 2, hardRequestMaxTokens: 32768 },
	lineage: { parentFingerprint: null, generation: 0, changedComponent: null },
};

export function strategyBundleFingerprint(bundle: StrategyBundle): string {
	const { lineage: _lineage, ...content } = bundle;
	return createHash("sha256").update(stableJson(content)).digest("hex").slice(0, 24);
}

export function validateStrategyBundle(bundle: StrategyBundle): string[] {
	const issues: string[] = [];
	if (bundle.version !== 1) issues.push("strategy version must be 1");
	if (bundle.routing.allowFallbackModels !== false) issues.push("research strategy must not allow fallback models; model identity comes from research_model config");
	if (bundle.planner.maxNodes < 1 || bundle.planner.maxNodes > 64) issues.push("planner maxNodes must be 1..64");
	if (bundle.planner.maxReplans < 0 || bundle.planner.maxReplans > 5) issues.push("planner maxReplans must be 0..5");
	if (bundle.recovery.maxNodeAttempts < 1 || bundle.recovery.maxNodeAttempts > 4) issues.push("recovery maxNodeAttempts must be 1..4");
	if (bundle.communication.presentationSlides !== 8) issues.push("competition presentation must contain exactly 8 slides");
	if (bundle.communication.minimumDefenseQuestions < 12) issues.push("at least 12 defense questions are required");
	if (bundle.budget.maxEscalationsPerCall < 0 || bundle.budget.maxEscalationsPerCall > 1) issues.push("at most one output-token escalation is allowed");
	if (bundle.budget.hardRequestMaxTokens > 32768 || bundle.budget.hardRequestMaxTokens <= 0) issues.push("hard request max tokens must be within 1..32768");
	for (const [role, value] of Object.entries(bundle.budget.roleOutputCaps)) if (!Number.isSafeInteger(value) || value <= 0 || value > bundle.budget.hardRequestMaxTokens) issues.push(`invalid role output cap: ${role}`);
	for (const [role, value] of Object.entries(bundle.context.roleBudgets)) if (!Number.isSafeInteger(value) || value <= 0 || value > 120_000) issues.push(`invalid context budget: ${role}`);
	for (const recipes of Object.values(bundle.recipes)) {
		for (const recipe of recipes) if (!recipe.id.trim() || recipe.steps.length === 0 || recipe.steps.length > 16) issues.push(`invalid tool recipe: ${recipe.id}`);
	}
	return issues;
}
