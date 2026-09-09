import type { Model } from "@earendil-works/pi-ai";
import type { ResearchModelConfig } from "../config.js";
import { Type } from "typebox";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capHarnessModelOutput, type HarnessOpts, type PromptOutcome } from "../piharness.js";
import type { EvidenceRef, ResearchMission, ResearchWorkGraph, WorkNode } from "./contracts.js";
import { ContentAddressedEvidenceStore } from "./evidence-store.js";
import { ResearchNodeExecutor, type ResearchHarness } from "./research-node-executor.js";
import { ResearchContextMemory } from "./context-memory.js";
import type { ModelCallReceipt } from "./runtime-attestation.js";
import { createSandboxiePythonResearchTool, attestComputeReplay, validateSandboxieComputeReceipt, type SandboxieComputeRunReceipt, type SandboxieResearchComputePort } from "./sandboxie-compute.js";
import { SEED_STRATEGY_BUNDLE } from "./strategy-bundle.js";
import { ScientificToolRegistry } from "./tool-registry.js";

let passed = 0;
function check(label: string, condition: unknown): void {
	if (!condition) throw new Error(`FAIL: ${label}`);
	passed += 1;
	console.log(`  ok   ${label}`);
}

const researchModelPolicy: ResearchModelConfig = {
	provider: "alsl",
	base_url: "https://ai.alsl.xyz/v1",
	model: "gpt-5.6-luna",
	api: "openai-responses",
	thinking_level: "xhigh",
	max_tokens_field: "max_completion_tokens",
	credential_env: "GEORSI_RESEARCH_API_KEY",
	fallback: "none",
	context_window: 600_000,
	max_output: 128_000,
	supports_developer_role: true,
	supports_reasoning_effort: true,
	supports_usage: true,
	supports_tool_loop: true,
	require_provider_observed_thinking: true,
};

function lunaModel(overrides: Record<string, unknown> = {}): Model<any> {
	return {
		id: "gpt-5.6-luna",
		name: "gpt-5.6-luna",
		provider: "alsl",
		api: "openai-responses",
		baseUrl: "https://invalid.test/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 600_000,
		maxTokens: 16_384,
		thinkingLevelMap: { xhigh: "xhigh" },
		...overrides,
	} as Model<any>;
}

function receipt(overrides: Partial<ModelCallReceipt> = {}): ModelCallReceipt {
	return {
		id: "response-1",
		provider: "alsl",
		model: "gpt-5.6-luna",
		requestedThinking: "xhigh",
		effectiveThinking: "xhigh",
		inputTokens: 200,
		outputTokens: 100,
		reasoningTokens: 50,
		totalTokens: 300,
		success: true,
		api: "openai-responses",
		stopReason: "stop",
		...overrides,
	};
}

const quantitativeInput = {
	rowCount: 10,
	missingCount: 0,
	duplicateCount: 0,
	columnsAudited: ["magnitude"],
	units: { magnitude: "Mw" },
	estimand: "b value",
	method: "Aki maximum likelihood",
	stochasticMethod: false,
	finiteOutputs: true,
	uncertainty: { method: "bootstrap", lower: 0.8, upper: 1.2 },
	sensitivityRuns: 2,
	independentCheck: { method: "direct formula", relativeDifference: 0.001, tolerance: 0.01 },
};

const mission: ResearchMission = {
	version: 1,
	id: "research-executor-selftest",
	question: "Estimate a test b value",
	scope: "deterministic executor fixture",
	estimands: ["b value"],
	units: ["dimensionless"],
	assumptions: [],
	constraints: ["fixture only"],
	successCriteria: [{ id: "criterion", description: "verified output", kind: "evidence", required: true }],
	requiredDeliverables: [{ id: "table", kind: "table", path: "result.json", required: true, description: "result" }],
	sourcePolicy: { networkMode: "blocked", requireProvenance: true, requireContentHash: true, requireLicenseMetadata: false, requireRetrievedAt: false, requireContraryEvidence: false },
	taskProfile: { family: "quantitative", requiredStages: ["quantitative-analysis", "verification"], capabilities: ["compute"], verifierProfile: "quantitative-v1", deliverableSchema: "fixture-v1", sourceRequirements: [], networkMode: "blocked" },
};

