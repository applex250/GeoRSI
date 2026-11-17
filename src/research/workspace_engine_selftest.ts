/**
 * Workspace engine selftest: the interactive tier running on the REAL research executor,
 * family verifiers and orchestrator, driven by a fake pi session that behaves like a
 * well-formed model (structured classification, real python-host computes with audit JSON,
 * typed submissions per node kind, a critical review). No network, no paid model.
 *
 * Covers: classification → tiered mission, a two-round run (review rejects round 1 with a
 * concrete task, accepts round 2), mid-run directions reaching the next node prompt, uploads
 * bound as INPUT_FILES, the sealed package (score/claims/attestation/replay), evidence-linked
 * report, then stop-within-a-node + resume completing the graph without re-planning.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { ROOT, loadConfig } from "../config.js";
import { UPLOAD_ROOT, uploadPath, type ResearchUpload } from "../api/uploads.js";
import type { HarnessOpts, PromptOutcome } from "../piharness.js";
import { readResearchLedger } from "./event-ledger.js";
import { foldNodeActivity } from "./node-activity.js";
import { DirectHostComputePort } from "./direct-compute.js";
import { assertSandboxPythonCommand } from "../sandboxie.js";
import { budgetWarningSuffix, isTransientToolFailure, openEndedToolRefusal, type ResearchHarness } from "./research-node-executor.js";
import type { NetworkFetchPort } from "./network-tools.js";
import { runWorkspaceEngine } from "./workspace-engine.js";
import type { WorkspaceState } from "./workspace-agent.js";
import type { ResearchWorkGraph } from "./contracts.js";
import type { ModelCallReceipt } from "./runtime-attestation.js";
import { DEV_NODE_BUDGET } from "./graph-spec.js";
import { carryNodeBudgetAcrossAttempts, foldNodeUsage, modulateNodeBudget, planNodeBudget, runBudgetBrief } from "./run-budget.js";
import { buildBudgetReport } from "./budget-report.js";

/** Discovery cap as the executor computes it: budget minus the closing reserve. */
const DISCOVERY_CAP = planNodeBudget("literature-search").maxToolCalls - 4;
import { ExperienceStore } from "./experience/store.js";
import type { HarvestSummary } from "./experience/harvest.js";

// Fixture runs must never enter the real experience lanes.
process.env.GEORSI_EXPERIENCE_ROOT = mkdtempSync(join(tmpdir(), "georsi-xp-selftest-"));

