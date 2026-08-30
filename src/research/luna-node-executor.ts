/** Production adapter from WorkGraph nodes to one bounded Luna xhigh Pi session. */
import { createHash } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { PiHarness, toolOutput, type HarnessOpts, type PromptOutcome } from "../piharness.js";
import type { EvidenceRef, ResearchMission, ResearchWorkGraph, WorkNode, WorkNodeKind } from "./contracts.js";
import { buildContextPack, type ContextBlock, type ContextPack } from "./context-manager.js";
import type { ContentAddressedEvidenceStore } from "./evidence-store.js";
import { sanitizeResearchEvidence, stableJson } from "./event-ledger.js";
import { requiredFamilyVerifierProfiles, type FamilyVerificationAttestation, type ModelCallReceipt } from "./runtime-attestation.js";
import type { NodeExecutionResult, NodeVerificationResult } from "./scheduler.js";
import type { StrategyBundle } from "./strategy-bundle.js";
import { validateStrategyBundle } from "./strategy-bundle.js";
import { roleOutputCap } from "./token-policy.js";
import type { ScientificToolReceipt, ScientificToolRegistry } from "./tool-registry.js";
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

export interface LunaResearchNodeExecutorDeps {
	mission: ResearchMission;
	strategy: StrategyBundle;
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

interface CapturedVerification {
	profile: FamilyVerifierProfile;
	input: unknown;
	evidenceIds: string[];
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
}

const VERIFIER_PROFILES = ["quantitative-v1", "gis-v1", "literature-v1"] as const;

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
		input: Type.Unknown(),
		evidence_ids: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { minItems: 1, maxItems: 64 }),
	}), { maxItems: 3 }),
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

function exactLunaReceiptIssue(receipt: ModelCallReceipt): string | null {
	if (receipt.provider !== "ai-pixel") return `model call ${receipt.id} used provider ${receipt.provider}`;
	if (receipt.model !== "gpt-5.6-luna") return `model call ${receipt.id} used model ${receipt.model}`;
	if (receipt.requestedThinking !== "xhigh" || receipt.effectiveThinking !== "xhigh") return `model call ${receipt.id} did not prove xhigh`;
	if (!receipt.success) return `model call ${receipt.id} failed`;
	if (receipt.outputTokens == null || !Number.isSafeInteger(receipt.outputTokens) || receipt.outputTokens <= 0) return `model call ${receipt.id} has no observable output-token usage`;
	return null;
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
		{ id: `budget-${node.id}`, kind: "budget", mandatory: true, priority: 100, content: stableJson(node.budget) },
		...directDependencies.map((dependency) => ({ id: `dependency-${dependency.id}`, kind: "dependency" as const, mandatory: true, priority: 90, content: stableJson({ id: dependency.id, kind: dependency.kind, state: dependency.state, outputArtifactIds: dependency.outputArtifactIds, acceptanceEvidenceIds: dependency.acceptanceEvidenceIds }) })),
		...relevantEvidence.map((reference) => ({ id: `evidence-${reference.id}`, kind: "evidence" as const, mandatory: false, priority: 80, sourceHash: reference.sha256, content: stableJson(reference).slice(0, strategy.context.artifactSummaryChars) })),
		...recipes.map((recipe) => ({ id: `recipe-${recipe.id}`, kind: "recipe" as const, mandatory: false, priority: 60, content: stableJson(recipe) })),
	];
	return buildContextPack(blocks, budget!);
}

export class LunaResearchNodeExecutor {
	private readonly now: () => Date;
	private readonly createHarness: (opts: HarnessOpts) => ResearchHarness;
	private readonly modelReceiptsValue: ModelCallReceipt[] = [];
	private readonly toolReceiptsValue: ScientificToolReceipt[] = [];
	private readonly familyAttestations = new Map<string, FamilyVerificationAttestation>();

