/** Deterministic tests for the run-scoped read-only context memory. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContentAddressedEvidenceStore } from "./evidence-store.js";
import type { EvidenceRef } from "./contracts.js";
import { createContextRecallTool, ResearchContextMemory, scoreBlocks, tokenize, type ContextRecallOutput } from "./context-memory.js";
import { ScientificToolRegistry } from "./tool-registry.js";
import { buildResearchNodeContext } from "./research-node-executor.js";
import { SEED_STRATEGY_BUNDLE } from "./strategy-bundle.js";
import { createWorkGraph, createWorkNode } from "./work-graph.js";
import type { ResearchMission } from "./contracts.js";

let passed = 0;
function check(label: string, condition: unknown): void {
	if (!condition) throw new Error(`FAIL: ${label}`);
	passed += 1;
	console.log(`  ok   ${label}`);
}

async function main(): Promise<void> {
	console.log("== research context memory ==");
	const root = mkdtempSync(join(tmpdir(), "georsi-context-memory-"));
	try {
		const store = new ContentAddressedEvidenceStore(join(root, "cas"));
		const references = new Map<string, EvidenceRef>();
		const memory = new ResearchContextMemory({ evidenceStore: store, evidenceById: (id) => references.get(id) });

		const bArtifact = store.putJson({ estimate: 0.85, uncertainty: { method: "bootstrap", lower: 0.79, upper: 0.91 } }, { kind: "tool-output", logicalName: "05-quant-result.json", producerNodeId: "05-quant" });
		references.set(bArtifact.id, bArtifact);
		const litArtifact = store.putText("Mc completeness affects the b value estimate across catalogs", { kind: "source", logicalName: "lit-note.txt", producerNodeId: "03-literature", mediaType: "text/plain" });
		references.set(litArtifact.id, litArtifact);

		const submissionA = store.putJson({ version: 1, nodeId: "05-quant", summary: "b value" }, { kind: "tool-output", logicalName: "05-quant-submission.json", producerNodeId: "05-quant" });
		references.set(submissionA.id, submissionA);
		memory.commit("05-quant", { id: submissionA.id, sha256: submissionA.sha256 }, {
			summary: "Computed the Gutenberg-Richter b value with Aki MLE at Mc=2.5.",
			artifactIds: [bArtifact.id],
			decisions: [{ question: "estimator", alternatives: ["Aki MLE", "regression"], selected: "Aki MLE", uncertainty: "bootstrap interval reported" }],
			verifications: [{ profile: "quantitative-v1", inputArtifactId: bArtifact.id, evidenceIds: [bArtifact.id] }],
		});
		const submissionB1 = store.putJson({ version: 1, nodeId: "07-verify" }, { kind: "tool-output", logicalName: "07-verify-submission-1.json", producerNodeId: "07-verify" });
		references.set(submissionB1.id, submissionB1);
		memory.commit("07-verify", { id: submissionB1.id, sha256: submissionB1.sha256 }, { summary: "draft verification pass", artifactIds: [], decisions: [], verifications: [] });
		const submissionB2 = store.putJson({ version: 2, nodeId: "07-verify" }, { kind: "tool-output", logicalName: "07-verify-submission-2.json", producerNodeId: "07-verify" });
		references.set(submissionB2.id, submissionB2);
		memory.commit("07-verify", { id: submissionB2.id, sha256: submissionB2.sha256 }, {
			summary: "Verified quantitative results; 不确定性区间已复核。",
			artifactIds: [],
			decisions: [{ question: "tolerance", alternatives: ["0.05", "0.01"], selected: "0.05", uncertainty: "sensitivity runs support it" }],
			verifications: [],
		});

		check("tokenizer covers ascii words and CJK bigrams", tokenize("b-value estimate 不确定性").includes("estimate") && tokenize("不确定性区间").includes("确定"));
		check("scoring is deterministic across repeated queries", JSON.stringify(scoreBlocks(tokenize("bootstrap uncertainty"), memory.blocks()).map((item) => item.block.evidenceId)) === JSON.stringify(scoreBlocks(tokenize("bootstrap uncertainty"), memory.blocks()).map((item) => item.block.evidenceId)));

		const catalog = memory.catalog();
		check("catalog lists committed nodes with latest versions and artifacts", catalog.length === 2 && catalog.find((node) => node.nodeId === "07-verify")?.version === 2 && catalog.find((node) => node.nodeId === "05-quant")?.artifacts[0]?.logicalName === "05-quant-result.json");
		check("catalog is filtered by node", memory.catalog("05-quant").length === 1 && memory.catalog("05-quant")[0]!.nodeId === "05-quant");

		const registry = new ScientificToolRegistry();
		registry.register(createContextRecallTool({ memory }));
		const context = { missionId: "m", episodeId: "e", nodeId: "07-verify", allowedCapabilities: ["context-memory"], remainingWallMs: 10_000 };

		memory.syncGraphState([
			{ id: "01-frame", state: "completed", attempts: 1 },
			{ id: "05-quant", state: "running", attempts: 2 },
			{ id: "07-verify", state: "pending", attempts: 1 },
		]);

		const listed = (await registry.execute("context-recall", context, { list: true })).result.output as ContextRecallOutput;
		check("list mode exposes callable memory with node versions and artifact ids", listed.mode === "list" && listed.nodes?.some((node) => node.nodeId === "05-quant" && node.artifacts.some((artifact) => artifact.evidenceId === bArtifact.id)) === true);
		check("list mode reports work-graph progress including attempts", listed.progress?.["01-frame"] === "completed" && listed.progress?.["05-quant"] === "running(attempt 2)" && listed.progress?.["07-verify"] === "pending");

		const mapMission: ResearchMission = {
			version: 1,
			id: "map-mission",
			question: "q",
			scope: "s",
			estimands: ["x"],
			units: ["u"],
			assumptions: [],
			constraints: [],
			successCriteria: [{ id: "c", description: "d", kind: "evidence", required: true }],
			requiredDeliverables: [],
			sourcePolicy: { networkMode: "blocked", requireProvenance: false, requireContentHash: false, requireLicenseMetadata: false, requireRetrievedAt: false, requireContraryEvidence: false },
			taskProfile: { family: "quantitative", requiredStages: ["quantitative-analysis", "sensitivity"], capabilities: ["compute", "context-memory"], verifierProfile: "quantitative-v1", deliverableSchema: "t", sourceRequirements: [], networkMode: "blocked" },
		};
		const budget = { wallMs: 30_000, maxModelCalls: 1, maxToolCalls: 4, maxOutputTokens: 2000, maxAttempts: 1 };
		const mapGraph = createWorkGraph(mapMission.id, [
			createWorkNode({ id: "05-quant", kind: "quantitative-analysis", title: "quant", dependsOn: [], inputEvidenceIds: [], expectedOutputs: ["out"], acceptanceCriteriaIds: ["c"], allowedCapabilities: ["compute", "context-memory"], budget }),
			createWorkNode({ id: "07-sens", kind: "sensitivity", title: "sens", dependsOn: ["05-quant"], inputEvidenceIds: [], expectedOutputs: ["out"], acceptanceCriteriaIds: ["c"], allowedCapabilities: ["compute", "context-memory"], budget }),
		]);
		const mapContext = buildResearchNodeContext({ mission: mapMission, strategy: SEED_STRATEGY_BUNDLE, node: mapGraph.nodes[0]!, graph: mapGraph, evidence: [] });
		check("graph map orients the node with YOU ARE HERE and downstream markers", mapContext.text.includes("YOU ARE HERE") && mapContext.text.includes("07-sens [sensitivity]") && mapContext.text.includes("your downstream"));
		const sensContext = buildResearchNodeContext({ mission: mapMission, strategy: SEED_STRATEGY_BUNDLE, node: mapGraph.nodes[1]!, graph: mapGraph, evidence: [] });
		check("graph map marks downstream view from another node", sensContext.text.includes("YOU ARE HERE") && sensContext.text.includes("05-quant [quantitative-analysis]") && !sensContext.text.includes("your downstream"));

		const filtered = (await registry.execute("context-recall", context, { node: "self", field: "decisions" })).result.output as ContextRecallOutput;
		check("self+field filter returns only the calling node's decisions", filtered.mode === "filter" && filtered.entries?.length === 1 && filtered.entries[0]!.nodeId === "07-verify" && filtered.entries[0]!.field === "decisions");

		const searched = (await registry.execute("context-recall", context, { query: "estimate lower upper" })).result.output as ContextRecallOutput;
		check("lexical search ranks the artifact containing the queried terms first", searched.mode === "search" && searched.entries?.[0]!.evidenceId === bArtifact.id && (searched.entries[0]!.score ?? 0) > 0);

		const cjk = (await registry.execute("context-recall", context, { query: "不确定性" })).result.output as ContextRecallOutput;
		check("CJK search reaches the Chinese summary block", cjk.mode === "search" && (cjk.entries ?? []).some((entry) => entry.nodeId === "07-verify" && entry.field === "summary"));

		const fetched = (await registry.execute("context-recall", context, { evidenceId: bArtifact.id, maxChars: 500 })).result.output as ContextRecallOutput;
		check("fetch returns verified evidence content by id", fetched.mode === "fetch" && fetched.entries?.[0]!.excerpt.includes("0.85"));

		const miss = (await registry.execute("context-recall", context, { query: "volcanic ash" })).result.output as ContextRecallOutput;
		check("empty search returns a catalog hint instead of fabricating", miss.mode === "search" && miss.entries?.length === 0 && (miss.hint ?? "").includes("list:true"));

		let unknownRejected = false;
		try { await registry.execute("context-recall", context, { evidenceId: "sha256:" + "f".repeat(64) }); }
		catch { unknownRejected = true; }
		check("unknown evidence id fails closed", unknownRejected);

		const truncated = (await registry.execute("context-recall", context, { node: "05-quant", field: "artifacts", maxChars: 200 })).result.output as ContextRecallOutput;
		check("excerpts respect the maxChars budget", truncated.entries?.every((entry) => entry.excerpt.length <= 201) === true);

		let unauthorizedRejected = false;
		try { await registry.execute("context-recall", { ...context, allowedCapabilities: ["python"] }, { list: true }); }
		catch { unauthorizedRejected = true; }
		check("context-recall is gated by the context-memory capability", unauthorizedRejected);

		console.log(`CONTEXT_MEMORY_OK ${passed} passed`);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

await main();