const cfgPath = join(ROOT, "config", "research-competition-luna.json");
const policy = loadConfig(cfgPath).research_model!;
const model = { id: policy.model, name: policy.model, provider: policy.provider, api: policy.api, baseUrl: "https://invalid.test/v1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 600_000, maxTokens: 16_384, thinkingLevelMap: { high: "high", xhigh: "xhigh" } } as unknown as Model<any>;
let receiptSeq = 0;
function receipt(): ModelCallReceipt {
	receiptSeq += 1;
	return { id: `fake-receipt-${receiptSeq}`, provider: policy.provider, model: policy.model, api: policy.api, requestedThinking: policy.thinking_level, effectiveThinking: policy.thinking_level, inputTokens: 200, outputTokens: 100, reasoningTokens: 50, cachedTokens: 100, totalTokens: 300, success: true, stopReason: "stop" } as ModelCallReceipt;
}
function outcome(): PromptOutcome {
	const call = receipt();
	return { aborted: false, timedOut: false, stalled: false, error: null, tokens: call.totalTokens, secs: 0.01, modelCall: call, modelCalls: [call] };
}
type ToolLike = { name: string; execute: (...args: any[]) => Promise<any> };
function tool(opts: HarnessOpts, name: string): ToolLike {
	const found = opts.customTools.find((candidate) => candidate.name === name);
	if (!found) throw new Error(`fake harness: missing tool ${name} (have ${opts.customTools.map((item) => item.name).join(",")})`);
	return found as unknown as ToolLike;
}
const text = (result: any): string => result.content?.find((item: any) => item.type === "text")?.text ?? "";

// Upload fixture exactly as the API would store it.
mkdirSync(UPLOAD_ROOT, { recursive: true });
const csv = "year,rainfall\n2020,2\n2021,4\n2022,6\n2023,4\n";
const upload: ResearchUpload = { id: "upload_" + randomUUID().replaceAll("-", ""), name: "rainfall.csv", bytes: Buffer.byteLength(csv), sha256: createHash("sha256").update(csv).digest("hex"), createdAt: new Date().toISOString() };
writeFileSync(uploadPath(upload), csv);
writeFileSync(join(UPLOAD_ROOT, upload.id + ".json"), JSON.stringify(upload));

const AUDIT_SCRIPT = `import json, statistics
rows = [line.split(",") for line in open(INPUT_FILES["rainfall.csv"], encoding="utf-8").read().strip().splitlines()[1:]]
values = [float(r[1]) for r in rows]
mean = statistics.mean(values)
alt = sum(values) / len(values)
result = {"rowCount": len(values), "missingCount": 0, "duplicateCount": 0, "columnsAudited": ["year", "rainfall"], "units": {"rainfall": "mm"}, "estimand": "mean annual rainfall", "method": "arithmetic mean", "stochasticMethod": False, "finiteOutputs": True, "randomSeed": 0, "uncertainty": {"method": "bootstrap-free range", "lower": min(values), "upper": max(values)}, "sensitivityRuns": 2, "independentCheck": {"method": "sum/n", "relativeDifference": abs(mean - alt) / mean, "tolerance": 1e-9}, "mean": mean}
json.dump(result, open("result.json", "w"))
print("MEAN", mean)
`;

interface Observed { nodePrompts: Map<string, string>; reviews: number; classifications: number }
function fakeHarnessFactory(observed: Observed, options: { rejectFirstReview: boolean; stopDuring?: string; stopBeforeCompute?: boolean; runDir: string; family?: "quantitative" | "literature-hypothesis"; searchStorm?: boolean }): (opts: HarnessOpts) => ResearchHarness {
	return (opts) => ({
		init: async () => {},
		abort: () => {},
		dispose: () => {},
		prompt: async (promptText: string) => {
			if (opts.systemPrompt.includes("research planner")) {
				observed.classifications += 1;
				if (options.family === "literature-hypothesis") {
					await tool(opts, "submit_classification").execute("c1", { family: "literature-hypothesis", tier: "simple", estimands: [], units: [], success_criteria: ["a review grounded in verifiable scholarly sources"], keywords: ["青藏高原", "湖泊扩张", "遥感"], rationale: "a synthesis question over published literature" }, undefined, undefined, undefined);
					return outcome();
				}
				await tool(opts, "submit_classification").execute("c1", { family: "quantitative", tier: "simple", estimands: ["mean annual rainfall"], units: ["mm"], success_criteria: ["the mean is computed from the uploaded table with an audit"], keywords: ["rainfall"], rationale: "numeric estimation on uploaded data" }, undefined, undefined, undefined);
				return outcome();
			}
			if (opts.systemPrompt.includes("research reviewer")) {
				observed.reviews += 1;
				const first = /ROUND 1 of/.test(promptText);
				await tool(opts, "submit_review").execute("r1", first && options.rejectFirstReview ? { complete: false, summary: "第一轮缺少对年际变化的敏感性讨论。", next: "补充年际变化的敏感性分析并更新报告。" } : { complete: true, summary: "问题已基于上传数据与审计证据回答，局限已说明。", next: "" }, undefined, undefined, undefined);
				return outcome();
			}
			const nodeId = /Execute node (\S+)\./.exec(promptText)?.[1];
			if (!nodeId) throw new Error(`fake harness received a non-node prompt (submission was rejected earlier?): ${promptText.slice(0, 300)}`);
			observed.nodePrompts.set(nodeId, promptText);
			const kind = nodeId.replace(/^r\d+-\d+-/, "");
			// Emit the telemetry a real pi session streams: thinking deltas + tool lifecycle.
			opts.onAgentDelta?.("thinking", `正在思考 ${nodeId} 的${kind}任务…`);
			opts.onAgentDelta?.("text", `节点 ${nodeId} 的输出叙述。`);
			opts.onToolEvent?.({ phase: "start", tool: "python-host", detail: `purpose=${kind} audit` });
			opts.onToolEvent?.({ phase: "end", tool: "python-host", detail: "exit=0" });
			if (options.stopBeforeCompute && options.stopDuring === nodeId) {
				writeFileSync(join(options.runDir, "control.json"), JSON.stringify({ action: "stop" }));
				await new Promise((resolve) => setTimeout(resolve, 1_600));
			}
			if (options.searchStorm && kind === "literature-search") {
				// #16/#17/#20 regression: an open-ended search storm must hit the discovery
				// cap, be told to wrap up, and still submit a valid literature-v1 catalogue.
				const searchTool = opts.customTools.find((candidate) => candidate.name === "research_search-literature");
				assert.ok(searchTool, `literature-search node exposes the search tool (have ${opts.customTools.map((item) => item.name).join(",")})`);
				const collected = new Map<string, any>();
				const evidenceIds: string[] = [];
				const stormStatuses: Array<{ budgetStatus: unknown }> = [];
				let refusals = 0;
				let executed = 0;
				let warnings = 0;
				for (let i = 0; i < 60; i += 1) {
					const result = await (searchTool as unknown as ToolLike).execute(`lit-${i}`, { query: `Tibetan Plateau lake expansion remote sensing ${i}`, rows: 3 }, undefined, undefined, undefined);
					const body = text(result);
					if (body.includes("TOOL BUDGET RESERVED")) { refusals += 1; continue; }
					executed += 1;
					if (body.includes("BUDGET WARNING")) warnings += 1;
					const parsed = JSON.parse(body) as { output: { evidenceId: string; sources: any[] }; budgetStatus?: unknown };
					stormStatuses.push({ budgetStatus: parsed.budgetStatus });
					evidenceIds.push(parsed.output.evidenceId);
					for (const source of parsed.output.sources) collected.set(source.id, { ...source, supportsClaimIds: ["claim-lit-1"] });
				}
				assert.ok(refusals >= 1, `the discovery cap refused further searches (${refusals} refusals)`);
				const statuses = stormStatuses.map((entry) => entry.budgetStatus as { node: { toolCallsUsed: number; toolCallsRemaining: number }; run: { nodesRemaining: number } | null });
				assert.ok(statuses.length >= 1 && statuses.every((status) => typeof status.node.toolCallsUsed === "number" && status.node.toolCallsRemaining >= 0), "every executed search carried a live budgetStatus");
				assert.ok(statuses.some((status) => status.run && status.run.nodesRemaining >= 1), "the budgetStatus ledger exposes the run-wide picture");
				assert.ok(executed <= DISCOVERY_CAP, `executed searches respect the discovery cap (${executed})`);
				assert.ok(warnings >= 1, `the low-budget warning was injected into tool outputs (${warnings})`);
				// Written the way the real model writes it: sha256:-prefixed ids as contentHash. The
				// verifier-input normalizer must fold that into the canonical bare hash at both gates.
				const sources = [...collected.values()].slice(0, 3).map((source: any) => ({ ...source, contentHash: `sha256:${source.contentHash}` }));
				assert.ok(sources.length >= 2, `enough unique sources registered for literature-v1 (${sources.length})`);
				const catalogue = {
					sources,
					claims: [{ id: "claim-lit-1", text: "青藏高原湖泊显著扩张", status: "supported", evidenceIds: [], uncertainty: "中等", limitations: ["样本文献有限"] }],
					hypotheses: [{ id: "hyp-lit-1", statement: "气候变暖驱动湖泊面积扩张", rationaleEvidenceIds: [], expectedObservation: "湖泊面积与气温正相关", falsifier: "面积与气温无关或负相关", status: "proposed" }],
					searchQueries: ["Tibetan Plateau lake expansion"],
					minimumSources: 2,
					requireContraryEvidence: false,
					noveltyScope: "remote sensing of Tibetan Plateau lakes",
					noveltySearchCutoff: "2026-09",
				};
				// Wrong contentHash values must be bounced by the in-session verifier dry-run (the
				// fresh-run lesson) instead of burning a whole node attempt after the prompt ends.
				const badCatalogue = { ...catalogue, sources: catalogue.sources.map((source: any) => ({ ...source, contentHash: "0".repeat(64) })) };
				const badScript = `import json\njson.dump(json.loads(r'''${JSON.stringify(badCatalogue)}'''), open("bad-cat.json", "w"))\n`;
				const badCompute = await tool(opts, "research_python-host").execute("py-badcat", { purpose: "literature catalogue (wrong hashes)", script: badScript, resultFile: "bad-cat.json" }, undefined, undefined, undefined);
				const badAudit = (JSON.parse(text(badCompute)) as { output: { resultArtifactId?: string } }).output.resultArtifactId!;
				const bounced = text(await tool(opts, "submit_research_node_output").execute("s-bad", { version: 1, summary: "wrong hashes", artifact_ids: [badAudit], decisions: [], verifications: [{ profile: "literature-v1", input_artifact: badAudit, evidence_ids: [badAudit, ...[...new Set(evidenceIds)].slice(0, 3)] }] }, undefined, undefined, undefined));
				assert.match(bounced, /REJECTED by the family verifier dry-run[\s\S]*not bound to canonical source-evidence hashes/, `a catalogue with wrong contentHash is bounced in-session with the binding rule: ${bounced.slice(0, 300)}`);
				// The literature closing is COMPILED, not hand-written: pick sources by id, state claims
				// they support, and the tool assembles + pre-verifies the literature-v1 input.
				const sourceIds = [...collected.values()].slice(0, 2).map((source: any) => source.id as string);
				const compiled = JSON.parse(text(await tool(opts, "compile_literature_catalogue").execute("c", {
					source_ids: sourceIds,
					claims: [{ id: "claim-lit-1", text: "青藏高原湖泊显著扩张", status: "supported", supporting_source_ids: sourceIds, uncertainty: "中等", limitations: ["样本文献有限"] }],
					hypotheses: [{ id: "hyp-lit-1", statement: "气候变暖驱动湖泊面积扩张", expected_observation: "湖泊面积与气温正相关", falsifier: "面积与气温无关或负相关" }],
					novelty_scope: "remote sensing of Tibetan Plateau lakes",
					novelty_search_cutoff: "2026-09",
				}, undefined, undefined, undefined))) as { artifactId: string; evidenceIds: string[]; sourceCount: number; searchQueries: number };
				assert.ok(compiled.artifactId && compiled.evidenceIds.length >= 2 && compiled.sourceCount === sourceIds.length && compiled.searchQueries >= 1, `the compiled catalogue is a tool-produced artifact with its evidence ids: ${JSON.stringify(compiled).slice(0, 200)}`);
				const submitted = await tool(opts, "submit_research_node_output").execute("s", {
					version: 1,
					summary: "文献综述节点在检索风暴后仍按时交卷",
					artifact_ids: [compiled.artifactId],
					decisions: [],
					verifications: [{ profile: "literature-v1", input_artifact: compiled.artifactId, evidence_ids: compiled.evidenceIds }],
				}, undefined, undefined, undefined);
				const verdict = text(submitted);
				if (/reject|invalid|error|must|missing/i.test(verdict) && !/accepted|recorded/i.test(verdict)) throw new Error(`fake harness: ${nodeId} submission rejected: ${verdict.slice(0, 600)}`);
				observed.nodePrompts.set(nodeId, promptText);
				console.log(`  ok   search storm capped: ${executed} searches executed, ${refusals} refused, node submitted anyway`);
				return outcome();
			}
			const compute = await tool(opts, "research_python-host").execute("py", { purpose: `${kind} audit`, script: AUDIT_SCRIPT, resultFile: "result.json", timeoutMs: 60_000 }, undefined, undefined, undefined);
			const parsed = JSON.parse(text(compute)) as { output: { resultArtifactId?: string; evidenceIds: string[]; stdoutTail: string } };
			const audit = parsed.output.resultArtifactId;
			assert.ok(audit, `python-host returned resultArtifactId for ${nodeId}: ${text(compute).slice(0, 200)}`);
			assert.match(parsed.output.stdoutTail, /MEAN 4/, "the uploaded table is bound through INPUT_FILES");
			// The stop lands AFTER this node registered evidence, so the resumed retry has
			// prior-attempt findings to inherit instead of re-deriving them.
			if (options.stopDuring === nodeId) {
				// Stop lands while this node is in flight: the 1 s watcher aborts the controller
				// before the fake session returns, so the executor must fail the node closed.
				writeFileSync(join(options.runDir, "control.json"), JSON.stringify({ action: "stop" }));
				await new Promise((resolve) => setTimeout(resolve, 1_600));
			}
			const staged = await tool(opts, "record_research_artifact").execute("a", kind === "report"
				? { kind: "tool-output", logical_name: "report.md", media_type: "text/markdown", content: ["Scientific Question and Value", "Hypotheses and Falsification", "Data Provenance and Quality", "Methods and Tool Chain", "Uncertainty and Sensitivity", "Reproducibility", "Evidence Index"].map((title, index) => `## ${index + 1}. ${title}\n\n年降雨均值估计（算术平均，独立校核 sum/n，均值 4 mm）。 [evidence:${audit}]\n`).join("\n") }
				: { kind: "table", logical_name: `${kind}-notes.json`, media_type: "application/json", content: JSON.stringify({ kind, audit }) }, undefined, undefined, undefined);
			const handle = text(staged).split(" ").at(-1)!;
			const needsAudit = ["quantitative-analysis", "sensitivity", "verification"].includes(kind);
			const submission: Record<string, unknown> = {
				version: 1,
				summary: `${kind} completed on the uploaded rainfall table`,
				artifact_ids: [handle, audit],
				decisions: [{ question: "estimator", alternatives: ["mean", "median"], selected: "mean", evidence_ids: [audit], uncertainty: "range of observed values" }],
				verifications: needsAudit ? [{ profile: "quantitative-v1", input_artifact: audit, evidence_ids: [audit] }] : [],
			};
			if (kind === "synthesis") {
				const dimension = { score: 2, rationale: "grounded in the audited table", evidence_ids: [audit] };
				submission.claims = [{ id: "claim-mean", text: "年降雨均值为 4 mm", status: "supported", evidence_ids: [audit], uncertainty: "range 2..6", limitations: ["four observations only"] }];
				submission.value_card = { significance: dimension, novelty: { ...dimension, score: 1 }, falsifiability: dimension, dataFeasibility: dimension, methodologicalValue: dimension, potentialImpact: { ...dimension, score: 1 }, limitations: ["tiny fixture"], recommendation: "proceed" };
				const section = { text: "基于上传表格的算术平均。", evidence_ids: [audit] };
				submission.narrative = { dataSummary: section, methodSummary: section, resultSummary: { ...section, claim_ids: ["claim-mean"] }, uncertaintySummary: section, innovationSummary: section, reproducibilitySummary: section };
			}
			const submitted = await tool(opts, "submit_research_node_output").execute("s", submission, undefined, undefined, undefined);
			const verdict = text(submitted);
			if (/reject|invalid|error|must|missing/i.test(verdict) && !/accepted|recorded/i.test(verdict)) throw new Error(`fake harness: ${nodeId} submission rejected: ${verdict.slice(0, 600)}`);
			return outcome();
		},
	});
}

async function fullRun(): Promise<void> {
	const runId = "run_" + randomUUID().replaceAll("-", "").slice(0, 12);
	const runDir = join(ROOT, "runs", runId);
	mkdirSync(runDir, { recursive: true });
	writeFileSync(join(runDir, "request.json"), JSON.stringify({ question: "请估计上传降雨数据的年均值并说明不确定性", uploadIds: [upload.id] }));
	writeFileSync(join(runDir, "directions.jsonl"), JSON.stringify({ id: "direction_1", text: "请以毫米为单位报告结果", createdAt: new Date().toISOString() }) + "\n");
	const observed: Observed = { nodePrompts: new Map(), reviews: 0, classifications: 0 };
	await runWorkspaceEngine(runDir, cfgPath, { createHarness: fakeHarnessFactory(observed, { rejectFirstReview: true, runDir }), runtime: async () => ({ model, probeFingerprint: "fake-probe" }), maxRounds: 3, log: () => {} });
	const state = JSON.parse(readFileSync(join(runDir, "workspace-state.json"), "utf8")) as WorkspaceState;
	assert.equal(state.phase, "completed");
	assert.equal(observed.classifications, 1);
	assert.equal(observed.reviews, 2, "round 1 rejected, round 2 accepted");
	assert.deepEqual(state.iterations.map((item) => item.complete), [false, true]);
	assert.ok(state.appliedDirectionIds.includes("direction_1"));
	assert.ok([...observed.nodePrompts.values()].some((prompt) => prompt.includes("USER DIRECTIONS") && prompt.includes("毫米")), "the direction reached a node prompt");
	assert.ok([...observed.nodePrompts.values()].some((prompt) => prompt.includes("BUDGET DISCIPLINE (live)") && prompt.includes("still to do after this node")), "the live run-budget brief reached node prompts");
	assert.ok([...observed.nodePrompts.values()].some((prompt) => prompt.includes("budget:[") && prompt.includes("calls/")), "the graph block shows each node planned fixed budget");
	assert.ok([...observed.nodePrompts.values()].some((prompt) => prompt.includes("ROUND 2 FOCUS") && prompt.includes("敏感性")), "round 2 nodes carry the review's task as focus");
	const plan = JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8")) as ResearchWorkGraph;
	assert.ok(plan.nodes.every((node) => node.state === "completed"));
	assert.deepEqual(plan.nodes.filter((node) => node.id.startsWith("r1-")).map((node) => node.kind), ["data-audit", "quantitative-analysis", "verification", "synthesis", "report"], "simple quantitative tier with an upload audits the data first");
	assert.ok(plan.nodes.some((node) => node.id.startsWith("r2-") && node.kind === "report"), "round 2 appended its own report node");
	const record = JSON.parse(readFileSync(join(runDir, "mission-synthesized.json"), "utf8")) as { tier: string; mission: { requiredDeliverables: { id: string }[]; dataset?: { type: string } } };
	assert.equal(record.tier, "simple");
	assert.deepEqual(record.mission.requiredDeliverables.map((item) => item.id), ["report"]);
	assert.equal(record.mission.dataset?.type, "file");
	for (const file of ["mission.json", "claims.json", "research-manifest.json", "replay.json", "research-score.json", "package-seal.json", "runtime-attestation.json", "report.md", "report-round-1.md", "report-round-2.md", "evidence-index.json"]) assert.ok(existsSync(join(runDir, file)), `${file} is part of the package`);
	assert.ok(!existsSync(join(runDir, "presentation.md")) && !existsSync(join(runDir, "defense.json")), "report-only tier writes no competition deliverables");
	const score = JSON.parse(readFileSync(join(runDir, "research-score.json"), "utf8")) as { eligible: boolean; overall: number | null; scienceScore: number; components: Record<string, number> };
	assert.equal(score.eligible, false, "host-development is never eligible");
	assert.equal(score.overall, null);
	assert.ok(score.scienceScore > 0.5, `science score reflects real verifier passes: ${score.scienceScore}`);
	assert.equal(score.components.communication, 1, "report-only communication score averages over the required deliverable");
	const attestation = JSON.parse(readFileSync(join(runDir, "runtime-attestation.json"), "utf8")) as { runMode: string; unitTestsPassed: boolean; familyVerifications: { profile: string }[]; modelCalls: unknown[] };
	assert.equal(attestation.runMode, "host-development");
	assert.equal(attestation.unitTestsPassed, false, "no preflight ran, so it is not attested");
	assert.deepEqual(attestation.familyVerifications.map((item) => item.profile), ["quantitative-v1"]);
	const replay = JSON.parse(readFileSync(join(runDir, "replay.json"), "utf8")) as { passed: boolean; computeReplay: { passed: boolean } };
	assert.equal(replay.passed, true, "verify-only replay passes on the sealed package");
	assert.equal(replay.computeReplay.passed, true, "python computes replay byte-identically with INPUT_FILES bound");
	const report = readFileSync(join(runDir, "report.md"), "utf8");
	assert.ok(!/\[evidence:sha256:/.test(report), "citations are linked, not raw ids");
	assert.ok(report.includes(`/api/research/research-runs/${runId}/evidence/`), "citations link to the evidence route");
	assert.ok(report.includes("Evidence Index"), "missing sections were topped up from the template");
	const claims = JSON.parse(readFileSync(join(runDir, "claims.json"), "utf8")) as { id: string }[];
	assert.equal(claims[0]?.id, "claim-mean");
	const ledger = readResearchLedger(join(runDir, "events.jsonl"));
	assert.ok(ledger.valid && ledger.events.some((item) => item.type === "workspace-classified") && ledger.events.some((item) => item.type === "iteration-reviewed") && ledger.events.some((item) => item.type === "research-precommit-attested"));
	assert.ok(state.modelCalls >= plan.nodes.length + 3 && state.totalTokens > 0, "classifier, nodes and reviews are all accounted");
	// Node activity view: session telemetry persisted, receipts carry cache usage, and the fold
	// interleaves thinking/tool stream with ledger receipts for the UI's node inspector.
	const sessionFile = join(runDir, "sessions", "r1-01-data-audit.jsonl");
	assert.ok(existsSync(sessionFile), "per-node session telemetry is persisted");
	const sessionLines = readFileSync(sessionFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { kind: string });
	assert.ok(sessionLines.some((line) => line.kind === "thinking") && sessionLines.some((line) => line.kind === "tool-start") && sessionLines.some((line) => line.kind === "text"), "thinking, tool and text events all landed");
	const audited = plan.nodes.find((node) => node.id === "r1-01-data-audit")!;
	const snapshot = JSON.parse(readFileSync(join(runDir, "executor_state.json"), "utf8")) as { executor: { submissions: { nodeId: string; submission: { summary: string; artifactIds: string[]; decisions: unknown[] } }[] } };
	const activity = foldNodeActivity({
		node: { id: audited.id, kind: audited.kind, title: audited.title, state: audited.state, attempts: audited.attempts },
		events: readResearchLedger(join(runDir, "events.jsonl")).events.filter((event) => event.nodeId === audited.id),
		session: sessionLines.map((line) => line as { t?: string; kind: string; detail?: string }),
		submission: (() => { const entry = snapshot.executor.submissions.find((item) => item.nodeId === audited.id); return entry ? { summary: entry.submission.summary, artifactIds: entry.submission.artifactIds, decisions: entry.submission.decisions.length } : null; })(),
	});
	assert.ok(activity.usage.calls >= 1 && activity.usage.cachedTokens === activity.usage.calls * 100, "per-node model receipts are folded with cache tokens");
	assert.ok(Math.abs((activity.usage.cacheHitRate ?? 0) - 100 / 300) < 1e-9, "cache hit rate = cached/(cached+input)");
	assert.ok(activity.timeline.some((item) => item.kind === "thinking") && activity.timeline.some((item) => item.kind === "tool-receipt") && activity.timeline.some((item) => item.kind === "node-completed"), "timeline interleaves session stream and ledger receipts");
	assert.ok(activity.submission?.summary.startsWith("data-audit"), "the node's submission summary is attached");
	assert.ok(activity.tools.some((tool) => tool.toolId === "python-host" && tool.calls >= 1), "per-tool counts are folded");
	// Experience flywheel (store only): the sealed run left a gated record behind.
	const harvest = JSON.parse(readFileSync(join(runDir, "experience.json"), "utf8")) as HarvestSummary;
	assert.equal(harvest.runRecord, `xp_${runId}_run`);
	assert.ok(harvest.added.includes(harvest.runRecord!), "the run record entered the store");
	const stored = new ExperienceStore().get(harvest.runRecord!)!;
	assert.equal(stored.status, "candidate", "verifier pass + replay verified → candidate");
	assert.equal(stored.gates.replay, "verified");
	assert.equal(stored.gates.human, "pending", "first-of-family and uploaded data wait for a human");
	assert.equal(stored.route.rounds, 2);
	assert.equal(stored.route.nodes.length, plan.nodes.length);
	assert.ok(stored.route.nodes.every((node) => node.toolIds.includes("python-host") && node.modelCalls >= 1), "per-node tools and receipts are joined onto the route");
	assert.equal(stored.origin.runMode, "host-development");
	assert.ok(stored.evidence.manifestHash && stored.evidence.evidenceHashes.length > 0, "durable hashes replace the temp CAS");
	assert.equal(stored.tier, "simple");
	// Budget report (frontend dashboard source): plan-time fixed values vs ledger usage.
	const budgetReport = buildBudgetReport({ plan, events: ledger.events, nowMs: Date.now() });
	assert.equal(budgetReport.nodes.length, plan.nodes.length, "one budget row per planned node");
	assert.equal(budgetReport.planned.toolCalls, plan.nodes.reduce((sum, node) => sum + node.budget.maxToolCalls, 0), "planned totals sum the fixed envelopes");
	assert.ok(budgetReport.nodes.every((entry) => entry.used.toolCalls >= 1 && entry.used.modelCalls >= 1 && entry.planned.toolCalls > 0), "every executed node shows ledger-derived tool and model usage");
	assert.ok(budgetReport.used.modelCalls === state.modelCalls && budgetReport.overhead.modelCalls >= 3, "run model calls reconcile with the engine's own accounting; classifier + reviews land in overhead");
	assert.ok(budgetReport.nodes.every((entry) => entry.used.wallMs >= 0 && entry.ratios.toolCalls !== null && entry.ratios.toolCalls <= 1), "utilisation ratios are bounded by the planned envelopes");
	assert.equal(budgetReport.nodesRemaining, 0, "a sealed run has no remaining planned work");
	assert.ok(budgetReport.pressure.overrun !== null && !budgetReport.pressure.tightening, "a healthy run reports its pressure without tightening");
	assert.ok(budgetReport.nodes.some((entry) => entry.kind === "report" && entry.planned.toolCalls === planNodeBudget("report").maxToolCalls), "the report node carries its plan-time fixed value");
	console.log(`  ok   full two-round run sealed: nodes=${plan.nodes.length} scienceScore=${score.scienceScore.toFixed(3)} modelCalls=${state.modelCalls}`);
}

async function stopAndResume(): Promise<void> {
	const runId = "run_" + randomUUID().replaceAll("-", "").slice(0, 12);
	const runDir = join(ROOT, "runs", runId);
	mkdirSync(runDir, { recursive: true });
	writeFileSync(join(runDir, "request.json"), JSON.stringify({ question: "请估计上传降雨数据的年均值", uploadIds: [upload.id] }));
	const observed: Observed = { nodePrompts: new Map(), reviews: 0, classifications: 0 };
	await assert.rejects(runWorkspaceEngine(runDir, cfgPath, { createHarness: fakeHarnessFactory(observed, { rejectFirstReview: false, stopDuring: "r1-02-quantitative-analysis", runDir }), runtime: async () => ({ model, probeFingerprint: "fake-probe" }), maxRounds: 1, log: () => {} }), /stopped/);
	const stoppedState = JSON.parse(readFileSync(join(runDir, "workspace-state.json"), "utf8")) as WorkspaceState;
	assert.equal(stoppedState.phase, "cancelled");
	const plan = JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8")) as ResearchWorkGraph;
	assert.ok(plan.nodes.filter((node) => node.state === "completed").length >= 1 && plan.nodes.some((node) => node.state !== "completed"), "stop left completed and unfinished nodes");
	const promptsBefore = observed.nodePrompts.size;
	writeFileSync(join(runDir, "control.json"), "");
	const resumed: Observed = { nodePrompts: new Map(), reviews: 0, classifications: 0 };
	await runWorkspaceEngine(runDir, cfgPath, { resume: true, createHarness: fakeHarnessFactory(resumed, { rejectFirstReview: false, runDir }), runtime: async () => ({ model, probeFingerprint: "fake-probe" }), maxRounds: 1, log: () => {} });
	const finalState = JSON.parse(readFileSync(join(runDir, "workspace-state.json"), "utf8")) as WorkspaceState;
	assert.equal(finalState.phase, "completed");
	assert.equal(resumed.classifications, 0, "resume reuses mission-synthesized.json instead of re-classifying");
	assert.ok(!resumed.nodePrompts.has("r1-01-data-audit"), "completed nodes are not re-executed");
	assert.ok((resumed.nodePrompts.get("r1-02-quantitative-analysis") ?? "").includes("PRIOR ATTEMPT EVIDENCE") && /id \| kind \| name \| url[\s\S]*sha256:/.test(resumed.nodePrompts.get("r1-02-quantitative-analysis") ?? ""), "the retry of the interrupted node is handed its earlier attempt's evidence with concrete ids instead of re-deriving it");
	const finalPlan = JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8")) as ResearchWorkGraph;
	assert.ok(finalPlan.nodes.every((node) => node.state === "completed"));
	assert.ok(existsSync(join(runDir, "package-seal.json")) && existsSync(join(runDir, "report.md")));
	assert.ok(finalState.modelCalls > stoppedState.modelCalls && promptsBefore - 1 + resumed.nodePrompts.size === finalPlan.nodes.length, "the interrupted node re-runs once; completed nodes never do; accounting stays continuous");
	const resumedHarvest = JSON.parse(readFileSync(join(runDir, "experience.json"), "utf8")) as HarvestSummary;
	assert.equal(resumedHarvest.counterExamples.length, 0, "a user stop is a cancellation, not a counter-example");
	console.log(`  ok   stop within a node (${promptsBefore} prompts) then resume completed the remaining ${resumed.nodePrompts.size} nodes`);
}

async function zombieResume(): Promise<void> {
	// #36: a child that dies silently leaves phase=executing and its in-flight
	// node frozen at state=running. Resume used to reject exactly that shape
	// ("requires a failed/cancelled workspace-state.json"), pushing the user
	// into a fresh re-run that overwrote the checkpoint — it must instead
	// restore the checkpoint and finish the graph.
	const runId = "run_" + randomUUID().replaceAll("-", "").slice(0, 12);
	const runDir = join(ROOT, "runs", runId);
	mkdirSync(runDir, { recursive: true });
	writeFileSync(join(runDir, "request.json"), JSON.stringify({ question: "请估计上传降雨数据的年均值", uploadIds: [upload.id] }));
	const observed: Observed = { nodePrompts: new Map(), reviews: 0, classifications: 0 };
	await assert.rejects(runWorkspaceEngine(runDir, cfgPath, { createHarness: fakeHarnessFactory(observed, { rejectFirstReview: false, stopDuring: "r1-02-quantitative-analysis", runDir }), runtime: async () => ({ model, probeFingerprint: "fake-probe" }), maxRounds: 1, log: () => {} }), /stopped/);
	// Forge what a silently-dead process leaves behind: the durable phase never
	// reached failed/cancelled, and the interrupted node is frozen mid-flight.
	const statePath = join(runDir, "workspace-state.json");
	const zombieState = JSON.parse(readFileSync(statePath, "utf8")) as WorkspaceState;
	zombieState.phase = "executing";
	writeFileSync(statePath, JSON.stringify(zombieState));
	const planPath = join(runDir, "plan.json");
	const zombiePlan = JSON.parse(readFileSync(planPath, "utf8")) as ResearchWorkGraph;
	let frozen = 0;
	for (const node of zombiePlan.nodes) if (node.state === "failed" || node.state === "running" || node.state === "verifying") { node.state = "running"; frozen += 1; }
	const unfinishedBefore = zombiePlan.nodes.filter((node) => node.state !== "completed").length;
	assert.ok(frozen >= 1, "the forged zombie has an in-flight node");
	writeFileSync(planPath, JSON.stringify(zombiePlan));
	// The API clears the stop flag before a real resume; mirror that here.
	writeFileSync(join(runDir, "control.json"), "");
	const resumed: Observed = { nodePrompts: new Map(), reviews: 0, classifications: 0 };
	await runWorkspaceEngine(runDir, cfgPath, { resume: true, createHarness: fakeHarnessFactory(resumed, { rejectFirstReview: false, runDir }), runtime: async () => ({ model, probeFingerprint: "fake-probe" }), maxRounds: 1, log: () => {} });
	const finalState = JSON.parse(readFileSync(statePath, "utf8")) as WorkspaceState;
	assert.equal(finalState.phase, "completed", "the zombie checkpoint resumed instead of being rejected");
	assert.equal(resumed.classifications, 0, "the zombie checkpoint keeps its mission record");
	assert.ok(!resumed.nodePrompts.has("r1-01-data-audit"), "nodes completed before the death are never re-executed");
	const finalPlan = JSON.parse(readFileSync(planPath, "utf8")) as ResearchWorkGraph;
	assert.ok(finalPlan.nodes.every((node) => node.state === "completed"));
	assert.equal(finalPlan.nodes.length, zombiePlan.nodes.length, "the graph is neither re-planned nor extended");
	assert.equal(resumed.nodePrompts.size, unfinishedBefore, "exactly the nodes unfinished at death re-run");
	assert.ok(finalState.modelCalls > zombieState.modelCalls, "accounting continues across the resume");
	console.log(`  ok   zombie resume (phase=executing, ${frozen} frozen node) restored the checkpoint and completed`);
}

async function searchStorm(): Promise<void> {
	// #16/#17/#20: the r1-02-literature-search wall timeout — the model kept searching
	// with no enforced tool budget and no wrap-up signal until the 20-minute wall killed
	// the node. Here a literature-family run storms the search tool 40 times through a
	// captive offline fetch port: the discovery cap must refuse the excess, the low-budget
	// warning must appear, and the node must still submit a verifier-passing catalogue.
	const runId = "run_" + randomUUID().replaceAll("-", "").slice(0, 12);
	const runDir = join(ROOT, "runs", runId);
	mkdirSync(runDir, { recursive: true });
	writeFileSync(join(runDir, "request.json"), JSON.stringify({ question: "近十年青藏高原湖泊扩张的遥感证据研究进展如何？", uploadIds: [] }));
	const crossrefBody = JSON.stringify({ status: "ok", message: { items: [
		{ title: "Lake expansion on the Tibetan Plateau from Landsat archives", author: [{ given: "A", family: "Chen" }], issued: { "date-parts": [[2021]] }, DOI: "10.1234/tibet.lakes.2021", URL: "https://doi.org/10.1234/tibet.lakes.2021" },
		{ title: "Remote sensing evidence of lake-area growth in High Mountain Asia", author: [{ given: "B", family: "Zhang" }], issued: { "date-parts": [[2022]] }, DOI: "10.1234/hma.lakes.2022", URL: "https://doi.org/10.1234/hma.lakes.2022" },
		{ title: "No author record", issued: { "date-parts": [[2020]] } },
	] } });
	let fetches = 0;
	const captivePort: NetworkFetchPort = {
		fetch: async (request): Promise<import("./network-tools.js").NetworkFetchResponse> => {
			fetches += 1;
			if (!request.url.includes("api.crossref.org")) return { finalUrl: request.url, status: 404, headers: {}, body: Buffer.from("{}", "utf8"), retrievedAt: new Date().toISOString() };
			return { finalUrl: request.url, status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(crossrefBody, "utf8"), retrievedAt: new Date().toISOString() };
		},
	};
	const observed: Observed = { nodePrompts: new Map(), reviews: 0, classifications: 0 };
	await assert.rejects(runWorkspaceEngine(runDir, cfgPath, {
		createHarness: fakeHarnessFactory(observed, { rejectFirstReview: false, stopDuring: "r1-02-verification", stopBeforeCompute: true, runDir, family: "literature-hypothesis", searchStorm: true }),
		runtime: async () => ({ model, probeFingerprint: "fake-probe" }),
		networkFetchPort: captivePort,
		maxRounds: 1,
		log: () => {},
	}), /stopped/);
	assert.equal(fetches, DISCOVERY_CAP, "exactly the discovery-cap share of searches reached the network");
	const plan = JSON.parse(readFileSync(join(runDir, "plan.json"), "utf8")) as ResearchWorkGraph;
	const litNode = plan.nodes.find((node) => node.kind === "literature-search");
	assert.ok(litNode, "the literature graph has a literature-search node");
	assert.equal(litNode!.state, "completed", "the search-storm node submitted within budget instead of timing out");
	console.log("  ok   literature search storm: cap enforced, warning injected, node submitted (run stopped at the next node as planned)");
}

await fullRun();
await stopAndResume();
await zombieResume();
await searchStorm();
console.log("Workspace engine selftest PASS: tiered mission, real executor + verifiers + orchestrator, rounds/review/directions, INPUT_FILES, sealed package, linked report, stop + resume, zombie resume, search-storm budget discipline");

{
// The python prelude repairs JSON literals in model-written scripts (fresh-run lesson).
{
	const preludeDir = mkdtempSync(join(tmpdir(), "GeoRSI", "episodes", "workspace", "prelude-selftest-"));
	const preludePort = new DirectHostComputePort({ pythonCmd: assertSandboxPythonCommand("python", [ROOT, join(ROOT, "private")]), workspace: preludeDir, repoRoot: ROOT, privateRoot: join(ROOT, "private"), log: () => {} });
	const run = await preludePort.run({ missionId: "selftest", nodeId: "prelude", purpose: "prelude repair", script: `import json
obj = {"b": false, "n": null, "t": true}
json.dump(obj, open("r.json", "w"))
`, timeoutMs: 30_000, networkMode: "open", resultFile: "r.json" });
	assert.ok(run.exitCode === 0 && typeof run.result === "string" && JSON.parse(run.result!).b === false && JSON.parse(run.result!).n === null, "the python prelude repairs JSON literals in model-written scripts");
}
	// Pure budget-gate predicates (#16/#17/#20).
	const budget = { maxToolCalls: 32, wallMs: 20 * 60_000 };
	assert.equal(openEndedToolRefusal("search-literature", 27, budget), null, "discovery is free below the cap");
	assert.match(openEndedToolRefusal("search-literature", 28, budget)!, /TOOL BUDGET RESERVED/, "the cap refuses with a wrap-up instruction");
	assert.equal(openEndedToolRefusal("python-host", 40, budget), null, "closing tools are never refused");
	assert.equal(budgetWarningSuffix(20, budget, budget.wallMs), "", "no warning while budget is plentiful");
	assert.match(budgetWarningSuffix(26, budget, budget.wallMs), /BUDGET WARNING/, "the warning fires before the cap does");
	assert.match(budgetWarningSuffix(0, budget, budget.wallMs * 0.1), /BUDGET WARNING/, "the warning fires on low wall too");
	assert.equal(isTransientToolFailure("literature catalogue HTTP 429"), true, "429 is refunded");
	assert.equal(isTransientToolFailure("connect timeout while fetching source"), true, "timeouts are refunded");
	assert.equal(isTransientToolFailure("literature catalogue returned invalid JSON"), false, "deterministic failures still cost budget");
	assert.equal(isTransientToolFailure(undefined), false);
	// Plan-time fixed values: differentiated per kind, report keeps the historical x2, floors hold.
	assert.ok(planNodeBudget("literature-search").maxToolCalls > planNodeBudget("verification").maxToolCalls, "discovery kinds earn more tool calls than verification");
	assert.ok(planNodeBudget("frame-question").maxToolCalls < planNodeBudget("quantitative-analysis").maxToolCalls, "planning kinds are trimmed");
	assert.equal(planNodeBudget("report").maxToolCalls, DEV_NODE_BUDGET.maxToolCalls * 2, "report keeps the x2 communication scale");
	assert.ok(planNodeBudget("hypothesis").wallMs >= 5 * 60_000 && planNodeBudget("hypothesis").maxToolCalls >= 8, "floors hold for every kind");
	// Modulation: tighten-only, 50% floor, protected kinds, missing data falls back to plan.
	assert.equal(modulateNodeBudget(planNodeBudget("literature-search"), "literature-search", null), null, "no data means the full planned envelope");
	assert.equal(modulateNodeBudget(planNodeBudget("literature-search"), "literature-search", 1.1), null, "healthy pressure does not tighten");
	const tightened = modulateNodeBudget(planNodeBudget("literature-search"), "literature-search", 3);
	assert.ok(tightened && tightened.budget.maxToolCalls === Math.round(planNodeBudget("literature-search").maxToolCalls * 0.5) && tightened.note.includes("leave room"), "severe overrun tightens to the 50% floor with a reason");
	assert.equal(modulateNodeBudget(planNodeBudget("report"), "report", 5), null, "communication kinds are protected");
	assert.ok(runBudgetBrief(planNodeBudget("report"), null, null).includes(`${DEV_NODE_BUDGET.maxToolCalls * 2} tool calls`), "the brief states the envelope without a view");
	const brief = runBudgetBrief(planNodeBudget("literature-search"), { usage: { modelCalls: 3, toolCalls: 10, outputTokens: 9_000, wallMs: 60_000 }, plannedRemaining: { modelCalls: 10, toolCalls: 60, outputTokens: 50_000, wallMs: 600_000 }, remainingNodes: [{ id: "r1-02-verification", kind: "verification", state: "ready", plannedToolCalls: 32, plannedWallMinutes: 20 }], pressure: { overrun: null } }, null);
	assert.ok(brief.includes("run to date") && brief.includes("r1-02-verification") && brief.includes("Spend only your share"), "the brief shows global usage, the downstream queue and pacing guidance");
	// Attempt carry-over: a retry inherits the remainder of the fixed value, floored, output untouched.
	const lit = planNodeBudget("literature-search");
	assert.equal(carryNodeBudgetAcrossAttempts(lit, null), null, "no earlier attempts means the full envelope");
	const carried = carryNodeBudgetAcrossAttempts(lit, { toolCalls: 10, modelCalls: 4, outputTokens: 5000, wallMs: 5 * 60_000 });
	assert.ok(carried && carried.budget.maxToolCalls === lit.maxToolCalls - 10 && carried.budget.maxModelCalls === lit.maxModelCalls - 4 && carried.budget.wallMs === lit.wallMs - 5 * 60_000 && carried.budget.maxOutputTokens === lit.maxOutputTokens, "the remainder is deducted; output tokens stay whole");
	const floored = carryNodeBudgetAcrossAttempts(lit, { toolCalls: lit.maxToolCalls + 20, modelCalls: lit.maxModelCalls, outputTokens: 0, wallMs: lit.wallMs * 2 });
	assert.ok(floored && floored.budget.maxToolCalls === Math.max(12, Math.round(lit.maxToolCalls * 0.25)) && floored.budget.wallMs === Math.max(15 * 60_000, Math.round(lit.wallMs * 0.25)) && floored.note.includes("close out"), "an exhausted envelope floors at 25% so the retry can still close out");
	// Ledger fold: tool/model receipts and ended attempts accumulate per node.
	const folded = foldNodeUsage([
		{ type: "node-start", nodeId: "n1", timestamp: "2026-01-01T00:00:00.000Z" },
		{ type: "scientific-tool-receipt", nodeId: "n1", timestamp: "2026-01-01T00:01:00.000Z" },
		{ type: "model-call-receipt", nodeId: "n1", timestamp: "2026-01-01T00:02:00.000Z", payload: { output: 300 } },
		{ type: "node-failed", nodeId: "n1", timestamp: "2026-01-01T00:03:00.000Z" },
		{ type: "node-start", nodeId: "n1", timestamp: "2026-01-01T00:04:00.000Z" },
		{ type: "scientific-tool-receipt", nodeId: "n1", timestamp: "2026-01-01T00:05:00.000Z" },
		{ type: "model-call-receipt", nodeId: "other", timestamp: "2026-01-01T00:05:00.000Z", payload: { output: 10 } },
	]);
	assert.deepEqual(folded.get("n1"), { modelCalls: 1, toolCalls: 2, outputTokens: 300, wallMs: 3 * 60_000 }, "the fold counts receipts across attempts and only the wall of attempts that ended");
	assert.equal(folded.get("other")?.modelCalls, 1);
}
