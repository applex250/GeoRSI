/** Deterministic no-model capstone proving the complete research package path. */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteJson, writeTextAtomic } from "../journal.js";
import { profileResearchTask } from "./task-profile.js";
import type { EvidenceRef, ResearchMission } from "./contracts.js";
import { createWorkGraph, createWorkNode } from "./work-graph.js";
import { ContentAddressedEvidenceStore } from "./evidence-store.js";
import { ResearchEventLedger } from "./event-ledger.js";
import { captureResearchEnvironment } from "./environment-capture.js";
import { persistResearchDeliverables } from "./deliverable-store.js";
import { runResearchOrchestrator, type ResearchRunResult } from "./orchestrator.js";
import { verificationResult } from "./verifiers/base.js";

function akiBValue(values: number[], mc: number): number {
	const selected = values.filter((value) => value >= mc);
	const mean = selected.reduce((sum, value) => sum + value, 0) / selected.length;
	return Math.LOG10E / (mean - mc);
}

function safeOutputPath(root: string, relativePath: string): string {
	const target = resolve(root, relativePath);
	const rel = relative(resolve(root), target);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`unsafe research output path: ${relativePath}`);
	return target;
}

export async function runDeterministicResearchDemo(runDir: string, options: { failAt?: "synthesis" | "compute-replay" } = {}): Promise<ResearchRunResult> {
	if (existsSync(join(runDir, "research-manifest.json"))) throw new Error(`research demo already exists: ${runDir}`);
	mkdirSync(runDir, { recursive: true });
	const profile = profileResearchTask({ id: "seismic-capstone-demo", genre: "capstone-seismology", research: { family: "capstone", networkMode: "open" } });
	const mission: ResearchMission = {
		version: 1,
		id: `research-${basename(runDir)}`,
		question: "Are Gutenberg–Richter b-value estimates stable across completeness thresholds in a frozen seismic catalog?",
		scope: "Deterministic public fixture used to validate the GeoRSI research runtime, evidence chain, GIS artifact, and replay path.",
		estimands: ["Gutenberg-Richter b-value", "spatial event count"],
		units: ["dimensionless", "events per cell"],
		assumptions: ["magnitudes use one comparable scale", "the fixture is not a population-level discovery"],
		constraints: ["no private truth", "no model call", "network source represented by a frozen fixture"],
		successCriteria: [{ id: "criterion-replay", description: "each stage has hashed output and verifier evidence", kind: "replay", required: true }],
		requiredDeliverables: [
			{ id: "report", kind: "report", path: "report.md", required: true, description: "scientific report" },
			{ id: "presentation", kind: "presentation", path: "presentation.md", required: true, description: "eight-slide presentation" },
			{ id: "defense", kind: "defense", path: "defense.json", required: true, description: "evidence-grounded defense questions" },
		],
		sourcePolicy: { networkMode: "open", requireProvenance: true, requireContentHash: true, requireLicenseMetadata: true, requireRetrievedAt: true, requireContraryEvidence: true },
		taskProfile: profile,
	};
	const budget = { wallMs: 60_000, maxModelCalls: 0, maxToolCalls: 4, maxOutputTokens: 4096, maxAttempts: 2 };
	const nodes = profile.requiredStages.map((kind, index) => createWorkNode({
		id: `${String(index + 1).padStart(2, "0")}-${kind}`,
		kind,
		title: kind.replace(/-/g, " "),
		dependsOn: index === 0 ? [] : [`${String(index).padStart(2, "0")}-${profile.requiredStages[index - 1]}`],
		inputEvidenceIds: [],
		expectedOutputs: [`${kind}-artifact`],
		acceptanceCriteriaIds: ["criterion-replay"],
		allowedCapabilities: profile.capabilities,
		budget,
	}));
	const graph = createWorkGraph(mission.id, nodes);
	const evidenceRoot = join(tmpdir(), "GeoRSI", "evidence", basename(runDir));
	const evidenceStore = new ContentAddressedEvidenceStore(evidenceRoot);
	const ledgerPath = join(runDir, "events.jsonl");
	const ledger = new ResearchEventLedger(ledgerPath);
	const evidence: EvidenceRef[] = [];
	const magnitudes = [2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1, 3.2, 3.4, 3.6, 3.9, 4.2];
	const primaryB = akiBValue(magnitudes, 2.5);
	const sensitivity = [2.5, 2.6, 2.7].map((mc) => ({ mc, b: akiBValue(magnitudes, mc), count: magnitudes.filter((value) => value >= mc).length }));
	let quantitativeEvidenceId = "";
	let dataEvidenceId = "";
	let gisEvidenceId = "";
	let sensitivityEvidenceId = "";
	const literatureEvidenceIds: string[] = [];
	const verifierEvidenceIds: string[] = [];
	const environment = captureResearchEnvironment({ gitCommit: null, gitDirty: null, configFingerprint: "deterministic-demo", strategyFingerprint: "seed-research", modelProfileVersion: "no-model", modelProfileFingerprint: "no-model", pythonPath: "not-used", networkMode: "open", evaluatorMetrics: { research: "three-layer-v1" }, randomSeeds: [7] });
	const output = (relative: string): string => safeOutputPath(runDir, relative);
	return runResearchOrchestrator({
		mission,
		graph,
		environment,
		ledger,
		evidenceStore,
		ledgerPath,
		ports: {
			now: () => new Date(),
			executeNode: async (node) => {
				let value: unknown = { stage: node.kind, completed: true };
				let kind: EvidenceRef["kind"] = "tool-output";
				let sourceUrl: string | undefined;
				let license: string | undefined;
				if (node.kind === "literature-search") {
					const sourceRecords = [
						{ title: "Frozen completeness fixture A", doi: "10.0000/georsi.demo.a" },
						{ title: "Frozen completeness fixture B", doi: "10.0000/georsi.demo.b" },
						{ title: "Frozen contrary fixture", doi: "10.0000/georsi.demo.c" },
					];
					for (const [index, source] of sourceRecords.entries()) {
						const reference = evidenceStore.putJson({ query: "Gutenberg Richter magnitude completeness", ...source, note: "runtime fixture, not a novelty claim" }, { kind: "source", logicalName: `${node.id}-source-${index + 1}.json`, producerNodeId: node.id, sourceUrl: `https://api.crossref.org/works/${source.doi}`, retrievedAt: new Date().toISOString(), license: "fixture-only" });
						evidence.push(reference);
						literatureEvidenceIds.push(reference.id);
					}
					return { artifactIds: [...literatureEvidenceIds], usage: { modelCalls: 0, toolCalls: 1, outputTokens: 0 } };
				} else if (node.kind === "data-audit") value = { rows: magnitudes.length, missing: 0, duplicates: 0, unit: "magnitude" };
				else if (node.kind === "quantitative-analysis") value = { mc: 2.5, b: primaryB, count: magnitudes.length, method: "Aki MLE" };
				else if (node.kind === "sensitivity") value = sensitivity;
				else if (node.kind === "gis-analysis") {
					kind = "geodata";
					value = { type: "FeatureCollection", crs: { type: "name", properties: { name: "EPSG:4326" } }, features: magnitudes.slice(0, 4).map((magnitude, index) => ({ type: "Feature", properties: { magnitude }, geometry: { type: "Point", coordinates: [-118 + index * 0.1, 34 + index * 0.1] } })) };
				}
				const reference = evidenceStore.putJson(value, { kind, logicalName: `${node.id}.json`, producerNodeId: node.id, sourceUrl, retrievedAt: sourceUrl ? new Date().toISOString() : undefined, license });
				evidence.push(reference);
				if (node.kind === "data-audit") dataEvidenceId = reference.id;
				if (node.kind === "quantitative-analysis") quantitativeEvidenceId = reference.id;
				if (node.kind === "gis-analysis") gisEvidenceId = reference.id;
				if (node.kind === "sensitivity") sensitivityEvidenceId = reference.id;
				return { artifactIds: [reference.id], metadata: { stage: node.kind }, usage: { modelCalls: 0, toolCalls: 1, outputTokens: 0 } };
			},
			verifyNode: async (node, result) => {
				const reference = evidenceStore.putJson({ node: node.id, passed: result.artifactIds.length > 0, artifactIds: result.artifactIds }, { kind: "verifier", logicalName: `${node.id}-verification.json`, producerNodeId: node.id });
				evidence.push(reference);
				verifierEvidenceIds.push(reference.id);
				return { passed: result.artifactIds.length > 0, evidenceIds: [reference.id], issues: [], usage: { modelCalls: 0, toolCalls: 1, outputTokens: 0 } };
			},
			checkpointGraph: (current) => atomicWriteJson(output("plan.json"), current),
			currentEvidence: () => [...evidence],
			synthesize: async () => {
				if (options.failAt === "synthesis") throw new Error("synthetic synthesis failure");
				if (!quantitativeEvidenceId) throw new Error("quantitative evidence was not produced");
				const valueDimension = { score: 3 as const, rationale: "the deterministic fixture, sensitivity table, and replay provide bounded evidence", evidenceIds: [quantitativeEvidenceId] };
				return {
					hypotheses: [{ id: "hypothesis-b-stability", statement: "The b-value remains stable across nearby Mc choices.", rationaleEvidenceIds: [quantitativeEvidenceId], expectedObservation: "nearby estimates remain within a declared tolerance", falsifier: "sensitivity estimates diverge beyond tolerance", status: "supported" as const }],
					claims: [{ id: "claim-b", text: `The fixture Aki estimate at Mc=2.5 is ${primaryB.toFixed(4)}.`, status: "supported" as const, evidenceIds: [quantitativeEvidenceId], uncertainty: "small deterministic fixture; sensitivity table is provided", limitations: ["not a real scientific discovery", "fixture catalog is small"] }],
					valueCard: { significance: valueDimension, novelty: valueDimension, falsifiability: valueDimension, dataFeasibility: valueDimension, methodologicalValue: valueDimension, potentialImpact: valueDimension, limitations: ["runtime validation fixture"], recommendation: "proceed" as const },
					narrative: {
						dataSummary: { text: `${magnitudes.length} frozen magnitudes were audited with no missing values.`, evidenceIds: [dataEvidenceId] },
						methodSummary: { text: "Aki maximum-likelihood b-value, nearby Mc sensitivity, and a GeoJSON point artifact exercise quantitative and GIS paths.", evidenceIds: [quantitativeEvidenceId, gisEvidenceId, ...verifierEvidenceIds.slice(0, 1)], claimIds: ["claim-b"] },
						resultSummary: { text: `The primary deterministic estimate is b=${primaryB.toFixed(4)}.`, evidenceIds: [quantitativeEvidenceId], claimIds: ["claim-b"] },
						uncertaintySummary: { text: "Nearby Mc estimates are retained as a sensitivity table; the small fixture limits inference.", evidenceIds: [sensitivityEvidenceId, ...verifierEvidenceIds.slice(-1)], claimIds: ["claim-b"] },
						innovationSummary: { text: "The contribution is a complete evidence/replay workflow, not a novel seismological finding.", evidenceIds: literatureEvidenceIds },
						reproducibilitySummary: { text: "Verify the ledger and CAS hashes, then recompute Aki MLE from the frozen magnitudes.", evidenceIds: verifierEvidenceIds.slice(0, 2) },
					},
				};
			},
			runtimeAttestation: () => ({
				version: 1,
				runMode: "deterministic-demo",
				unitTestsPassed: true,
				guardViolations: [],
				cleanupPassed: true,
				isolationBackend: "deterministic-test-double",
				modelCalls: [],
				familyVerifications: [
					{ profile: "quantitative-v1", result: verificationResult("quantitative-v1", [], { fixture: true }), inputHash: "1".repeat(64), evidenceIds: [quantitativeEvidenceId, verifierEvidenceIds[0]!] },
					{ profile: "gis-v1", result: verificationResult("gis-v1", [], { fixture: true }), inputHash: "2".repeat(64), evidenceIds: [gisEvidenceId, verifierEvidenceIds[1]!] },
					{ profile: "literature-v1", result: verificationResult("literature-v1", [], { fixture: true }), inputHash: "3".repeat(64), evidenceIds: [...literatureEvidenceIds, verifierEvidenceIds[2]!] },
				],
				contraryEvidenceLinks: [{ sourceEvidenceId: literatureEvidenceIds[2]!, claimId: "claim-b" }],
				totalTokens: 0,
				wallSeconds: 0,
			}),
			outcomeAttestation: async () => ({ taskOutcome: 1, perFamily: { quantitative: 1, gis: 1, literature: 1 } }),
			persistJson: (relative, value) => atomicWriteJson(output(relative), value),
			persistText: (relative, value) => writeTextAtomic(output(relative), value),
			persistDeliverables: (bundle, required) => persistResearchDeliverables(runDir, bundle, required),
			readDeliverable: (relative) => readFileSync(output(relative)),
			computeReplay: async (_current, refs) => {
				if (options.failAt === "compute-replay") throw new Error("synthetic compute replay failure");
				return { passed: refs.every((reference) => evidenceStore.verify(reference)) && Math.abs(akiBValue(magnitudes, 2.5) - primaryB) < 1e-12, backend: "deterministic-test-double", processOwnershipVerified: false };
			},
		},
	});
}
