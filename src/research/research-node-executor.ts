/** Production WorkGraph node adapter: one bounded, Luna-gated xhigh Pi session per node. */
import { createHash } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import { validateResearchModelConfig, type ResearchModelConfig } from "../config.js";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { PiHarness, toolOutput, type HarnessOpts, type PromptOutcome } from "../piharness.js";
import type { EvidenceRef, HypothesisRecord, ResearchClaim, ResearchMission, ResearchWorkGraph, WorkNode, WorkNodeKind } from "./contracts.js";
import { buildContextPack, type ContextBlock, type ContextPack } from "./context-manager.js";
import type { ContentAddressedEvidenceStore } from "./evidence-store.js";
import { sanitizeResearchEvidence, stableJson } from "./event-ledger.js";
import { requiredFamilyVerifierProfiles, validateModelCallReceipt, type FamilyVerificationAttestation, type ModelCallReceipt } from "./runtime-attestation.js";
import type { NodeExecutionResult, NodeVerificationResult } from "./scheduler.js";
import type { StrategyBundle } from "./strategy-bundle.js";
import type { ResearchContextMemory } from "./context-memory.js";
import { validateStrategyBundle } from "./strategy-bundle.js";
import { roleOutputCap } from "./token-policy.js";
import type { ScientificToolReceipt, ScientificToolRegistry } from "./tool-registry.js";
import type { ResearchNarrative } from "./deliverables.js";
import type { ScientificValueCard } from "./value-evaluator.js";
import type { ScientificVerificationResult } from "./verifiers/base.js";
import { verifyGisResearch, type GisVerificationInput } from "./verifiers/gis.js";
import { verifyLiteratureResearch, type LiteratureVerificationInput } from "./verifiers/literature.js";
import { verifyQuantitativeResearch, type QuantitativeVerificationInput } from "./verifiers/quantitative.js";

export type ResearchNodeRole = "planner" | "literature" | "quantitative" | "gis" | "verifier" | "synthesis" | "report" | "defense";
export type FamilyVerifierProfile = "quantitative-v1" | "gis-v1" | "literature-v1";

export interface ScientificPiToolBinding {
	toolId: string;
	description: string;
	parameters: TSchema;
}

export interface ResearchHarness {
	init(): Promise<void>;
	prompt(text: string, timeoutOverrideMs?: number): Promise<PromptOutcome>;
	abort(): void;
	dispose(): void;
}

export interface ResearchNodeExecutorDeps {
	mission: ResearchMission;
	strategy: StrategyBundle;
	modelPolicy: ResearchModelConfig;
	model: Model<any>;
	cwdForNode(nodeId: string, attempt: number): string;
	evidenceStore: ContentAddressedEvidenceStore;
	evidenceById(id: string): EvidenceRef | undefined;
	registerEvidence(reference: EvidenceRef): void;
	toolRegistry: ScientificToolRegistry;
	toolBindings: ScientificPiToolBinding[];
	createHarness?: (opts: HarnessOpts) => ResearchHarness;
	onModelReceipt?: (receipt: ModelCallReceipt) => void;
	onToolReceipt?: (receipt: ScientificToolReceipt) => void;
	/** Optional run-scoped read-only context memory fed by node submissions. */
	contextMemory?: ResearchContextMemory;
	now?: () => Date;
	stallMs?: number;
}

interface CapturedArtifact {
	handle: string;
	kind: "tool-output" | "table" | "script";
	logicalName: string;
	mediaType: string;
	content: string;
}

export interface CapturedVerification {
	profile: FamilyVerifierProfile;
	/** Canonical tool-produced artifact whose CAS content the host parses as verifier input. */
	inputArtifactId: string;
	evidenceIds: string[];
}

export interface ResearchNodeSubmission {
	version: 1;
	summary: string;
	artifactIds: string[];
	decisions: { question: string; alternatives: string[]; selected: string; evidenceIds: string[]; uncertainty: string }[];
	verifications: CapturedVerification[];
	hypotheses?: HypothesisRecord[];
	claims?: ResearchClaim[];
	valueCard?: ScientificValueCard;
	narrative?: ResearchNarrative;
	contraryEvidenceLinks?: { sourceEvidenceId: string; claimId: string }[];
}

interface CapturedSubmission {
	version: 1;
	summary: string;
	artifactIds: string[];
	decisions: {
		question: string;
		alternatives: string[];
		selected: string;
		evidenceIds: string[];
		uncertainty: string;
	}[];
	verifications: CapturedVerification[];
	hypotheses?: HypothesisRecord[];
	claims?: ResearchClaim[];
	valueCard?: ScientificValueCard;
	narrative?: ResearchNarrative;
	contraryEvidenceLinks?: { sourceEvidenceId: string; claimId: string }[];
}

const VERIFIER_PROFILES = ["quantitative-v1", "gis-v1", "literature-v1"] as const;

