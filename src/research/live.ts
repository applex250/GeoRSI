/** Production composition for a real Luna-backed research competition run. */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { Type } from "typebox";
import { ROOT, researchModelConfigFingerprint, validateResearchModelConfig, type Config } from "../config.js";
import { getPiRuntime } from "../provider.js";
import { loadProfiles } from "../models.js";
import { atomicWriteJson, writeTextAtomic } from "../journal.js";
import { scanTextForBreaches, scanWorkspaceForBreachesStrict } from "../guard.js";
import { assertExchangeWorkspace } from "../workspace-tools.js";
import { assertSandboxPythonCommand, resolveExchangeWorkspace, SandboxieAdapter } from "../sandboxie.js";
import type { EvidenceRef, ResearchClaim, ResearchMission, ResearchWorkGraph } from "./contracts.js";
import { validateResearchMission } from "./contracts.js";
import { ContentAddressedEvidenceStore } from "./evidence-store.js";
import { ResearchEventLedger, stableJson } from "./event-ledger.js";
import { captureResearchEnvironment } from "./environment-capture.js";
import type { ComputeReplayAttestation } from "./runtime-attestation.js";
import { validateWorkGraphForMission, createWorkGraph, createWorkNode } from "./work-graph.js";
import { persistResearchDeliverables } from "./deliverable-store.js";
import { runResearchOrchestrator, type ResearchRunResult } from "./orchestrator.js";
import { ResearchNodeExecutor, type ResearchNodeSubmission } from "./research-node-executor.js";
import { ScientificToolRegistry } from "./tool-registry.js";
import { createContextRecallTool, ResearchContextMemory } from "./context-memory.js";
import { createWebFetchTool } from "./network-tools.js";
import { attestComputeReplay, createSandboxiePythonResearchTool, SandboxieNetworkFetchPort, SandboxiePythonComputePort, sandboxieCleanupComplete, validateComputeReceipt, validateSandboxieComputeReceipt, type SandboxieComputeRunReceipt } from "./sandboxie-compute.js";
import { DirectHostComputePort } from "./direct-compute.js";
import { SEED_STRATEGY_BUNDLE, strategyBundleFingerprint, validateStrategyBundle, type StrategyBundle } from "./strategy-bundle.js";
import type { ResearchEnvironment } from "./environment-capture.js";

export interface LunaResearchMissionFiles {
	missionPath: string;
	planPath?: string;
}

export interface LunaResearchRunOptions {
	cfg: Config;
	mission: ResearchMission;
	graph: ResearchWorkGraph;
	runDir: string;
	/** WorkGraph resume: continue a prior run directory from its persisted plan + executor state. */
	resumeDir?: string;
	strategy?: StrategyBundle;
	/** Live entry executes and records its own deterministic preflight. */
	stopRequested?: () => boolean;
	now?: () => Date;
	log?: (message: string) => void;
}

