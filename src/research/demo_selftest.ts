import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { ROOT } from "../config.js";
import { runDeterministicResearchDemo } from "./demo.js";

const runDir = join(ROOT, "runs", ".research-demo-selftest");
const evidenceDir = join(tmpdir(), "GeoRSI", "evidence", ".research-demo-selftest");
rmSync(runDir, { recursive: true, force: true });
rmSync(evidenceDir, { recursive: true, force: true });
try {
	const result = await runDeterministicResearchDemo(runDir);
	const required = ["mission.json", "plan.json", "events.jsonl", "claims.json", "evidence-index.json", "environment.json", "runtime-attestation.json", "research-manifest.json", "replay.json", "research-score.json", "package-seal.json", "report.md", "presentation.md", "defense.json"];
	const missing = required.filter((name) => !existsSync(join(runDir, name)));
	const replay = JSON.parse(readFileSync(join(runDir, "replay.json"), "utf8")) as { passed?: boolean; computeReplay?: { passed?: boolean; backend?: string } };
	if (missing.length || result.competitionScore.eligible || !result.competitionScore.reasons.some((reason) => reason.includes("runtime attestation")) || !result.replay.passed || replay.computeReplay?.passed !== true || replay.computeReplay.backend !== "deterministic-test-double") {
		throw new Error(`research demo failed: missing=${missing.join(",")} eligible=${result.competitionScore.eligible} replay=${result.replay.passed}/${replay.computeReplay?.passed}`);
	}
	console.log(`RESEARCH_DEMO_OK nodes=${result.graph.nodes.length} evidence=${result.evidence.length} competitionEligible=${result.competitionScore.eligible}`);
	const verdictOutput = execFileSync("python", ["scripts/research_verdict.py", runDir], { cwd: ROOT, encoding: "utf8" });
	if (!verdictOutput.includes("RESEARCH_VERDICT_OK")) throw new Error("independent research verdict did not pass");
	const scorePath = join(runDir, "research-score.json");
	const originalScore = readFileSync(scorePath, "utf8");
	const tamperedScore = JSON.parse(originalScore) as { eligible?: boolean };
	tamperedScore.eligible = true;
	writeFileSync(scorePath, JSON.stringify(tamperedScore));
	const tamperedVerdict = spawnSync("python", ["scripts/research_verdict.py", runDir], { cwd: ROOT, encoding: "utf8" });
	if (tamperedVerdict.status === 0) throw new Error("independent verdict accepted a modified score file");
	writeFileSync(scorePath, originalScore);
} finally {
	rmSync(runDir, { recursive: true, force: true });
	rmSync(evidenceDir, { recursive: true, force: true });
}

for (const failAt of ["synthesis", "compute-replay"] as const) {
	const failureRun = join(ROOT, "runs", `.research-demo-${failAt}-failure`);
	const failureEvidence = join(tmpdir(), "GeoRSI", "evidence", `.research-demo-${failAt}-failure`);
	rmSync(failureRun, { recursive: true, force: true });
	rmSync(failureEvidence, { recursive: true, force: true });
	let rejected = false;
	try { await runDeterministicResearchDemo(failureRun, { failAt }); }
	catch { rejected = true; }
	const events = existsSync(join(failureRun, "events.jsonl")) ? readFileSync(join(failureRun, "events.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { type?: string; payload?: { phase?: string } }) : [];
	if (!rejected || events.at(-1)?.type !== "research-mission-failed" || existsSync(join(failureRun, "research-manifest.json"))) throw new Error(`research failure phase was not recorded failAt=${failAt}`);
	rmSync(failureRun, { recursive: true, force: true });
	rmSync(failureEvidence, { recursive: true, force: true });
}
console.log("RESEARCH_FAILURE_PATHS_OK");