const STATUS_SCHEMA = Type.Union([Type.Literal("proposed"), Type.Literal("supported"), Type.Literal("contradicted"), Type.Literal("inconclusive"), Type.Literal("retracted")]);
const EVIDENCE_IDS_SCHEMA = Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 64 });
const HYPOTHESIS_SCHEMA = Type.Object({
	id: Type.String({ minLength: 1, maxLength: 160 }),
	statement: Type.String({ minLength: 1, maxLength: 4000 }),
	rationale_evidence_ids: EVIDENCE_IDS_SCHEMA,
	expected_observation: Type.String({ minLength: 1, maxLength: 2000 }),
	falsifier: Type.String({ minLength: 1, maxLength: 2000 }),
	status: STATUS_SCHEMA,
});
const CLAIM_SCHEMA = Type.Object({
	id: Type.String({ minLength: 1, maxLength: 160 }),
	text: Type.String({ minLength: 1, maxLength: 4000 }),
	status: STATUS_SCHEMA,
	evidence_ids: EVIDENCE_IDS_SCHEMA,
	uncertainty: Type.String({ maxLength: 2000 }),
	limitations: Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), { maxItems: 16 }),
});
const VALUE_DIMENSION_SCHEMA = Type.Object({
	score: Type.Integer({ minimum: 0, maximum: 4 }),
	rationale: Type.String({ minLength: 1, maxLength: 3000 }),
	evidence_ids: EVIDENCE_IDS_SCHEMA,
});
const VALUE_CARD_SCHEMA = Type.Object({
	significance: VALUE_DIMENSION_SCHEMA,
	novelty: VALUE_DIMENSION_SCHEMA,
	falsifiability: VALUE_DIMENSION_SCHEMA,
	dataFeasibility: VALUE_DIMENSION_SCHEMA,
	methodologicalValue: VALUE_DIMENSION_SCHEMA,
	potentialImpact: VALUE_DIMENSION_SCHEMA,
	limitations: Type.Array(Type.String({ minLength: 1, maxLength: 2000 }), { minItems: 1, maxItems: 16 }),
	recommendation: Type.Union([Type.Literal("proceed"), Type.Literal("revise"), Type.Literal("reject")]),
});
const NARRATIVE_SECTION_SCHEMA = Type.Object({
	text: Type.String({ minLength: 1, maxLength: 6000 }),
	evidence_ids: EVIDENCE_IDS_SCHEMA,
	claim_ids: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 64 })),
});
const NARRATIVE_SCHEMA = Type.Object({
	dataSummary: NARRATIVE_SECTION_SCHEMA,
	methodSummary: NARRATIVE_SECTION_SCHEMA,
	resultSummary: NARRATIVE_SECTION_SCHEMA,
	uncertaintySummary: NARRATIVE_SECTION_SCHEMA,
	innovationSummary: NARRATIVE_SECTION_SCHEMA,
	reproducibilitySummary: NARRATIVE_SECTION_SCHEMA,
});

const SUBMISSION_SCHEMA = Type.Object({
	version: Type.Literal(1),
	summary: Type.String({ minLength: 1, maxLength: 16_000 }),
	artifact_ids: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { minItems: 1, maxItems: 32 }),
	decisions: Type.Array(Type.Object({
		question: Type.String({ minLength: 1, maxLength: 1000 }),
		alternatives: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { minItems: 1, maxItems: 8 }),
		selected: Type.String({ minLength: 1, maxLength: 1000 }),
		evidence_ids: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 32 }),
		uncertainty: Type.String({ minLength: 1, maxLength: 2000 }),
	}), { maxItems: 8 }),
	verifications: Type.Array(Type.Object({
		profile: Type.Union(VERIFIER_PROFILES.map((profile) => Type.Literal(profile))),
		input_artifact: Type.String({ minLength: 1, maxLength: 160, description: "Artifact id PRODUCED BY A SCIENTIFIC TOOL (copy resultArtifactId or an id from evidenceIds of the python-host/web-fetch tool output). Model-staged model-artifact handles are rejected as verifier input." }),
		evidence_ids: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { minItems: 1, maxItems: 64 }),
	}), { maxItems: 3 }),
	hypotheses: Type.Optional(Type.Array(HYPOTHESIS_SCHEMA, { maxItems: 16 })),
	claims: Type.Optional(Type.Array(CLAIM_SCHEMA, { maxItems: 32 })),
	value_card: Type.Optional(VALUE_CARD_SCHEMA),
	narrative: Type.Optional(NARRATIVE_SCHEMA),
	contrary_evidence_links: Type.Optional(Type.Array(Type.Object({ source_evidence_id: Type.String({ minLength: 1, maxLength: 160 }), claim_id: Type.String({ minLength: 1, maxLength: 160 }) }), { maxItems: 64 })),
});

export function researchNodeRole(kind: WorkNodeKind): ResearchNodeRole {
	if (kind === "literature-search" || kind === "hypothesis") return "literature";
	if (kind === "quantitative-analysis" || kind === "sensitivity") return "quantitative";
	if (kind === "gis-analysis") return "gis";
	if (kind === "verification") return "verifier";
	if (kind === "synthesis") return "synthesis";
	if (kind === "report" || kind === "presentation") return "report";
	if (kind === "defense") return "defense";
	return "planner";
}

function contextRole(role: ResearchNodeRole): string {
	return role === "report" ? "synthesis" : role;
}

function profileForNode(kind: WorkNodeKind): FamilyVerifierProfile | null {
	if (kind === "quantitative-analysis" || kind === "sensitivity") return "quantitative-v1";
	if (kind === "gis-analysis") return "gis-v1";
	if (kind === "literature-search" || kind === "hypothesis") return "literature-v1";
	return null;
}

function exactModelReceiptIssue(receipt: ModelCallReceipt, policy: ResearchModelConfig): string | null {
	const issues = validateModelCallReceipt(receipt, policy);
	return issues.length > 0 ? issues[0]! : null;
}

function safeToolName(toolId: string): string {
	const normalized = toolId.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 48);
	if (!normalized) throw new Error(`scientific tool id has no safe Pi name: ${toolId}`);
	return `research_${normalized}`;
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function familyInputHash(profile: string, input: unknown, evidenceIds: readonly string[]): string {
	// Evidence ids and sanitized input are both committed by the hash.
	return createHash("sha256").update(stableJson({ profile, input, evidenceIds: [...evidenceIds].sort() })).digest("hex");
}

