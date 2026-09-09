/** Fail-closed gate tests: stop, invalid graphs, network mismatch, strict reads, guard sweep. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateResearchMission, type ResearchMission, type ResearchWorkGraph } from "./contracts.js";
import { createWorkGraph, createWorkNode } from "./work-graph.js";
import { ResearchEventLedger } from "./event-ledger.js";
import { captureResearchEnvironment } from "./environment-capture.js";
import { runResearchOrchestrator, type ResearchOrchestratorPorts } from "./orchestrator.js";
import { readWorkspaceFileStrict } from "../workspace-tools.js";
import { scanWorkspaceForBreachesStrict } from "../guard.js";

let passed = 0;
function check(label: string, condition: unknown): void {
	if (!condition) throw new Error(`FAIL: ${label}`);
	passed += 1;
	console.log(`  ok   ${label}`);
}

const mission: ResearchMission = {
	version: 1,
	id: "gates-selftest",
	question: "gate fixture",
	scope: "deterministic gate coverage",
	estimands: ["x"],
	units: ["dimensionless"],
	assumptions: [],
	constraints: [],
	successCriteria: [{ id: "criterion", description: "verified", kind: "evidence", required: true }],
	requiredDeliverables: [{ id: "table", kind: "table", path: "result.json", required: true, description: "result" }],
	sourcePolicy: { networkMode: "blocked", requireProvenance: true, requireContentHash: true, requireLicenseMetadata: false, requireRetrievedAt: false, requireContraryEvidence: false },
	taskProfile: { family: "quantitative", requiredStages: ["quantitative-analysis", "verification"], capabilities: ["compute"], verifierProfile: "quantitative-v1", deliverableSchema: "fixture-v1", sourceRequirements: [], networkMode: "blocked" },
};

function node(kind: "quantitative-analysis" | "verification", dependsOn: string[]): ResearchWorkGraph["nodes"][number] {
	return createWorkNode({
		id: kind,
		kind,
		title: kind,
		dependsOn,
		inputEvidenceIds: [],
		expectedOutputs: ["out"],
		acceptanceCriteriaIds: ["criterion"],
		allowedCapabilities: ["compute"],
		budget: { wallMs: 10_000, maxModelCalls: 1, maxToolCalls: 2, maxOutputTokens: 1000, maxAttempts: 1 },
	});
}

function graph(): ResearchWorkGraph {
	return createWorkGraph(mission.id, [node("quantitative-analysis", []), node("verification", ["quantitative-analysis"])]);
}

function fixtureEnvironment() {
	return captureResearchEnvironment({ gitCommit: null, gitDirty: null, configFingerprint: "cfg", strategyFingerprint: "strategy", modelProfileVersion: "p", modelProfileFingerprint: "p", pythonPath: "python", networkMode: "blocked", evaluatorMetrics: {}, randomSeeds: [] }, new Date("2026-08-30T00:00:00Z"));
}

function basePorts(overrides: Partial<ResearchOrchestratorPorts> = {}): ResearchOrchestratorPorts {
	return {
		executeNode: async (node) => ({ artifactIds: [`${node.id}-artifact`], usage: { modelCalls: 0, toolCalls: 0, outputTokens: 0 } }),
		verifyNode: async (node) => ({ passed: true, evidenceIds: [`${node.id}-verified`], issues: [], usage: { modelCalls: 0, toolCalls: 0, outputTokens: 0 } }),
		checkpointGraph: () => {},
		currentEvidence: () => [],
		synthesize: async () => { throw new Error("synthesize should not be reached in stop tests"); },
		runtimeAttestation: () => ({ version: 1, runMode: "deterministic-demo", unitTestsPassed: true, guardViolations: [], cleanupPassed: true, isolationBackend: "deterministic-test-double", modelCalls: [], familyVerifications: [], contraryEvidenceLinks: [], totalTokens: 0, wallSeconds: 0 }),
		outcomeAttestation: async () => ({ taskOutcome: 1, perFamily: { quantitative: 1 } }),
		persistJson: () => {},
		persistText: () => {},
		persistDeliverables: () => [],
		readDeliverable: () => Buffer.from("{}"),
		computeReplay: async () => ({ passed: true, backend: "deterministic-test-double", processOwnershipVerified: false }),
		now: () => new Date("2026-08-30T00:00:00Z"),
		...overrides,
	};
}

async function main(): Promise<void> {
	console.log("== research orchestrator fail-closed gates ==");
	const root = mkdtempSync(join(tmpdir(), "georsi-gates-"));
	try {
		const stoppedLedgerPath = join(root, "stopped-events.jsonl");
		const stoppedLedger = new ResearchEventLedger(stoppedLedgerPath, () => new Date("2026-08-30T00:00:00Z"));
		const persistedPaths: string[] = [];
		let stopError: unknown;
		try {
			await runResearchOrchestrator({
				mission,
				graph: graph(),
				environment: fixtureEnvironment(),
				ledger: stoppedLedger,
				evidenceStore: { verify: () => true, read: () => Buffer.from("{}") } as never,
				ledgerPath: stoppedLedgerPath,
				ports: basePorts({
					stopRequested: () => true,
					persistJson: (path) => { persistedPaths.push(path); },
				}),
			});
		} catch (error) { stopError = error; }
		check("terminal stop aborts before synthesis and persists nothing", String(stopError).includes("stopped before finalization") && persistedPaths.length === 0);
		stoppedLedger.close();
		check("terminal stop records a failure event in the ledger", existsSync(stoppedLedgerPath) && readFileSync(stoppedLedgerPath, "utf8").includes("research-mission-failed"));

		const invalidLedgerPath = join(root, "invalid-events.jsonl");
		const invalidLedger = new ResearchEventLedger(invalidLedgerPath, () => new Date("2026-08-30T00:00:00Z"));
		const invalidGraph = createWorkGraph(mission.id, [node("quantitative-analysis", [])]);
		let invalidGraphRejected = false;
		try {
			await runResearchOrchestrator({
				mission,
				graph: invalidGraph,
				environment: fixtureEnvironment(),
				ledger: invalidLedger,
				evidenceStore: { verify: () => true, read: () => Buffer.from("{}") } as never,
				ledgerPath: invalidLedgerPath,
				ports: basePorts(),
			});
		} catch (error) { invalidGraphRejected = String(error).includes("invalid research work graph"); }
		invalidLedger.close();
		const invalidLedgerContent = existsSync(invalidLedgerPath) ? readFileSync(invalidLedgerPath, "utf8").trim() : "";
		check("direct orchestrator call rejects mission-incomplete graphs before any effect", invalidGraphRejected && invalidLedgerContent.length === 0);

		const mismatchMission: ResearchMission = { ...mission, sourcePolicy: { ...mission.sourcePolicy, networkMode: "blocked" }, taskProfile: { ...mission.taskProfile, networkMode: "open" } };
		const mismatchIssues = validateResearchMission(mismatchMission);
		check("source policy and task profile network mismatch is rejected", mismatchIssues.some((issue) => issue.includes("network mode")));

		const readerRoot = join(root, "reader");
		mkdirSync(join(readerRoot, "inner"), { recursive: true });
		const outsideFile = join(root, "outside.txt");
		writeFileSync(outsideFile, "secret");
		writeFileSync(join(readerRoot, "inner", "ok.txt"), "fine");
		let linkRejected: boolean | null = null;
		try {
			symlinkSync(outsideFile, join(readerRoot, "inner", "link.txt"), "file");
			try { readWorkspaceFileStrict(readerRoot, join(readerRoot, "inner", "link.txt")); linkRejected = false; }
			catch (error) { linkRejected = String(error).includes("symlink/reparse"); }
		} catch { linkRejected = null; /* symlink creation unavailable on this host */ }
		let traversalRejected = false;
		try { readWorkspaceFileStrict(readerRoot, join(readerRoot, "..", "outside.txt")); }
		catch (error) { traversalRejected = String(error).includes("escapes workspace"); }
		const okContent = readWorkspaceFileStrict(readerRoot, join(readerRoot, "inner", "ok.txt")).toString("utf8");
		check("strict workspace reader blocks traversal and allows regular files", traversalRejected && okContent === "fine");
		if (linkRejected !== null) check("strict workspace reader rejects symlink/reparse output", linkRejected);
		else console.log("  skip strict-reader symlink check (symlink creation unavailable)");

		const sweepRoot = join(root, "sweep");
		mkdirSync(sweepRoot, { recursive: true });
		writeFileSync(join(sweepRoot, "notes.md"), "contains answers.private marker");
		let sweepSymlinkError: boolean | null = null;
		try {
			symlinkSync(outsideFile, join(sweepRoot, "escape.log"), "file");
			const probeSweep = scanWorkspaceForBreachesStrict(sweepRoot);
			sweepSymlinkError = probeSweep.errors.some((message) => message.includes("escape.log"));
		} catch { sweepSymlinkError = null; }
		const sweep = scanWorkspaceForBreachesStrict(sweepRoot);
		check("strict guard sweep reports planted breaches", sweep.breaches.some((breach) => breach.pattern === "answers.private"));
		if (sweepSymlinkError !== null) check("strict guard sweep reports symlink errors", sweepSymlinkError);
		else console.log("  skip guard-sweep symlink check (symlink creation unavailable)");

		console.log(`RESEARCH_GATES_OK ${passed} passed`);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

await main();