	constructor(private readonly deps: LunaResearchNodeExecutorDeps) {
		const strategyIssues = validateStrategyBundle(deps.strategy);
		if (strategyIssues.length > 0) throw new Error(`invalid Luna research strategy: ${strategyIssues.join("; ")}`);
		const model = deps.model as { id?: string; provider?: string; api?: string };
		if (model.id !== "gpt-5.6-luna" || model.provider !== "ai-pixel" || model.api !== "openai-responses") {
			throw new Error(`research executor requires ai-pixel/gpt-5.6-luna via openai-responses; got ${model.provider ?? "?"}/${model.id ?? "?"}/${model.api ?? "?"}`);
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
							executed = await this.deps.toolRegistry.execute(tool.id, { missionId: this.deps.mission.id, episodeId: this.deps.mission.id, nodeId: node.id, allowedCapabilities: node.allowedCapabilities, remainingWallMs: remainingWallMs() }, params);
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
			description: "Submit the node result exactly once. Only scientific-tool evidence IDs and staged model-artifact handles are accepted.",
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
					verifications: params.verifications.map((verification) => ({ profile: verification.profile, input: verification.input, evidenceIds: verification.evidence_ids })),
				};
				return toolOutput("research node output captured");
			},
		});

		const harness = this.createHarness({
			model: this.deps.model,
			thinkingLevel: "xhigh",
			cwd: this.deps.cwdForNode(node.id, node.attempts),
			systemPrompt: `You are the ${role} worker for one GeoRSI WorkGraph node. Work only from the bounded context and exposed tools. Do not invent evidence or claim that an unexecuted computation occurred.`,
			customTools: [...scientificTools, artifactTool, submitTool],
			promptTimeoutMs: node.budget.wallMs,
			stallMs: Math.min(this.deps.stallMs ?? 120_000, node.budget.wallMs),
			maxOutputTokens: outputCap,
			maxRetries: 0,
			builtinTools: [],
			exchangeTools: false,
		});
		const abortListener = (): void => harness.abort();
		signal.addEventListener("abort", abortListener, { once: true });
		let outcome: PromptOutcome;
		try {
			await harness.init();
			outcome = await harness.prompt(`${context.text}\n\nExecute node ${node.id}. Persist every produced result through a tool, then call submit_research_node_output exactly once.`, remainingWallMs());
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
		if (outcome.error || outcome.aborted || outcome.timedOut || outcome.stalled) throw new Error(`Luna research node prompt failed: ${outcome.error ?? "aborted"}`);
		if (!observedReceipts.length) throw new Error("Luna research node produced no exact model-call receipts");
		const receiptIssue = observedReceipts.map(exactLunaReceiptIssue).find((issue) => issue !== null);
		if (receiptIssue) throw new Error(receiptIssue);
		const outputTokens = observedReceipts.reduce((sum, receipt) => sum + receipt.outputTokens!, 0);
		if (outputTokens > aggregateOutputCap) throw new Error(`Luna research node exceeded aggregate output cap: ${outputTokens}/${aggregateOutputCap}`);
		if (!submission) throw new Error("Luna research node did not call submit_research_node_output");
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
		for (const verification of captured.verifications) for (const id of verification.evidenceIds) if (!knownForLinks.has(id)) throw new Error(`verifier input cites unknown evidence: ${id}`);

		ensureActive();
		const handleMap = new Map<string, string>();
		for (const artifact of pendingArtifacts) {
			const reference = this.deps.evidenceStore.putText(artifact.content, { kind: artifact.kind, logicalName: artifact.logicalName, producerNodeId: node.id, mediaType: artifact.mediaType });
			this.deps.registerEvidence(reference);
			handleMap.set(artifact.handle, reference.id);
		}
		const canonicalize = (id: string): string => handleMap.get(id) ?? id;
		const verificationInputEvidenceIds: Record<string, string> = {};
		for (const verification of captured.verifications) {
			const canonicalEvidenceIds = unique(verification.evidenceIds.map(canonicalize));
			const safeInput = sanitizeResearchEvidence(verification.input);
			const reference = this.deps.evidenceStore.putJson({ version: 1, profile: verification.profile, input: safeInput, evidenceIds: canonicalEvidenceIds }, { kind: "tool-output", logicalName: `${node.id}-${verification.profile}-input.json`, producerNodeId: node.id });
			this.deps.registerEvidence(reference);
			verificationInputEvidenceIds[verification.profile] = reference.id;
		}
		const canonicalArtifacts = unique(captured.artifactIds.map(canonicalize));
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
		}, { kind: "tool-output", logicalName: `${node.id}-submission.json`, producerNodeId: node.id });
		this.deps.registerEvidence(submissionReference);
		return {
			artifactIds: unique([...canonicalArtifacts, ...Object.values(verificationInputEvidenceIds), submissionReference.id]),
			metadata: { nodeSubmissionEvidenceId: submissionReference.id, verificationInputEvidenceIds, contextFingerprint: context.fingerprint, role },
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
			let payload: { profile?: unknown; input?: unknown; evidenceIds?: unknown };
			try { payload = JSON.parse(this.deps.evidenceStore.read(inputReference).toString("utf8")) as typeof payload; }
			catch (error) {
				issues.push(`verifier input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
				continue;
			}
			const linkedEvidenceIds = Array.isArray(payload.evidenceIds) ? payload.evidenceIds.filter((id): id is string => typeof id === "string") : [];
			const linkedEvidence = linkedEvidenceIds.map((id) => this.deps.evidenceById(id)).filter((reference): reference is EvidenceRef => !!reference);
			if (payload.profile !== profile || linkedEvidenceIds.length === 0) {
				issues.push(`verifier input is not bound to profile/evidence: ${profile}`);
				continue;
			}
			if (linkedEvidenceIds.some((id) => {
				const reference = this.deps.evidenceById(id);
				return !reference || !this.deps.evidenceStore.verify(reference);
			})) {
				issues.push(`verifier input cites unknown or corrupt evidence: ${profile}`);
				continue;
			}
			const bindingIssues = validateFamilyEvidenceBinding(profile, payload.input, linkedEvidence);
			if (bindingIssues.length > 0) {
				issues.push(...bindingIssues);
				continue;
			}
			let verification: ScientificVerificationResult;
			try { verification = dispatchFamilyVerifier(profile, payload.input); }
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
				inputHash: familyInputHash(profile, payload.input, linkedEvidenceIds),
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