export function validateFamilyEvidenceBinding(profile: FamilyVerifierProfile, input: unknown, evidence: readonly EvidenceRef[]): string[] {
	if (evidence.length === 0) return [`${profile} has no canonical evidence binding`];
	if (profile === "quantitative-v1") {
		return evidence.some((reference) => ["dataset", "table", "tool-output", "script"].includes(reference.kind)) ? [] : ["quantitative verifier requires canonical data, table, script, or tool-output evidence"];
	}
	if (profile === "gis-v1") {
		const artifacts = Array.isArray((input as GisVerificationInput | null)?.artifacts) ? (input as GisVerificationInput).artifacts : [];
		if (artifacts.length === 0) return ["GIS verifier input has no artifacts"];
		const hashes = new Set(evidence.filter((reference) => ["geodata", "figure", "table", "tool-output"].includes(reference.kind)).map((reference) => reference.sha256));
		return artifacts.every((artifact) => hashes.has(artifact.sha256)) ? [] : ["GIS verifier artifacts are not bound to canonical evidence hashes"];
	}
	const sources = Array.isArray((input as LiteratureVerificationInput | null)?.sources) ? (input as LiteratureVerificationInput).sources : [];
	if (sources.length === 0) return ["literature verifier input has no scholarly sources"];
	const sourceHashes = new Set(evidence.filter((reference) => reference.kind === "source").map((reference) => reference.sha256));
	return sources.every((source) => sourceHashes.has(source.contentHash)) ? [] : ["literature sources are not bound to canonical source-evidence hashes"];
}

export function dispatchFamilyVerifier(profile: FamilyVerifierProfile, input: unknown): ScientificVerificationResult {
	if (profile === "quantitative-v1") return verifyQuantitativeResearch(input as QuantitativeVerificationInput);
	if (profile === "gis-v1") return verifyGisResearch(input as GisVerificationInput);
	return verifyLiteratureResearch(input as LiteratureVerificationInput);
}

export function buildResearchNodeContext(input: {
	mission: ResearchMission;
	strategy: StrategyBundle;
	node: WorkNode;
	graph: ResearchWorkGraph;
	evidence: readonly EvidenceRef[];
}): ContextPack {
	const { mission, strategy, node, graph, evidence } = input;
	const role = researchNodeRole(node.kind);
	const budget = strategy.context.roleBudgets[contextRole(role)];
	if (!Number.isSafeInteger(budget) || budget! <= 0) throw new Error(`no context budget for research role ${role}`);
	const directDependencies = graph.nodes.filter((candidate) => node.dependsOn.includes(candidate.id));
	const relevantIds = new Set<string>([
		...node.inputEvidenceIds,
		...directDependencies.flatMap((dependency) => [...dependency.outputArtifactIds, ...dependency.acceptanceEvidenceIds]),
	]);
	const relevantEvidence = evidence.filter((reference) => relevantIds.has(reference.id));
	const recipes = [
		...(strategy.recipes[mission.taskProfile.family] ?? []),
		...(strategy.recipes[node.kind] ?? []),
	];
	const blocks: ContextBlock[] = [
		{ id: "research-policy", kind: "policy", mandatory: true, priority: 100, content: "Use only the exposed scientific tools. Never invent evidence IDs. Record concise externally reviewable decisions, uncertainty, and falsifiers; do not provide hidden chain-of-thought. Finish by calling submit_research_node_output exactly once." },
		{ id: `mission-${mission.id}`, kind: "mission", mandatory: true, priority: 100, content: stableJson(mission) },
		{ id: `node-${node.id}`, kind: "node", mandatory: true, priority: 100, content: stableJson({ id: node.id, kind: node.kind, title: node.title, expectedOutputs: node.expectedOutputs, acceptanceCriteriaIds: node.acceptanceCriteriaIds, allowedCapabilities: node.allowedCapabilities }) },
		{ id: `graph-${graph.missionId}`, kind: "graph", mandatory: true, priority: 95, content: (() => {
			const downstream = graph.nodes.filter((candidate) => candidate.dependsOn.includes(node.id)).map((candidate) => candidate.id);
			const lines = [...graph.nodes].sort((left, right) => left.id.localeCompare(right.id)).map((candidate) => {
				const marker = candidate.id === node.id ? "  <-- YOU ARE HERE" : downstream.includes(candidate.id) ? "  <-- your downstream" : "";
				return `${candidate.id} [${candidate.kind}] depends:[${candidate.dependsOn.join(",")}]${marker}`;
			});
			return `mission work graph (${graph.nodes.length} nodes; call context-recall {list:true} for current progress and committed memory):\n${lines.join("\n")}`.slice(0, 8000);
		})() },
		{ id: `budget-${node.id}`, kind: "budget", mandatory: true, priority: 100, content: stableJson(node.budget) },
		...directDependencies.map((dependency) => ({ id: `dependency-${dependency.id}`, kind: "dependency" as const, mandatory: true, priority: 90, content: stableJson({ id: dependency.id, kind: dependency.kind, state: dependency.state, outputArtifactIds: dependency.outputArtifactIds, acceptanceEvidenceIds: dependency.acceptanceEvidenceIds }) })),
		...relevantEvidence.map((reference) => ({ id: `evidence-${reference.id}`, kind: "evidence" as const, mandatory: false, priority: 80, sourceHash: reference.sha256, content: stableJson(reference).slice(0, strategy.context.artifactSummaryChars) })),
		...recipes.map((recipe) => ({ id: `recipe-${recipe.id}`, kind: "recipe" as const, mandatory: false, priority: 60, content: stableJson(recipe) })),
	];
	return buildContextPack(blocks, budget!);
}