function jsonFile(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function loadResearchMission(path: string): ResearchMission {
	const mission = jsonFile(resolve(path)) as ResearchMission;
	const issues = validateResearchMission(mission);
	if (issues.length > 0) throw new Error(`invalid research mission: ${issues.join("; ")}`);
	return mission;
}

export function loadResearchGraph(path: string, mission: ResearchMission): ResearchWorkGraph {
	const graph = jsonFile(resolve(path)) as ResearchWorkGraph;
	const issues = validateLiveGraph(mission, graph);
	if (issues.length > 0) throw new Error(`invalid research work graph: ${issues.join("; ")}`);
	if (graph.missionId !== mission.id) throw new Error(`research graph missionId ${graph.missionId} does not match mission ${mission.id}`);
	return graph;
}

export function createLinearResearchGraph(mission: ResearchMission, now = new Date()): ResearchWorkGraph {
	const criterion = mission.successCriteria.find((item) => item.required)?.id ?? mission.successCriteria[0]?.id ?? "research-evidence";
	// Tool-loop nodes legitimately make many model calls within one node: the
	// per-node budget must bound the AGGREGATE loop, not force a single call.
	const budget = { wallMs: 40 * 60 * 1000, maxModelCalls: 56, maxToolCalls: 48, maxOutputTokens: 131_072, maxAttempts: 2 };
	const nodes = mission.taskProfile.requiredStages.map((kind, index) => createWorkNode({
		id: `${String(index + 1).padStart(2, "0")}-${kind}`,
		kind,
		title: kind.replace(/-/g, " "),
		dependsOn: index === 0 ? [] : [`${String(index).padStart(2, "0")}-${mission.taskProfile.requiredStages[index - 1]}`],
		inputEvidenceIds: [],
		expectedOutputs: [`${kind}-output`],
		acceptanceCriteriaIds: [criterion],
		allowedCapabilities: mission.taskProfile.capabilities,
		budget,
	}));
	return createWorkGraph(mission.id, nodes, now);
}

export function validateCompetitionMissionShape(mission: ResearchMission): string[] {
	const expected = [
		["report", "report.md", "report"],
		["presentation", "presentation.md", "presentation"],
		["defense", "defense.json", "defense"],
	] as const;
	const required = mission.requiredDeliverables.filter((item) => item.required);
	const issues: string[] = [];
	if (required.length !== expected.length) issues.push("competition missions must declare exactly report, presentation, and defense deliverables");
	for (const [id, path, kind] of expected) {
		const match = required.find((item) => item.id === id);
		if (!match || match.path !== path || match.kind !== kind) issues.push(`competition deliverable ${id} must be ${kind} at ${path}`);
	}
	return issues;
}

function validateLiveGraph(mission: ResearchMission, graph: ResearchWorkGraph): string[] {
	const issues = validateWorkGraphForMission(mission, graph);
	for (const node of graph.nodes) if (node.budget.maxModelCalls < 1) issues.push(`live node ${node.id} must reserve at least one Luna model call`);
	return [...new Set(issues)];
}
function safeRunDirectory(runDir: string): string {
	const root = resolve(ROOT, "runs");
	const candidate = resolve(runDir);
	const normalizedRoot = process.platform === "win32" ? root.toLowerCase() : root;
	const normalizedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
	if (normalizedCandidate === normalizedRoot || !normalizedCandidate.startsWith(normalizedRoot + (process.platform === "win32" ? "\\" : "/"))) throw new Error(`research run directory must be inside ${root}`);
	return candidate;
}

function safeOutputPath(runDir: string, path: string): string {
	if (!path || isAbsolute(path) || path.includes("..")) throw new Error(`unsafe research package path: ${path}`);
	const root = resolve(runDir);
	const target = resolve(root, path);
	const rel = relative(root, target);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`unsafe research package path: ${path}`);
	return target;
}

function hashJson(value: unknown): string {
	return createHash("sha256").update(stableJson(value)).digest("hex");
}

function gitValue(args: string[]): string | null {
	try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; }
	catch { return null; }
}

function modelProfileFingerprint(): string {
	const profiles = loadProfiles();
	return createHash("sha256").update(JSON.stringify(profiles.models["gpt-5.6-luna"] ?? null)).digest("hex").slice(0, 24);
}

function assertCompetitionConfig(cfg: Config, mission: ResearchMission): "sandboxie" | "host-audit" {
	if (!cfg.research_model) throw new Error("research-live requires the single research_model configuration block");
	const modelIssues = validateResearchModelConfig(cfg.research_model);
	if (modelIssues.length > 0) throw new Error(`invalid research_model: ${modelIssues.join("; ")}`);
	if (cfg.single_model_id !== cfg.research_model.model || cfg.inner_model !== cfg.research_model.model || cfg.outer_model !== cfg.research_model.model || cfg.inner_thinking_level !== cfg.research_model.thinking_level || cfg.outer_thinking_level !== cfg.research_model.thinking_level) throw new Error("research-live model roles must derive from research_model without overrides");
	if (cfg.execution_backend !== "sandboxie" && cfg.execution_backend !== "host-audit") throw new Error("research-live requires execution_backend sandboxie or host-audit");
	if (cfg.network_mode !== mission.taskProfile.networkMode) throw new Error(`research-live network mode mismatch: config=${cfg.network_mode ?? "blocked"} mission=${mission.taskProfile.networkMode}`);
	return cfg.execution_backend;
}

