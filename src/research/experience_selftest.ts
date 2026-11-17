/** Deterministic tests for the experience layer: signature, extraction from a sealed demo
 * package and from a failed synthetic run, the three gates, the store's idempotency and the
 * human approval path. No model, no network. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../config.js";
import { runDeterministicResearchDemo } from "./demo.js";
import { ResearchEventLedger } from "./event-ledger.js";
import type { ResearchMission, ResearchWorkGraph } from "./contracts.js";
import { extractExperience } from "./experience/extract.js";
import { applyGates } from "./experience/gates.js";
import { harvestRunExperience } from "./experience/harvest.js";
import { approvalId } from "./experience/approval.js";
import { keywordSimilarity, signatureTokens, taskSignature } from "./experience/signature.js";
import { validateExperienceRecord } from "./experience/schema.js";
import { ExperienceStore } from "./experience/store.js";

let passed = 0;
function check(label: string, condition: unknown): void {
	if (!condition) throw new Error(`FAIL: ${label}`);
	passed += 1;
	console.log(`  ok   ${label}`);
}

async function main(): Promise<void> {
	const storeRoot = mkdtempSync(join(tmpdir(), "georsi-xp-"));
	const store = new ExperienceStore(storeRoot);
	const demoDir = join(ROOT, "runs", `xp-selftest-${randomUUID().slice(0, 8)}`);
	try {
		console.log("== sealed demo package → record ==");
		await runDeterministicResearchDemo(demoDir);
		const mission = JSON.parse(readFileSync(join(demoDir, "mission.json"), "utf8")) as ResearchMission;
		const extracted = extractExperience(demoDir, () => new Date("2026-09-15T00:00:00Z"));
		check("a complete sealed package yields a run record and no extraction gaps", extracted.run !== null && extracted.issues.length === 0);
		const run = extracted.run!;
		check("record validates", validateExperienceRecord(run).length === 0);
		check("route carries every node with kind, deps and state", run.route.nodes.length === 14 && run.route.nodes.every((node) => node.kind && node.state === "completed"));
		check("outcome reflects the package: verifier pass, replayable, honestly ineligible", run.outcome.verifier === "pass" && run.outcome.replayable && run.outcome.eligible === false && run.outcome.scienceScore !== null);
		check("evidence commits are durable hashes from the manifest", /^[a-f0-9]{64}$/.test(run.evidence.manifestHash ?? "") && run.evidence.evidenceHashes.length > 0 && run.evidence.claimIds.length > 0);
		check("origin names the run mode and fingerprints", run.origin.runMode === "deterministic-demo" && run.origin.runId === demoDir.split(/[\\/]/).pop() && run.origin.strategyFingerprint !== null);
		check("signature exact key is stable and keyed on the mission contract", run.signature.exact === taskSignature(mission).exact && run.signature.exact !== taskSignature({ ...mission, taskProfile: { ...mission.taskProfile, requiredStages: ["report"] } }).exact);
		check("keywords mix ascii words and CJK bigrams", signatureTokens("Gutenberg-Richter b值 估计 catalog").includes("gutenberg-richter") && signatureTokens("黄土高原植被恢复").includes("黄土"));
		check("keyword similarity is a bounded Jaccard", keywordSimilarity(run.signature, run.signature) === 1 && keywordSimilarity(run.signature, { ...run.signature, keywords: ["zzz"] }) === 0);
		const gatedDemo = applyGates(run, { knownFamilies: new Set() });
		check("fixture runs are retired on arrival and never wait for a human", gatedDemo.status === "retired" && gatedDemo.gates.human === "not-required" && gatedDemo.lineage.notes.some((note) => note.includes("fixture")));

		console.log("== gates on a real-looking record ==");
		const real = { ...run, origin: { ...run.origin, runMode: "host-development" } };
		const fresh = applyGates(real, { knownFamilies: new Set() });
		check("verifier pass + replay verified → candidate, but first-of-family waits for a human", fresh.status === "candidate" && fresh.gates.replay === "verified" && fresh.gates.human === "pending");
		const known = applyGates({ ...real, signature: { ...real.signature, datasetFingerprint: null } }, { knownFamilies: new Set([real.family]) });
		check("a known family without uploaded data needs no human", known.gates.human === "not-required" && known.status === "candidate");
		const unreplayed = applyGates({ ...real, outcome: { ...real.outcome, replayable: false } }, { knownFamilies: new Set([real.family]) });
		check("an unreplayed package stays on probation", unreplayed.status === "probation" && unreplayed.gates.replay === "unverified");
		const partial = applyGates({ ...real, outcome: { ...real.outcome, verifier: "partial" } }, { knownFamilies: new Set([real.family]) });
		check("a partial verifier pass is probation", partial.status === "probation");

		console.log("== failed synthetic run → counter-example ==");
		const failedDir = join(ROOT, "runs", `xp-selftest-failed-${randomUUID().slice(0, 8)}`);
		mkdirSync(failedDir, { recursive: true });
		try {
			writeFileSync(join(failedDir, "mission.json"), JSON.stringify(mission));
			const plan: ResearchWorkGraph = { version: 1, missionId: mission.id, createdAt: "2026-09-15T00:00:00Z", updatedAt: "2026-09-15T00:00:00Z", nodes: [{ id: "01-quantitative-analysis", title: "q", kind: "quantitative-analysis", dependsOn: [], inputEvidenceIds: [], expectedOutputs: ["x"], acceptanceCriteriaIds: [], allowedCapabilities: [], budget: { wallMs: 1, maxModelCalls: 1, maxToolCalls: 1, maxOutputTokens: 1, maxAttempts: 2 }, state: "failed", attempts: 2, outputArtifactIds: [], acceptanceEvidenceIds: [], failureCode: "tool-routing", failureMessage: "unknown tool requested" }] };
			writeFileSync(join(failedDir, "plan.json"), JSON.stringify(plan));
			const ledger = new ResearchEventLedger(join(failedDir, "events.jsonl"));
			ledger.append({ missionId: mission.id, episodeId: mission.id, nodeId: "01-quantitative-analysis", actor: "controller", type: "node-start", status: "progress", payload: { attempt: 1 } });
			ledger.append({ missionId: mission.id, episodeId: mission.id, nodeId: "01-quantitative-analysis", actor: "controller", type: "node-failed", status: "failure", payload: { class: "tool-routing", code: "node-execution", message: "unknown tool requested", retryable: false, affectedComponent: "planner" } });
			ledger.close();
			const failed = extractExperience(failedDir);
			check("an incomplete run yields no run record but lists the gap", failed.run === null && failed.issues.some((issue) => issue.includes("incomplete")));
			check("each failed attempt becomes a counter-example with a hypothesis template", failed.counterExamples.length === 1 && failed.counterExamples[0]!.failure?.class === "tool-routing" && failed.counterExamples[0]!.failure!.hypothesis.length > 0 && failed.counterExamples[0]!.failure!.nodeKind === "quantitative-analysis");
			const gatedCounter = applyGates(failed.counterExamples[0]!, { knownFamilies: new Set([mission.taskProfile.family]) });
			check("non-retryable failure classes wait for a human as counter-examples", gatedCounter.status === "counter-example" && gatedCounter.gates.human === "pending");
			check("counter-examples validate", validateExperienceRecord(gatedCounter).length === 0);
		} finally { rmSync(failedDir, { recursive: true, force: true }); }

		console.log("== store: idempotency, refusal, approval ==");
		// Two distinct runs of the same signature: the store is keyed by record id, so the
		// second record needs its own id (as a real second run would have).
		const unreplayedStored = { ...unreplayed, id: `${unreplayed.id}b`, origin: { ...unreplayed.origin, runId: `${unreplayed.origin.runId}b` } };
		const first = store.append([fresh, unreplayedStored]);
		check("first append stores both records and builds the index", first.added.length === 2 && store.index()?.records === 2 && store.index()?.pendingHuman.length === 1);
		const second = store.append([fresh]);
		check("re-appending the same id is skipped, not duplicated", second.added.length === 0 && second.skipped.length === 1 && store.records().length === 2);
		const refused = store.append([{ ...fresh, id: "bad-id" }]);
		check("invalid records are refused with their issues", refused.refused.length === 1 && refused.refused[0]!.issues.some((issue) => issue.includes("xp_")));
		check("known families come from stored run records", store.knownFamilies().has(fresh.family));
		const at = "2026-09-15T01:00:00.000Z";
		const approved = store.recordApproval({ id: approvalId(fresh.id, at), recordId: fresh.id, decision: "accept", note: "reviewed the route", actor: "selftest", at });
		check("accepting a replay-verified candidate activates it and records the operator evidence", approved.status === "active" && approved.gates.human === "approved" && approved.lineage.approvals.length === 1 && store.approvals(fresh.id).length === 1 && store.get(fresh.id)?.status === "active");
		const rejected = store.recordApproval({ id: approvalId(unreplayedStored.id, at), recordId: unreplayedStored.id, decision: "reject", note: "wrong estimand", actor: "selftest", at });
		check("rejecting retires the record for audit", rejected.status === "retired" && rejected.gates.human === "rejected");
		let duplicateRefused = false;
		try { store.recordApproval({ id: approvalId(fresh.id, at), recordId: fresh.id, decision: "accept", note: "", actor: "selftest", at }); } catch { duplicateRefused = true; }
		check("the same approval id cannot be recorded twice", duplicateRefused);
		check("index reflects statuses after approvals", store.index()?.byStatus.active === 1 && store.index()?.byStatus.retired === 1 && store.index()?.pendingHuman.length === 0);

		console.log("== harvest (extract → gate → store) ==");
		const harvestStore = new ExperienceStore(mkdtempSync(join(tmpdir(), "georsi-xp-harvest-")));
		const summary = harvestRunExperience(demoDir, harvestStore);
		check("harvest writes experience.json beside the package and stores the (retired) fixture record", existsSync(join(demoDir, "experience.json")) && summary.runRecord !== null && summary.added.length === 1 && summary.statuses[summary.runRecord!] === "retired");
		const again = harvestRunExperience(demoDir, harvestStore);
		check("harvesting the same run twice is idempotent", again.added.length === 0 && again.skipped.length === 1);
		console.log(`experience selftest passed (${passed} checks)`);
	} finally {
		rmSync(demoDir, { recursive: true, force: true });
		rmSync(storeRoot, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