export class ResearchNodeExecutor {
	private readonly now: () => Date;
	private readonly createHarness: (opts: HarnessOpts) => ResearchHarness;
	private readonly modelReceiptsValue: ModelCallReceipt[] = [];
	private readonly toolReceiptsValue: ScientificToolReceipt[] = [];
	private readonly familyAttestations = new Map<string, FamilyVerificationAttestation>();
	private readonly submissions = new Map<string, ResearchNodeSubmission>();

	constructor(private readonly deps: ResearchNodeExecutorDeps) {
		const strategyIssues = validateStrategyBundle(deps.strategy);
		if (strategyIssues.length > 0) throw new Error(`invalid research strategy: ${strategyIssues.join("; ")}`);
		const policyIssues = validateResearchModelConfig(deps.modelPolicy);
		if (policyIssues.length > 0) throw new Error(`invalid research model policy: ${policyIssues.join("; ")}`);
		const model = deps.model as { id?: string; provider?: string; api?: string };
		if (model.id !== deps.modelPolicy.model || model.provider !== deps.modelPolicy.provider || model.api !== deps.modelPolicy.api) {
			throw new Error(`research executor model does not match research_model policy: expected ${deps.modelPolicy.provider}/${deps.modelPolicy.model}/${deps.modelPolicy.api}, got ${model.provider ?? "?"}/${model.id ?? "?"}/${model.api ?? "?"}`);
		}
		const knownTools = new Set(deps.toolRegistry.list().map((tool) => tool.id));
		const names = new Set<string>();
		for (const binding of deps.toolBindings) {
			if (!knownTools.has(binding.toolId)) throw new Error(`Pi binding references unknown scientific tool: ${binding.toolId}`);
			const name = safeToolName(binding.toolId);
			if (names.has(name)) throw new Error(`duplicate scientific Pi tool name: ${name}`);
			names.add(name);
		}
		this.now = deps.now ?? (() => new Date());
		this.createHarness = deps.createHarness ?? ((opts) => new PiHarness(opts));
	}

	modelReceipts(): ModelCallReceipt[] {
		return this.modelReceiptsValue.map((receipt) => ({ ...receipt }));
	}

	toolReceipts(): ScientificToolReceipt[] {
		return this.toolReceiptsValue.map((receipt) => ({ ...receipt, artifactIds: [...receipt.artifactIds] }));
	}

	familyVerifications(): FamilyVerificationAttestation[] {
		return [...this.familyAttestations.values()].map((item) => ({ ...item, result: { ...item.result, issues: [...item.result.issues], checks: { ...item.result.checks } }, evidenceIds: [...item.evidenceIds] })).sort((left, right) => left.profile.localeCompare(right.profile));
	}

	researchSubmission(nodeId: string): ResearchNodeSubmission | undefined {
		const submission = this.submissions.get(nodeId);
		return submission ? structuredClone(submission) : undefined;
	}