export interface ResearchDeterministicPreflight {
	version: 1;
	command: "npm run check";
	passed: true;
	outputHash: string;
}

/** Run all deterministic gates before a live campaign. No LLM is invoked here. */
export function runResearchDeterministicPreflight(): ResearchDeterministicPreflight {
	const npm = process.platform === "win32" ? "npm.cmd" : "npm";
	// Node >= 20.12 / 22 requires shell for .cmd targets (CVE-2024-27980);
	// args are fixed literals. (DEP0190 warning about args+shell is noise.)
	const output = execFileSync(npm, ["run", "check"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
	process.stdout.write(output);
	return { version: 1, command: "npm run check", passed: true, outputHash: createHash("sha256").update(output).digest("hex") };
}

export async function runLunaResearchMission(options: LunaResearchRunOptions): Promise<ResearchRunResult> {
	const now = options.now ?? (() => new Date());
	const log = options.log ?? (() => {});
	// WorkGraph resume: continue an existing run directory instead of requiring a fresh one.
	const runDir = safeRunDirectory(options.resumeDir ?? options.runDir);
	if (!options.resumeDir && existsSync(runDir) && readdirSync(runDir).length > 0) throw new Error(`research run directory is not empty: ${runDir}`);
	if (options.resumeDir && !existsSync(join(runDir, "plan.json"))) throw new Error(`resume requires a persisted plan.json in: ${runDir}`);
	const strategy = options.strategy ?? SEED_STRATEGY_BUNDLE;
	const strategyIssues = validateStrategyBundle(strategy);
	if (strategyIssues.length > 0) throw new Error(`invalid research strategy: ${strategyIssues.join("; ")}`);
	const missionIssues = validateResearchMission(options.mission);
	if (missionIssues.length > 0) throw new Error(`invalid research mission: ${missionIssues.join("; ")}`);
	const missionShapeIssues = validateCompetitionMissionShape(options.mission);
	if (missionShapeIssues.length > 0) throw new Error(`invalid competition mission shape: ${missionShapeIssues.join("; ")}`);
	const graphIssues = validateLiveGraph(options.mission, options.graph);
	if (graphIssues.length > 0) throw new Error(`invalid research graph: ${graphIssues.join("; ")}`);
	if (options.graph.missionId !== options.mission.id) throw new Error("research mission and graph IDs do not match");
	assertCompetitionConfig(options.cfg, options.mission);
	// Isolation is opt-in: host-audit is the development default while Sandboxie hardening is
	// deferred; sandboxie restores the boxed path. Host runs are attested host-development and
	// are never competition-eligible.
	const isolation: "sandboxie" | "host-audit" = options.cfg.execution_backend === "sandboxie" ? "sandboxie" : "host-audit";

	// The deterministic preflight runs before provider composition so a broken
	// build can never consume a live-model request. Provider key/catalog preflight
	// follows and fails closed before any node effect.
	const preflight = runResearchDeterministicPreflight();
	const runtime = await getPiRuntime(options.cfg, ROOT);
	const model = runtime.inner as { id?: string; provider?: string; api?: string };
	const researchPolicy = options.cfg.research_model;
	if (!researchPolicy || model.id !== researchPolicy.model || model.provider !== researchPolicy.provider || model.api !== researchPolicy.api || !runtime.researchProbe) throw new Error("resolved Pi runtime does not match research_model or lacks a verified capability probe");
	const pythonCmd = assertSandboxPythonCommand(options.cfg.python_cmd, [resolve(ROOT), resolve(ROOT, options.cfg.private_truth_dir)]);
	const repoRoot = resolve(ROOT);
	const privateRoot = resolve(ROOT, options.cfg.private_truth_dir);
	const networkMode = options.mission.taskProfile.networkMode;
	const exchangeRoot = resolveExchangeWorkspace(join(runDir, "exchange", randomUUID()), options.cfg.sandboxie_exchange_root);
	assertExchangeWorkspace(exchangeRoot, repoRoot, privateRoot);
	mkdirSync(runDir, { recursive: true });
	const evidenceRoot = join(resolve(process.env.TEMP ?? process.env.TMP ?? "/tmp"), "GeoRSI", "evidence", basename(runDir));
	const evidenceStore = new ContentAddressedEvidenceStore(evidenceRoot);
	const evidenceById = new Map<string, EvidenceRef>();
	const ledgerPath = join(runDir, "events.jsonl");
	const ledger = new ResearchEventLedger(ledgerPath, now, [repoRoot, privateRoot]);
	const toolReceipts: string[] = [];
	const modelReceipts: string[] = [];
	const computeReceipts: SandboxieComputeRunReceipt[] = [];
	const guardViolations: string[] = [];
	let exchangeCleaned = false;
	try {
	const registry = new ScientificToolRegistry(now, randomUUID, (receipt) => {
		toolReceipts.push(receipt.id);
		ledger.append({ missionId: options.mission.id, episodeId: options.mission.id, nodeId: receipt.nodeId, actor: "tool", type: "scientific-tool-receipt", status: receipt.status === "success" ? "success" : "failure", inputHash: receipt.inputHash, outputHash: receipt.outputHash, artifactIds: receipt.artifactIds, payload: { toolId: receipt.toolId, wallMs: receipt.wallMs, exitCode: receipt.exitCode, error: receipt.error } });
	});
	const contextMemory = new ResearchContextMemory({ evidenceStore, evidenceById: (id) => evidenceById.get(id) });
	const computePort = isolation === "sandboxie"
		? new SandboxiePythonComputePort({ adapter: SandboxieAdapter.fromConfig(options.cfg, log), pythonCmd, workspace: exchangeRoot, repoRoot, privateRoot, networkMode, log })
		: new DirectHostComputePort({ pythonCmd, workspace: exchangeRoot, repoRoot, privateRoot, log });
	const networkPort = new SandboxieNetworkFetchPort(computePort, options.mission.id, networkMode, (receipt) => computeReceipts.push(receipt));
	registry.register(createWebFetchTool(networkPort, evidenceStore, now));
	registry.register(createContextRecallTool({ memory: contextMemory }));
	const computeToolId = isolation === "sandboxie" ? "sandboxie-python" : "python-host";
	registry.register(createSandboxiePythonResearchTool({ port: computePort, evidenceStore, networkMode, capability: "python", toolId: computeToolId, onRunReceipt: (receipt) => computeReceipts.push(receipt) }));
	const executor = new ResearchNodeExecutor({
		mission: options.mission,
		strategy,
		modelPolicy: researchPolicy,
		contextMemory,
		model: runtime.inner,
		cwdForNode: (nodeId, attempt) => {
			const nodeToken = createHash("sha256").update(nodeId).digest("hex").slice(0, 16);
			const workspace = join(exchangeRoot, "nodes", `${nodeToken}-${attempt}`);
			assertExchangeWorkspace(workspace, repoRoot, privateRoot);
			return workspace;
		},
		evidenceStore,
		evidenceById: (id) => evidenceById.get(id),
		registerEvidence: (reference) => evidenceById.set(reference.id, reference),
		toolRegistry: registry,
		toolBindings: [
			{ toolId: "context-recall", description: "Inspect and recall committed run context memory. Call {list:true} first to see which nodes have committed memory and what artifacts/decisions/verifications exist; then filter by node/field, search by query, or fetch a listed evidenceId for verified content.", parameters: Type.Object({ list: Type.Optional(Type.Union([Type.Literal(true), Type.Literal("nodes"), Type.Literal("artifacts")])), node: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })), field: Type.Optional(Type.Union([Type.Literal("summary"), Type.Literal("decisions"), Type.Literal("artifacts"), Type.Literal("verifications"), Type.Literal("all")])), query: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })), evidenceId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })), topK: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })), maxChars: Type.Optional(Type.Integer({ minimum: 200, maximum: 20_000 })) }) },
			{ toolId: "web-fetch", description: isolation === "sandboxie" ? "Fetch one bounded HTTP(S) scholarly/data source inside the configured Sandboxie network policy." : "Fetch one bounded HTTP(S) scholarly/data source on the host; no sandbox network isolation is enforced in this development run.", parameters: Type.Object({ url: Type.String({ minLength: 1, maxLength: 2000 }), method: Type.Optional(Type.Union([Type.Literal("GET"), Type.Literal("HEAD")])), timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 120_000 })), maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 5_000_000 })) }) },
			{ toolId: computeToolId, description: isolation === "sandboxie" ? "Run a bounded Python/GIS computation in a newly prepared Sandboxie box with verified PID ownership and cleanup. Pass resultFile to persist a structured JSON result; its artifact id is returned as resultArtifactId and is what verifications[].input_artifact must reference." : "Run a bounded Python/GIS computation directly on the host. Sandbox isolation is disabled for this development run; the run is recorded as host-audit and is not competition-eligible. Pass resultFile to persist a structured JSON result; its artifact id is returned as resultArtifactId and is what verifications[].input_artifact must reference.", parameters: Type.Object({ purpose: Type.String({ minLength: 1, maxLength: 500 }), script: Type.String({ minLength: 1, maxLength: 250_000 }), timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 900_000 })), resultFile: Type.Optional(Type.String({ minLength: 1, maxLength: 80, description: "Filename (safe basename, no slashes) your script writes in its working directory, e.g. result.json; becomes the resultArtifactId" })) }) },
		],
		onModelReceipt: (receipt) => {
			modelReceipts.push(receipt.id);
			// Key names must avoid the ledger's credential-shape redactor (anything
			// containing "token" gets redacted); use input/output/total.
			ledger.append({ missionId: options.mission.id, episodeId: options.mission.id, actor: "researcher", type: "model-call-receipt", status: receipt.success ? "success" : "failure", payload: { id: receipt.id, provider: receipt.provider, model: receipt.model, api: receipt.api, requestedThinking: receipt.requestedThinking, effectiveThinking: receipt.effectiveThinking, input: receipt.inputTokens, output: receipt.outputTokens, total: receipt.totalTokens, success: receipt.success } });
		},
		now,
	});
	// WorkGraph resume: restore persisted executor state (submissions, family verifications,
	// successful model receipts, tool receipts) and the evidence-by-id map from the checkpoint.
	if (options.resumeDir) {
		const statePath = join(runDir, "executor_state.json");
		if (existsSync(statePath)) {
			const state = JSON.parse(readFileSync(statePath, "utf8")) as { version: number; missionId: string; executor: import("./research-node-executor.js").ResearchExecutorSnapshot; evidence: EvidenceRef[] };
			if (state.version !== 1 || state.missionId !== options.mission.id) throw new Error(`resume executor state mismatch in ${statePath}`);
			executor.importNodeState(state.executor);
			for (const reference of state.evidence ?? []) evidenceById.set(reference.id, reference);
		} else {
			// Pre-checkpoint run: rebuild the evidence index by scanning the CAS store so dependency
			// artifacts resolve; receipts/submissions for completed nodes stay absent (attestation notes it).
			for (const reference of evidenceStore.listContents()) evidenceById.set(reference.id, reference);
			log("[research] resume: no executor_state.json (pre-checkpoint run); evidence index rebuilt from the CAS store; completed-node receipts absent from the attestation");
		}
		log(`[research] resumed ${runDir}: ${options.graph.nodes.filter((node) => node.state === "completed").length}/${options.graph.nodes.length} nodes already completed`);
	}
	const startedAt = now().getTime();
	const environment: ResearchEnvironment = captureResearchEnvironment({
		gitCommit: gitValue(["rev-parse", "HEAD"]),
		gitDirty: gitValue(["status", "--porcelain"]) !== null,
		configFingerprint: hashJson(options.cfg),
		strategyFingerprint: strategyBundleFingerprint(strategy),
		modelProfileVersion: loadProfiles().version,
		modelProfileFingerprint: modelProfileFingerprint(),
		pythonPath: pythonCmd,
		networkMode,
		evaluatorMetrics: { research: "three-layer-v1", runtime: "research-node-executor-v1", deterministicPreflight: preflight.outputHash, researchModelPolicy: researchModelConfigFingerprint(researchPolicy), researchCapabilityProbe: runtime.researchProbe.fingerprint },
		randomSeeds: [],
	}, now());
	const persistJson = (path: string, value: unknown): void => atomicWriteJson(safeOutputPath(runDir, path), value);
	const persistText = (path: string, value: string): void => writeTextAtomic(safeOutputPath(runDir, path), value);
	return await runResearchOrchestrator({
			mission: options.mission,
			graph: options.graph,
			environment,
			ledger,
			evidenceStore,
			ledgerPath,
			ports: {
				executeNode: executor.executeNode.bind(executor),
				verifyNode: executor.verifyNode.bind(executor),
				checkpointGraph: (graph) => {
					persistJson("plan.json", graph);
					// Durable executor snapshot for WorkGraph resume: submissions, family verifications,
					// successful model receipts, tool receipts, and the evidence-by-id map.
					persistJson("executor_state.json", { version: 1, missionId: options.mission.id, executor: executor.exportNodeState(), evidence: [...evidenceById.values()].sort((left, right) => left.id.localeCompare(right.id)) });
				},
				currentEvidence: () => [...evidenceById.values()].sort((left, right) => left.id.localeCompare(right.id)),
				synthesize: async (graph, evidence) => {
					const synthesisNode = graph.nodes.find((node) => node.kind === "synthesis");
					if (!synthesisNode) throw new Error("research graph has no synthesis node");
					const submission = executor.researchSubmission(synthesisNode.id) as ResearchNodeSubmission | undefined;
					if (!submission?.claims?.length || !submission.valueCard || !submission.narrative) throw new Error("Luna synthesis output must contain claims, value card, and grounded narrative");
					return { hypotheses: submission.hypotheses ?? [], claims: submission.claims as ResearchClaim[], valueCard: submission.valueCard, narrative: submission.narrative };
				},
				runtimeAttestation: () => {
					const submissions = options.graph.nodes.map((node) => executor.researchSubmission(node.id)).filter((submission): submission is ResearchNodeSubmission => !!submission);
					const contraryEvidenceLinks = submissions.flatMap((submission) => submission.contraryEvidenceLinks ?? []).filter((link, index, links) => links.findIndex((candidate) => candidate.sourceEvidenceId === link.sourceEvidenceId && candidate.claimId === link.claimId) === index);
					const receiptsValid = computeReceipts.length > 0 && computeReceipts.every((receipt) => validateComputeReceipt(receipt, networkMode).length === 0 && (isolation === "host-audit" || sandboxieCleanupComplete(receipt.cleanup)));
					const cleanupPassed = exchangeCleaned && receiptsValid;
					const modelReceiptsList = executor.modelReceipts();
					return { version: 1, runMode: isolation === "sandboxie" ? "competition" as const : "host-development" as const, modelPolicy: researchPolicy, modelPolicyFingerprint: researchModelConfigFingerprint(researchPolicy), unitTestsPassed: preflight.passed, guardViolations: [...new Set(guardViolations)], cleanupPassed, isolationBackend: isolation === "sandboxie" ? "sandboxie-app-level" as const : "host-audit" as const, modelCalls: modelReceiptsList, familyVerifications: executor.familyVerifications(), contraryEvidenceLinks, totalTokens: modelReceiptsList.reduce((sum, receipt) => sum + receipt.totalTokens, 0), wallSeconds: Math.max(0, (now().getTime() - startedAt) / 1000) };
				},
			outcomeAttestation: async (graph) => {
					const required = options.mission.taskProfile.family === "capstone" ? ["quantitative-v1", "gis-v1", "literature-v1"] : [options.mission.taskProfile.verifierProfile];
					const family = Object.fromEntries(required.map((profile) => [profile.replace(/-v1$/, ""), executor.familyVerifications().find((item) => item.profile === profile)?.result.score ?? null]));
					const supported = executor.researchSubmission(graph.nodes.find((node) => node.kind === "synthesis")?.id ?? "")?.claims?.some((claim) => claim.status === "supported") ?? false;
					return { taskOutcome: supported && required.every((profile) => executor.familyVerifications().some((item) => item.profile === profile && item.result.passed)) ? 1 : 0, perFamily: family };
				},
				persistJson,
				persistText,
				persistDeliverables: (bundle) => persistResearchDeliverables(runDir, bundle),
				readDeliverable: (path) => readFileSync(safeOutputPath(runDir, path)),
					computeReplay: async () => {
						let replay: ComputeReplayAttestation = isolation === "sandboxie" ? { passed: false, backend: "sandboxie-app-level", processOwnershipVerified: false } : { passed: false, backend: "host-audit", processOwnershipVerified: false };
						try {
							replay = await attestComputeReplay(computePort, computeReceipts, networkMode);
						} catch (error) {
							guardViolations.push(`compute-replay:${error instanceof Error ? error.message : String(error)}`);
						}
						try {
							const receiptText = stableJson({ modelCalls: executor.modelReceipts(), toolReceipts: executor.toolReceipts(), computeReceipts });
							for (const breach of scanTextForBreaches(receiptText, "research-receipts")) guardViolations.push(`${breach.file}:${breach.pattern}`);
							const sweep = scanWorkspaceForBreachesStrict(exchangeRoot);
							for (const breach of sweep.breaches) guardViolations.push(`${breach.file}:${breach.pattern}`);
							for (const scanError of sweep.errors) guardViolations.push(`guard-scan:${scanError}`);
						} catch (error) {
							guardViolations.push(`guard-scan:${error instanceof Error ? error.message : String(error)}`);
						}
						try {
							rmSync(exchangeRoot, { recursive: true, force: true });
							exchangeCleaned = !existsSync(exchangeRoot);
						} catch (error) {
							exchangeCleaned = false;
							guardViolations.push(`exchange-cleanup:${error instanceof Error ? error.message : String(error)}`);
							log(`[research] exchange workspace cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
						}
						return exchangeCleaned ? replay : (isolation === "sandboxie" ? { passed: false, backend: "sandboxie-app-level", processOwnershipVerified: false } : { passed: false, backend: "host-audit", processOwnershipVerified: false });
					},
				now,
				stopRequested: options.stopRequested,
			},
		});
	} finally {
		try { rmSync(exchangeRoot, { recursive: true, force: true }); exchangeCleaned = !existsSync(exchangeRoot); }
		catch (error) { exchangeCleaned = false; log(`[research] final exchange workspace cleanup failed: ${error instanceof Error ? error.message : String(error)}`); }
		ledger.close();
		log(`[research] model receipts=${modelReceipts.length} tool receipts=${toolReceipts.length} compute receipts=${computeReceipts.length}`);
	}
}

export async function runLunaResearchMissionFromFiles(input: LunaResearchMissionFiles & Omit<LunaResearchRunOptions, "mission" | "graph">): Promise<ResearchRunResult> {
	const mission = loadResearchMission(input.missionPath);
	// Resume: the persisted plan.json carries node states (completed/failed/attempts); a fresh
	// linear graph would throw away that progress.
	const graph = input.resumeDir
		? loadResearchGraph(join(input.resumeDir, "plan.json"), mission)
		: input.planPath ? loadResearchGraph(input.planPath, mission) : createLinearResearchGraph(mission, input.now?.() ?? new Date());
	if (input.resumeDir) {
		for (const node of graph.nodes) {
			if (node.state === "failed" || node.state === "running") {
				node.state = "ready";
				node.attempts = 0; // each resumed session grants a fresh attempt budget for the interrupted node
			}
		}
	}
	return runLunaResearchMission({ ...input, mission, graph });
}