function makeNode(kind: WorkNode["kind"] = "quantitative-analysis"): WorkNode {
	return {
		id: `node-${kind}`,
		kind,
		title: "fixture node",
		state: "running",
		dependsOn: [],
		inputEvidenceIds: [],
		expectedOutputs: ["result"],
		acceptanceCriteriaIds: ["criterion"],
		allowedCapabilities: ["compute"],
		budget: { wallMs: 30_000, maxModelCalls: 2, maxToolCalls: 6, maxOutputTokens: 1000, maxAttempts: 1 },
		attempts: 1,
		outputArtifactIds: [],
		acceptanceEvidenceIds: [],
	};
}

function makeGraph(node: WorkNode): ResearchWorkGraph {
	return { version: 1, missionId: mission.id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", nodes: [node] };
}

type ToolLike = { name: string; execute: (...args: any[]) => Promise<any> };
function tool(opts: HarnessOpts, name: string): ToolLike {
	const found = opts.customTools.find((candidate) => candidate.name === name);
	if (!found) throw new Error(`missing fake harness tool ${name}`);
	return found as unknown as ToolLike;
}

function textResult(result: any): string {
	return result.content?.find((item: any) => item.type === "text")?.text ?? "";
}

function successOutcome(call = receipt()): PromptOutcome {
	return { aborted: false, timedOut: false, stalled: false, error: null, tokens: call.totalTokens, secs: 0.01, modelCall: call, modelCalls: [call] };
}

async function main(): Promise<void> {
	console.log("== Research node executor ==");
	const root = mkdtempSync(join(tmpdir(), "georsi-research-executor-"));
	try {
		const store = new ContentAddressedEvidenceStore(join(root, "evidence"));
		const references = new Map<string, EvidenceRef>();
		const registry = new ScientificToolRegistry();
		const contextMemory = new ResearchContextMemory({ evidenceStore: store, evidenceById: (id) => references.get(id) });
		registry.register({
			id: "quant-result",
			version: "1",
			capability: "compute",
			validate: () => [],
			execute: async (context, input: { value: unknown }) => {
				const reference = store.putJson(input.value, { kind: "tool-output", logicalName: `${context.nodeId}-quant-result.json`, producerNodeId: context.nodeId });
				return { output: { artifactIds: [reference.id] }, artifactIds: [reference.id], evidenceRefs: [reference] };
			},
		});
		let observedOpts: HarnessOpts | undefined;
		const fakeHarness = (invalidVerification = false, call = receipt()): ((opts: HarnessOpts) => ResearchHarness) => (opts) => {
			observedOpts = opts;
			return {
				init: async () => {},
				prompt: async () => {
					const quant = await tool(opts, "research_quant-result").execute("quant-call", { value: invalidVerification ? { ...quantitativeInput, units: {} } : quantitativeInput });
					const quantIds = JSON.parse(textResult(quant)) as { output: { artifactIds: string[] } };
					const staged = await tool(opts, "record_research_artifact").execute("artifact-call", { kind: "table", logical_name: "result.json", media_type: "application/json", content: JSON.stringify({ b: 1.0 }) });
					const handle = textResult(staged).split(" ").at(-1)!;
					await tool(opts, "submit_research_node_output").execute("submit-call", {
						version: 1,
						summary: "A bounded fixture result",
						artifact_ids: [handle],
						decisions: [{ question: "method", alternatives: ["Aki", "regression"], selected: "Aki", evidence_ids: [handle], uncertainty: "fixture uncertainty" }],
						verifications: [{ profile: "quantitative-v1", input_artifact: quantIds.output.artifactIds[0]!, evidence_ids: [handle, quantIds.output.artifactIds[0]!] }],
					});
					return successOutcome(call);
				},
				abort: () => {},
				dispose: () => {},
			};
		};
		const executor = new ResearchNodeExecutor({
			mission,
			strategy: SEED_STRATEGY_BUNDLE,
			modelPolicy: researchModelPolicy,
			model: lunaModel(),
			cwdForNode: (id) => join(root, id),
			evidenceStore: store,
			evidenceById: (id) => references.get(id),
			registerEvidence: (reference) => references.set(reference.id, reference),
			toolRegistry: registry,
			toolBindings: [{ toolId: "quant-result", description: "fixture verifier-input producer", parameters: Type.Object({ value: Type.Unknown() }) }],
			contextMemory,
			createHarness: fakeHarness(),
		});
		const node = makeNode();
		const execution = await executor.executeNode(node, makeGraph(node), new AbortController().signal);
		check("executor fixes Luna xhigh and keeps bounded retry for transient gateway errors", observedOpts?.thinkingLevel === "xhigh" && observedOpts.maxRetries === 10 && observedOpts.builtinTools?.length === 0 && observedOpts.exchangeTools === false);
		check("executor applies hard per-call output share", observedOpts?.maxOutputTokens === 500 && (capHarnessModelOutput(lunaModel(), 500) as { maxTokens?: number }).maxTokens === 500);
		check("executor reports exact model/tool/output usage", execution.usage.modelCalls === 1 && execution.usage.toolCalls === 3 && execution.usage.outputTokens === 100);
		check("executor only returns canonical CAS artifacts", execution.artifactIds.length >= 3 && execution.artifactIds.every((id) => !!references.get(id) && store.verify(references.get(id)!)));
		const verification = await executor.verifyNode(node, execution, makeGraph(node), new AbortController().signal);
		check("quantitative verification is deterministic and model-free", verification.passed && verification.usage.modelCalls === 0 && verification.usage.toolCalls === 0);
		check("family attestation binds input and canonical evidence", executor.familyVerifications().length === 1 && executor.familyVerifications()[0]?.profile === "quantitative-v1" && executor.familyVerifications()[0]!.evidenceIds.every((id) => references.has(id)));
		check("exact per-call research-model receipt is retained", executor.modelReceipts().length === 1 && executor.modelReceipts()[0]?.provider === "alsl");
		const committed = contextMemory.catalog().find((entry) => entry.nodeId === node.id);
		check("node submission commits read-only context memory with artifacts", committed !== undefined && committed.artifacts.length > 0 && contextMemory.fetch(committed.artifacts[0]!.evidenceId).excerpt.length > 0);
		check("graph state is synced before node context assembly", contextMemory.progress()[node.id] === "running");

		let wrongModelRejected = false;
		try {
			new ResearchNodeExecutor({ mission, strategy: SEED_STRATEGY_BUNDLE, modelPolicy: researchModelPolicy, model: lunaModel({ provider: "other" }), cwdForNode: (id) => join(root, id), evidenceStore: store, evidenceById: (id) => references.get(id), registerEvidence: (reference) => references.set(reference.id, reference), toolRegistry: registry, toolBindings: [] });
		} catch { wrongModelRejected = true; }
		check("constructor rejects model identity outside research_model policy", wrongModelRejected);

		const beforeFailed = references.size;
		const failedExecutor = new ResearchNodeExecutor({ mission, strategy: SEED_STRATEGY_BUNDLE, modelPolicy: researchModelPolicy, model: lunaModel(), cwdForNode: (id) => join(root, id), evidenceStore: store, evidenceById: (id) => references.get(id), registerEvidence: (reference) => references.set(reference.id, reference), toolRegistry: registry, toolBindings: [], createHarness: fakeHarness(false, receipt({ effectiveThinking: "high" })) });
		let downgradeRejected = false;
		try { await failedExecutor.executeNode(node, makeGraph(node), new AbortController().signal); }
		catch { downgradeRejected = true; }
		check("downgraded receipt fails before model artifacts persist", downgradeRejected && references.size === beforeFailed);

		const invalidExecutor = new ResearchNodeExecutor({ mission, strategy: SEED_STRATEGY_BUNDLE, modelPolicy: researchModelPolicy, model: lunaModel(), cwdForNode: (id) => join(root, id), evidenceStore: store, evidenceById: (id) => references.get(id), registerEvidence: (reference) => references.set(reference.id, reference), toolRegistry: registry, toolBindings: [{ toolId: "quant-result", description: "fixture verifier-input producer", parameters: Type.Object({ value: Type.Unknown() }) }], createHarness: fakeHarness(true) });
		const invalidExecution = await invalidExecutor.executeNode(node, makeGraph(node), new AbortController().signal);
		const invalidResult = await invalidExecutor.verifyNode(node, invalidExecution, makeGraph(node), new AbortController().signal);
		check("invalid quantitative fixture cannot pass deterministic verifier", !invalidResult.passed && invalidResult.issues.some((issue) => issue.includes("units")));

		const forgedHarness = (opts: HarnessOpts): ResearchHarness => ({
			init: async () => {},
			prompt: async () => {
				const staged = await tool(opts, "record_research_artifact").execute("forged-artifact", { kind: "table", logical_name: "forged.json", media_type: "application/json", content: JSON.stringify(quantitativeInput) });
				const handle = textResult(staged).split(" ").at(-1)!;
				await tool(opts, "submit_research_node_output").execute("forged-submit", {
					version: 1,
					summary: "forged verifier input",
					artifact_ids: [handle],
					decisions: [],
					verifications: [{ profile: "quantitative-v1", input_artifact: handle, evidence_ids: [handle] }],
				});
				return successOutcome();
			},
			abort: () => {},
			dispose: () => {},
		});
		const forgedExecutor = new ResearchNodeExecutor({ mission, strategy: SEED_STRATEGY_BUNDLE, modelPolicy: researchModelPolicy, model: lunaModel(), cwdForNode: (id) => join(root, id), evidenceStore: store, evidenceById: (id) => references.get(id), registerEvidence: (reference) => references.set(reference.id, reference), toolRegistry: registry, toolBindings: [{ toolId: "quant-result", description: "fixture verifier-input producer", parameters: Type.Object({ value: Type.Unknown() }) }], createHarness: forgedHarness });
		let forgedInputRejected = false;
		try { await forgedExecutor.executeNode(makeNode(), makeGraph(makeNode()), new AbortController().signal); }
		catch (error) { forgedInputRejected = String(error).includes("tool-produced CAS artifact"); }
		check("model-staged verifier input is rejected in favor of tool-produced CAS artifacts", forgedInputRejected);

		const signalRegistry = new ScientificToolRegistry();
		let signalToolRan = false;
		signalRegistry.register({ id: "sig", version: "1", capability: "compute", validate: () => [], execute: async () => { signalToolRan = true; return { output: {} }; } });
		const abortedController = new AbortController();
		abortedController.abort();
		let abortedToolRejected = false;
		try { await signalRegistry.execute("sig", { missionId: "m", episodeId: "e", nodeId: "n", allowedCapabilities: ["compute"], remainingWallMs: 1000, signal: abortedController.signal }, {}); }
		catch { abortedToolRejected = true; }
		check("scientific tool registry refuses aborted signals before execution", abortedToolRejected && !signalToolRan);

		const toolRegistry = new ScientificToolRegistry(() => new Date("2026-01-01T00:00:00.000Z"), () => "tool-receipt");
		toolRegistry.register({
			id: "compute",
			version: "1",
			capability: "compute",
			validate: () => [],
			execute: async (context, input: { value: number }) => {
				const reference = store.putJson({ value: input.value * 2 }, { kind: "tool-output", logicalName: "compute.json", producerNodeId: context.nodeId });
				return { output: { value: input.value * 2 }, artifactIds: [reference.id], evidenceRefs: [reference] };
			},
		});
		let toolOpts: HarnessOpts | undefined;
		const toolHarness = (opts: HarnessOpts): ResearchHarness => {
			toolOpts = opts;
			return {
				init: async () => {},
				prompt: async () => {
					const computed = await tool(opts, "research_compute").execute("compute-call", { value: 2 });
					const parsed = JSON.parse(textResult(computed)) as { artifactIds: string[] };
					await tool(opts, "submit_research_node_output").execute("submit-call", { version: 1, summary: "computed", artifact_ids: parsed.artifactIds, decisions: [], verifications: [] });
					return successOutcome(receipt({ id: "response-tool" }));
				},
				abort: () => {},
				dispose: () => {},
			};
		};
		const toolNode = makeNode("data-audit");
		const toolExecutor = new ResearchNodeExecutor({ mission, strategy: SEED_STRATEGY_BUNDLE, modelPolicy: researchModelPolicy, model: lunaModel(), cwdForNode: (id) => join(root, id), evidenceStore: store, evidenceById: (id) => references.get(id), registerEvidence: (reference) => references.set(reference.id, reference), toolRegistry, toolBindings: [{ toolId: "compute", description: "deterministic boxed compute fixture", parameters: Type.Object({ value: Type.Number() }) }], createHarness: toolHarness });
		const toolExecution = await toolExecutor.executeNode(toolNode, makeGraph(toolNode), new AbortController().signal);
		check("capability-bound scientific tool produces registered CAS evidence", toolExecution.usage.toolCalls === 2 && toolExecutor.toolReceipts().length === 1 && toolExecution.artifactIds.every((id) => references.has(id)));
		check("only capability-bound tools and capture tools are exposed", toolOpts?.customTools.map((item) => item.name).sort().join(",") === "record_research_artifact,research_compute,submit_research_node_output");

		const computeReceipts: SandboxieComputeRunReceipt[] = [];
		const sandboxPort: SandboxieResearchComputePort = {
			run: async (request) => {
				const generated = store.putJson({ result: 4 }, { kind: "table", logicalName: "boxed-result.json", producerNodeId: request.nodeId });
				return { version: 1, id: "boxed-run-1", backend: "sandboxie-app-level", boxName: "GeoRSI_fixture", networkMode: request.networkMode, processOwnershipVerified: true, targetPids: [4242], exitCode: 0, timedOut: false, stdout: "ok", stderr: "", generatedEvidence: [generated], cleanup: { terminated: true, deletedData: true, removedConfig: true, reloaded: true, boxStillEnabled: false, globalWfpRestored: true, leaseReleased: true, errors: [] }, scriptSha256: "0".repeat(64) };
			},
			replay: async () => ({ passed: true, backend: "sandboxie-app-level", processOwnershipVerified: true }),
		};
		const sandboxRegistry = new ScientificToolRegistry();
		sandboxRegistry.register(createSandboxiePythonResearchTool({ port: sandboxPort, evidenceStore: store, networkMode: "blocked", onRunReceipt: (runReceipt) => computeReceipts.push(runReceipt) }));
		const boxed = await sandboxRegistry.execute("sandboxie-python", { missionId: mission.id, episodeId: mission.id, nodeId: "boxed", allowedCapabilities: ["sandboxie-python"], remainingWallMs: 30_000 }, { purpose: "fixture", script: "print(4)", timeoutMs: 1000 });
		check("Sandboxie compute tool requires ownership cleanup and canonical evidence", boxed.receipt.status === "success" && computeReceipts.length === 1 && boxed.result.evidenceRefs?.every((reference) => store.verify(reference)));
		check("Sandboxie compute replay attestation remains backend-bound", (await attestComputeReplay(sandboxPort, computeReceipts)).passed);
		check("host-like compute receipt cannot satisfy Sandboxie gate", validateSandboxieComputeReceipt({ ...computeReceipts[0]!, backend: "host-audit" as never }, "blocked").some((issue) => issue.includes("did not use Sandboxie")));

		console.log(`RESEARCH_NODE_EXECUTOR_OK ${passed} passed`);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

await main();