	async executeNode(node: WorkNode, graph: ResearchWorkGraph, signal: AbortSignal): Promise<NodeExecutionResult> {
		if (graph.missionId !== this.deps.mission.id) throw new Error("research graph mission does not match executor mission");
		if (signal.aborted) throw new Error("research node execution aborted before start");
		const role = researchNodeRole(node.kind);
		if (node.budget.maxModelCalls <= 0) throw new Error(`node ${node.id} has no Luna model-call budget`);
		const aggregateOutputCap = node.budget.maxOutputTokens;
		const outputCap = Math.min(roleOutputCap(this.deps.strategy.budget, role), Math.floor(aggregateOutputCap / node.budget.maxModelCalls));
		if (!Number.isSafeInteger(outputCap) || outputCap <= 0) throw new Error(`invalid per-call output cap for node ${node.id}`);
		const evidenceIds = unique([
			...node.inputEvidenceIds,
			...graph.nodes.filter((candidate) => node.dependsOn.includes(candidate.id)).flatMap((dependency) => [...dependency.outputArtifactIds, ...dependency.acceptanceEvidenceIds]),
		]);
		const evidence = evidenceIds.map((id) => this.deps.evidenceById(id)).filter((reference): reference is EvidenceRef => !!reference);
		if (evidence.length !== evidenceIds.length) throw new Error(`node ${node.id} context references unknown evidence`);
		this.deps.contextMemory?.syncGraphState(graph.nodes.map((candidate) => ({ id: candidate.id, state: candidate.state, attempts: candidate.attempts })));
		const context = buildResearchNodeContext({ mission: this.deps.mission, strategy: this.deps.strategy, node, graph, evidence });
		const startedAt = Date.now();
		const remainingWallMs = (): number => Math.max(0, node.budget.wallMs - (Date.now() - startedAt));
		const ensureActive = (): void => {
			if (signal.aborted || remainingWallMs() <= 0) throw new Error(`research node ${node.id} deadline expired`);
		};
		const pendingArtifacts: CapturedArtifact[] = [];
		const producedToolArtifacts = new Set<string>();
		const nodeToolReceiptIds: string[] = [];
		let submission: CapturedSubmission | undefined;
		let toolCalls = 0;

		const bindingsById = new Map(this.deps.toolBindings.map((binding) => [binding.toolId, binding]));
		const scientificTools = this.deps.toolRegistry.list()
			.filter((tool) => node.allowedCapabilities.includes(tool.capability) && bindingsById.has(tool.id))
			.map((tool) => {
				const binding = bindingsById.get(tool.id)!;
				return defineTool({
					name: safeToolName(tool.id),
					label: tool.id,
					description: binding.description,
					parameters: binding.parameters,
					execute: async (_callId, params) => {
						ensureActive();
						toolCalls += 1;
						let executed: Awaited<ReturnType<ScientificToolRegistry["execute"]>>;
						try {
							executed = await this.deps.toolRegistry.execute(tool.id, { missionId: this.deps.mission.id, episodeId: this.deps.mission.id, nodeId: node.id, allowedCapabilities: node.allowedCapabilities, remainingWallMs: remainingWallMs(), signal }, params);
						} catch (error) {
							const receipt = (error as { receipt?: ScientificToolReceipt }).receipt;
							if (receipt) {
								this.toolReceiptsValue.push(receipt);
								nodeToolReceiptIds.push(receipt.id);
								this.deps.onToolReceipt?.(receipt);
							}
							throw error;
						}
						this.toolReceiptsValue.push(executed.receipt);
						nodeToolReceiptIds.push(executed.receipt.id);
						this.deps.onToolReceipt?.(executed.receipt);
						ensureActive();
						const resultIds = unique(executed.result.artifactIds ?? []);
						for (const reference of executed.result.evidenceRefs ?? []) {
							if (!resultIds.includes(reference.id) || !this.deps.evidenceStore.verify(reference)) throw new Error(`scientific tool returned unverifiable evidence: ${reference.id}`);
							this.deps.registerEvidence(reference);
						}
						for (const id of resultIds) {
							const reference = this.deps.evidenceById(id) ?? executed.result.evidenceRefs?.find((item) => item.id === id);
							if (!reference || !this.deps.evidenceStore.verify(reference)) throw new Error(`scientific tool artifact is not canonical CAS evidence: ${id}`);
							producedToolArtifacts.add(id);
						}
						return toolOutput(stableJson({ output: sanitizeResearchEvidence(executed.result.output), artifactIds: resultIds }));
					},
				});
			});

		const artifactTool = defineTool({
			name: "record_research_artifact",
			label: "Record research artifact",
			description: "Stage a bounded model-authored text/JSON/table artifact. Returns a temporary handle for submit_research_node_output.",
			parameters: Type.Object({
				kind: Type.Union([Type.Literal("tool-output"), Type.Literal("table"), Type.Literal("script")]),
				logical_name: Type.String({ minLength: 1, maxLength: 160 }),
				media_type: Type.String({ minLength: 1, maxLength: 120 }),
				content: Type.String({ minLength: 1, maxLength: Math.min(131_072, outputCap * 4) }),
			}),
			execute: async (_callId, params) => {
				ensureActive();
				toolCalls += 1;
				const handle = `model-artifact:${pendingArtifacts.length + 1}`;
				pendingArtifacts.push({ handle, kind: params.kind, logicalName: params.logical_name, mediaType: params.media_type, content: String(sanitizeResearchEvidence(params.content)) });
				return toolOutput(`staged artifact ${handle}`);
			},
		});
		const submitTool = defineTool({
			name: "submit_research_node_output",
			label: "Submit research node output",
			description: "Submit the node result exactly once. verifications[].input_artifact must be a tool-produced artifact id (resultArtifactId/evidenceIds from python-host or web-fetch output); provide exactly one verification entry per required verifier profile — duplicate profiles are rejected. model-artifact handles are accepted only for artifact_ids/decisions/narrative, never as verifier input.",
			parameters: SUBMISSION_SCHEMA,
			execute: async (_callId, params) => {
				ensureActive();
				toolCalls += 1;
				if (submission) throw new Error("research node output was already submitted");
				submission = {
					version: 1,
					summary: params.summary,
					artifactIds: params.artifact_ids,
					decisions: params.decisions.map((decision) => ({ question: decision.question, alternatives: decision.alternatives, selected: decision.selected, evidenceIds: decision.evidence_ids, uncertainty: decision.uncertainty })),
					verifications: params.verifications.map((verification) => ({ profile: verification.profile, inputArtifactId: verification.input_artifact, evidenceIds: verification.evidence_ids })),
					hypotheses: params.hypotheses?.map((hypothesis) => ({ id: hypothesis.id, statement: hypothesis.statement, rationaleEvidenceIds: hypothesis.rationale_evidence_ids, expectedObservation: hypothesis.expected_observation, falsifier: hypothesis.falsifier, status: hypothesis.status })),
					claims: params.claims?.map((claim) => ({ id: claim.id, text: claim.text, status: claim.status, evidenceIds: claim.evidence_ids, uncertainty: claim.uncertainty, limitations: claim.limitations })),
					valueCard: params.value_card ? {
						significance: { score: params.value_card.significance.score, rationale: params.value_card.significance.rationale, evidenceIds: params.value_card.significance.evidence_ids },
						novelty: { score: params.value_card.novelty.score, rationale: params.value_card.novelty.rationale, evidenceIds: params.value_card.novelty.evidence_ids },
						falsifiability: { score: params.value_card.falsifiability.score, rationale: params.value_card.falsifiability.rationale, evidenceIds: params.value_card.falsifiability.evidence_ids },
						dataFeasibility: { score: params.value_card.dataFeasibility.score, rationale: params.value_card.dataFeasibility.rationale, evidenceIds: params.value_card.dataFeasibility.evidence_ids },
						methodologicalValue: { score: params.value_card.methodologicalValue.score, rationale: params.value_card.methodologicalValue.rationale, evidenceIds: params.value_card.methodologicalValue.evidence_ids },
						potentialImpact: { score: params.value_card.potentialImpact.score, rationale: params.value_card.potentialImpact.rationale, evidenceIds: params.value_card.potentialImpact.evidence_ids },
						limitations: params.value_card.limitations,
						recommendation: params.value_card.recommendation,
					} as ScientificValueCard : undefined,
					narrative: params.narrative ? Object.fromEntries(Object.entries(params.narrative).map(([key, section]) => [key, { text: section.text, evidenceIds: section.evidence_ids, claimIds: section.claim_ids }])) as unknown as ResearchNarrative : undefined,
					contraryEvidenceLinks: params.contrary_evidence_links?.map((link) => ({ sourceEvidenceId: link.source_evidence_id, claimId: link.claim_id })),
				};
				return toolOutput("research node output captured");
			},
		});

		const harness = this.createHarness({
			model: this.deps.model,
			thinkingLevel: this.deps.modelPolicy.thinking_level as "xhigh",
			cwd: this.deps.cwdForNode(node.id, node.attempts),
			systemPrompt: `You are the ${role} worker for one GeoRSI WorkGraph node. Work only from the bounded context and exposed tools. Do not invent evidence or claim that an unexecuted computation occurred.`,
			customTools: [...scientificTools, artifactTool, submitTool],
			promptTimeoutMs: node.budget.wallMs,
			stallMs: Math.min(this.deps.stallMs ?? 120_000, node.budget.wallMs),
			maxOutputTokens: outputCap,
			// Bounded transient-error resilience from the unified gateway routing layer
			// (research_gateways.*.resilience.session_retries; luna-smoke-004 lesson).
			maxRetries: this.deps.modelPolicy.resilience?.session_retries ?? 10,
			builtinTools: [],
			exchangeTools: false,
		});
		const abortListener = (): void => harness.abort();
		signal.addEventListener("abort", abortListener, { once: true });
		let outcome: PromptOutcome;
		try {
			await harness.init();
			outcome = await harness.prompt(`${context.text}\n\nExecute node ${node.id}. Persist every produced result through a tool, then call submit_research_node_output exactly once. IMPORTANT: every verifications[].input_artifact must be an artifact id returned by a scientific tool (resultArtifactId / evidenceIds), never a model-artifact handle.`, remainingWallMs());
		} finally {
			signal.removeEventListener("abort", abortListener);
			harness.dispose();
		}
		const observedReceipts = outcome.modelCalls?.length ? outcome.modelCalls : outcome.modelCall ? [outcome.modelCall] : [];
		for (const receipt of observedReceipts) {
			this.modelReceiptsValue.push(receipt);
			this.deps.onModelReceipt?.(receipt);
		}
		if (signal.aborted) throw new Error(`research node ${node.id} was aborted`);
		if (outcome.error || outcome.aborted || outcome.timedOut || outcome.stalled) throw new Error(`research node prompt failed: ${outcome.error ?? "aborted"}`);
		if (!observedReceipts.length) throw new Error("research node produced no exact model-call receipts");
		if (new Set(observedReceipts.map((receipt) => receipt.id)).size !== observedReceipts.length) throw new Error("research node produced duplicate model-call receipt IDs");
		const receiptIssue = observedReceipts.map((receipt) => exactModelReceiptIssue(receipt, this.deps.modelPolicy)).find((issue) => issue !== null);
		if (receiptIssue) throw new Error(receiptIssue);
		const outputTokens = observedReceipts.reduce((sum, receipt) => sum + receipt.outputTokens!, 0);
		if (outputTokens > aggregateOutputCap) throw new Error(`research node exceeded aggregate output cap: ${outputTokens}/${aggregateOutputCap}`);
		if (!submission) throw new Error("research node did not call submit_research_node_output");
		const captured = submission as CapturedSubmission;
		if (stableJson(captured).length > aggregateOutputCap * 8) throw new Error("captured research node output exceeds bounded aggregate size");
		if (new Set(captured.artifactIds).size !== captured.artifactIds.length) throw new Error("research node submission contains duplicate artifact IDs");
		const stagedHandles = new Set(pendingArtifacts.map((artifact) => artifact.handle));
		for (const id of captured.artifactIds) if (!stagedHandles.has(id) && !producedToolArtifacts.has(id)) throw new Error(`research node submitted an invented artifact ID: ${id}`);
		const knownForLinks = new Set([...evidenceIds, ...producedToolArtifacts, ...stagedHandles]);
		for (const decision of captured.decisions) for (const id of decision.evidenceIds) if (!knownForLinks.has(id)) throw new Error(`decision cites unknown evidence: ${id}`);
		const verificationProfiles = captured.verifications.map((verification) => verification.profile);
		if (new Set(verificationProfiles).size !== verificationProfiles.length) throw new Error("research node submitted duplicate verifier profiles");
		const expectedProfile = profileForNode(node.kind);
		if (expectedProfile && !verificationProfiles.includes(expectedProfile)) throw new Error(`node ${node.id} requires ${expectedProfile} verification input`);
		for (const verification of captured.verifications) {
			for (const id of verification.evidenceIds) if (!knownForLinks.has(id)) throw new Error(`verifier input cites unknown evidence: ${id}`);
			if (!producedToolArtifacts.has(verification.inputArtifactId)) throw new Error(`verifier input must reference a tool-produced CAS artifact, not model-staged content: ${verification.inputArtifactId}`);
		}
		const claimIds = new Set<string>();
		for (const claim of captured.claims ?? []) {
			if (claimIds.has(claim.id)) throw new Error(`duplicate research claim ID: ${claim.id}`);
			claimIds.add(claim.id);
			for (const id of claim.evidenceIds) if (!knownForLinks.has(id)) throw new Error(`claim cites unknown evidence: ${id}`);
		}
		for (const hypothesis of captured.hypotheses ?? []) {
			for (const id of hypothesis.rationaleEvidenceIds) if (!knownForLinks.has(id)) throw new Error(`hypothesis cites unknown evidence: ${id}`);
		}
		if (captured.valueCard) {
			for (const dimension of [captured.valueCard.significance, captured.valueCard.novelty, captured.valueCard.falsifiability, captured.valueCard.dataFeasibility, captured.valueCard.methodologicalValue, captured.valueCard.potentialImpact]) for (const id of dimension.evidenceIds) if (!knownForLinks.has(id)) throw new Error(`value card cites unknown evidence: ${id}`);
		}
		if (captured.narrative) {
			for (const section of Object.values(captured.narrative)) {
				if (!section.text.trim() || section.evidenceIds.length === 0) throw new Error("narrative sections require text and evidence");
				for (const id of section.evidenceIds) if (!knownForLinks.has(id)) throw new Error(`narrative cites unknown evidence: ${id}`);
				for (const id of section.claimIds ?? []) if (!claimIds.has(id)) throw new Error(`narrative cites unknown claim: ${id}`);
			}
		}
		for (const link of captured.contraryEvidenceLinks ?? []) {
			const reference = this.deps.evidenceById(link.sourceEvidenceId);
			if (!reference || reference.kind !== "source" || !claimIds.has(link.claimId)) throw new Error("contrary evidence must bind a known source and claim");
		}
		if (node.kind === "synthesis" && (!captured.claims?.length || !captured.valueCard || !captured.narrative)) throw new Error("synthesis node must submit claims, value card, and grounded narrative");

		ensureActive();
		const handleMap = new Map<string, string>();
		for (const artifact of pendingArtifacts) {
			const reference = this.deps.evidenceStore.putText(artifact.content, { kind: artifact.kind, logicalName: artifact.logicalName, producerNodeId: node.id, mediaType: artifact.mediaType });
			this.deps.registerEvidence(reference);
			handleMap.set(artifact.handle, reference.id);
		}
		const canonicalize = (id: string): string => handleMap.get(id) ?? id;
		const verificationInputEvidenceIds: Record<string, string> = {};
		const verificationEvidenceIds: Record<string, string[]> = {};
		for (const verification of captured.verifications) {
			const canonicalEvidenceIds = unique(verification.evidenceIds.map(canonicalize));
			const canonicalInputArtifact = canonicalize(verification.inputArtifactId);
			if (!producedToolArtifacts.has(canonicalInputArtifact) && !producedToolArtifacts.has(verification.inputArtifactId)) throw new Error(`verifier input artifact is not tool-produced: ${verification.inputArtifactId}`);
			verificationInputEvidenceIds[verification.profile] = canonicalInputArtifact;
			verificationEvidenceIds[verification.profile] = canonicalEvidenceIds;
		}
		const canonicalArtifacts = unique(captured.artifactIds.map(canonicalize));
		const canonicalHypotheses = captured.hypotheses?.map((hypothesis) => ({ ...hypothesis, rationaleEvidenceIds: hypothesis.rationaleEvidenceIds.map(canonicalize) }));
		const canonicalClaims = captured.claims?.map((claim) => ({ ...claim, evidenceIds: claim.evidenceIds.map(canonicalize) }));
		const canonicalValueCard = captured.valueCard ? {
			...captured.valueCard,
			significance: { ...captured.valueCard.significance, evidenceIds: captured.valueCard.significance.evidenceIds.map(canonicalize) },
			novelty: { ...captured.valueCard.novelty, evidenceIds: captured.valueCard.novelty.evidenceIds.map(canonicalize) },
			falsifiability: { ...captured.valueCard.falsifiability, evidenceIds: captured.valueCard.falsifiability.evidenceIds.map(canonicalize) },
			dataFeasibility: { ...captured.valueCard.dataFeasibility, evidenceIds: captured.valueCard.dataFeasibility.evidenceIds.map(canonicalize) },
			methodologicalValue: { ...captured.valueCard.methodologicalValue, evidenceIds: captured.valueCard.methodologicalValue.evidenceIds.map(canonicalize) },
			potentialImpact: { ...captured.valueCard.potentialImpact, evidenceIds: captured.valueCard.potentialImpact.evidenceIds.map(canonicalize) },
		} : undefined;
		const canonicalNarrative = captured.narrative ? Object.fromEntries(Object.entries(captured.narrative).map(([key, section]) => [key, { ...section, evidenceIds: section.evidenceIds.map(canonicalize) }])) as ResearchNarrative : undefined;
		const canonicalContraryLinks = captured.contraryEvidenceLinks?.map((link) => ({ sourceEvidenceId: canonicalize(link.sourceEvidenceId), claimId: link.claimId }));
		const persistedSubmission: ResearchNodeSubmission = {
			version: 1,
			summary: sanitizeResearchEvidence(captured.summary) as string,
			artifactIds: canonicalArtifacts,
			decisions: captured.decisions.map((decision) => ({ ...decision, evidenceIds: decision.evidenceIds.map(canonicalize) })),
			verifications: captured.verifications.map((verification) => ({ profile: verification.profile, inputArtifactId: canonicalize(verification.inputArtifactId), evidenceIds: verification.evidenceIds.map(canonicalize) })),
			hypotheses: canonicalHypotheses,
			claims: canonicalClaims,
			valueCard: canonicalValueCard,
			narrative: canonicalNarrative,
			contraryEvidenceLinks: canonicalContraryLinks,
		};
		this.submissions.set(node.id, persistedSubmission);
		const submissionReference = this.deps.evidenceStore.putJson({
			version: 1,
			nodeId: node.id,
			role,
			contextFingerprint: context.fingerprint,
			summary: sanitizeResearchEvidence(captured.summary),
			artifactIds: canonicalArtifacts,
			decisions: sanitizeResearchEvidence(captured.decisions.map((decision) => ({ ...decision, evidenceIds: decision.evidenceIds.map(canonicalize) }))),
			verificationInputEvidenceIds,
			modelReceiptIds: observedReceipts.map((receipt) => receipt.id),
			toolReceiptIds: nodeToolReceiptIds,
			claims: canonicalClaims,
			hypotheses: canonicalHypotheses,
			valueCard: canonicalValueCard,
			narrative: canonicalNarrative,
			contraryEvidenceLinks: canonicalContraryLinks,
		}, { kind: "tool-output", logicalName: `${node.id}-submission.json`, producerNodeId: node.id });
		this.deps.registerEvidence(submissionReference);
		this.deps.contextMemory?.commit(node.id, { id: submissionReference.id, sha256: submissionReference.sha256 }, persistedSubmission);
		return {
			artifactIds: unique([...canonicalArtifacts, ...Object.values(verificationInputEvidenceIds), submissionReference.id]),
			metadata: { nodeSubmissionEvidenceId: submissionReference.id, verificationInputEvidenceIds, verificationEvidenceIds, contextFingerprint: context.fingerprint, role },
			usage: { modelCalls: observedReceipts.length, toolCalls, outputTokens },
		};
	}

	async verifyNode(node: WorkNode, result: NodeExecutionResult, _graph: ResearchWorkGraph, signal: AbortSignal): Promise<NodeVerificationResult> {
		if (signal.aborted) return { passed: false, evidenceIds: [], issues: ["research node verification aborted"], usage: { modelCalls: 0, toolCalls: 0, outputTokens: 0 } };
		const issues: string[] = [];
		for (const id of result.artifactIds) {
			const reference = this.deps.evidenceById(id);
			if (!reference || !this.deps.evidenceStore.verify(reference)) issues.push(`node artifact is not canonical CAS evidence: ${id}`);
		}
		const metadata = result.metadata ?? {};
		const inputIds = metadata.verificationInputEvidenceIds && typeof metadata.verificationInputEvidenceIds === "object"
			? metadata.verificationInputEvidenceIds as Record<string, string>
			: {};
		const evidenceIdMap = metadata.verificationEvidenceIds && typeof metadata.verificationEvidenceIds === "object"
			? metadata.verificationEvidenceIds as Record<string, string[]>
			: {};
		const verifierEvidenceIds: string[] = [];
		for (const [profileValue, inputEvidenceId] of Object.entries(inputIds)) {
			if (!VERIFIER_PROFILES.includes(profileValue as FamilyVerifierProfile)) {
				issues.push(`unknown verifier profile: ${profileValue}`);
				continue;
			}
			const profile = profileValue as FamilyVerifierProfile;
			const inputReference = this.deps.evidenceById(inputEvidenceId);
			if (!inputReference || !this.deps.evidenceStore.verify(inputReference)) {
				issues.push(`verifier input evidence is invalid: ${inputEvidenceId}`);
				continue;
			}
			let payload: unknown;
			try { payload = JSON.parse(this.deps.evidenceStore.read(inputReference).toString("utf8")); }
			catch (error) {
				issues.push(`verifier input artifact is not valid JSON: ${profile}: ${error instanceof Error ? error.message : String(error)}`);
				continue;
			}
			const linkedEvidenceIds = Array.isArray(evidenceIdMap[profile]) ? evidenceIdMap[profile]!.filter((id): id is string => typeof id === "string") : [];
			const linkedEvidence = linkedEvidenceIds.map((id) => this.deps.evidenceById(id)).filter((reference): reference is EvidenceRef => !!reference);
			if (linkedEvidenceIds.length === 0 || linkedEvidence.length !== linkedEvidenceIds.length) {
				issues.push(`verifier input is not bound to canonical evidence: ${profile}`);
				continue;
			}
			if (linkedEvidenceIds.some((id) => {
				const reference = this.deps.evidenceById(id);
				return !reference || !this.deps.evidenceStore.verify(reference);
			})) {
				issues.push(`verifier input cites unknown or corrupt evidence: ${profile}`);
				continue;
			}
			const bindingIssues = validateFamilyEvidenceBinding(profile, payload, linkedEvidence);
			if (bindingIssues.length > 0) {
				issues.push(...bindingIssues);
				continue;
			}
			let verification: ScientificVerificationResult;
			try { verification = dispatchFamilyVerifier(profile, payload); }
			catch (error) {
				issues.push(`${profile} verifier crashed: ${error instanceof Error ? error.message : String(error)}`);
				continue;
			}
			const resultReference = this.deps.evidenceStore.putJson({ version: 1, profile, inputEvidenceId, evidenceIds: linkedEvidenceIds, result: verification }, { kind: "verifier", logicalName: `${node.id}-${profile}-result.json`, producerNodeId: node.id });
			this.deps.registerEvidence(resultReference);
			verifierEvidenceIds.push(resultReference.id);
			if (!verification.passed) {
				issues.push(...verification.issues.filter((issue) => issue.severity === "error").map((issue) => `${profile}:${issue.code}:${issue.message}`));
				continue;
			}
			this.familyAttestations.set(profile, {
				profile,
				result: verification,
				inputHash: familyInputHash(profile, payload, linkedEvidenceIds),
				evidenceIds: unique([...linkedEvidenceIds, inputReference.id, resultReference.id]),
			});
		}
		if (node.kind === "verification") {
			const required = requiredFamilyVerifierProfiles(this.deps.mission.taskProfile).sort();
			const actual = [...this.familyAttestations.keys()].sort();
			if (JSON.stringify(required) !== JSON.stringify(actual)) issues.push(`verification node requires exact family profiles: ${required.join(",")}`);
		}
		return {
			passed: issues.length === 0,
			evidenceIds: issues.length === 0 ? unique([...result.artifactIds, ...verifierEvidenceIds]) : verifierEvidenceIds,
			issues,
			usage: { modelCalls: 0, toolCalls: 0, outputTokens: 0 },
		};
	}
}
