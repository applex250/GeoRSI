/** Deterministic tests for the explicit host-audit compute port and its honesty gates. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DirectHostComputePort } from "./direct-compute.js";
import { attestComputeReplay, createSandboxiePythonResearchTool, validateComputeReceipt, validateHostComputeReceipt, validateSandboxieComputeReceipt, type ComputeRunReceipt } from "./sandboxie-compute.js";
import { validateRuntimeAttestation, type ComputeReplayAttestation, type ResearchRuntimeAttestation } from "./runtime-attestation.js";
import type { ResearchMission } from "./contracts.js";

let passed = 0;
function check(label: string, condition: unknown): void {
	if (!condition) throw new Error(`FAIL: ${label}`);
	passed += 1;
	console.log(`  ok   ${label}`);
}

const mission: ResearchMission = {
	id: "host-audit-selftest",
	title: "host-audit selftest",
	objective: "verify honesty gates",
	createdUtc: "2026-01-01T00:00:00Z",
	taskProfile: {
		family: "quantitative",
		requiredStages: ["quantitative-analysis"],
		capabilities: ["python"],
		verifierProfile: "quantitative-v1",
		deliverableSchema: "georsi-quantitative-research-v1",
		sourceRequirements: [],
		networkMode: "open",
	},
	sourcePolicy: { requireContraryEvidence: false },
} as unknown as ResearchMission;

function baseAttestation(runMode: ResearchRuntimeAttestation["runMode"], isolationBackend: ResearchRuntimeAttestation["isolationBackend"]): ResearchRuntimeAttestation {
	return {
		version: 1,
		runMode,
		unitTestsPassed: true,
		guardViolations: [],
		cleanupPassed: true,
		isolationBackend,
		modelCalls: [],
		familyVerifications: [],
		contraryEvidenceLinks: [],
		totalTokens: 0,
		wallSeconds: 1,
	};
}

async function main(): Promise<void> {
	console.log("== direct host-audit compute ==");
	const root = mkdtempSync(join(tmpdir(), "georsi-direct-compute-"));
	try {
		const repoRoot = join(root, "repo");
		const workspace = join(root, "exchange");
		const port = new DirectHostComputePort({ pythonCmd: "python", workspace, repoRoot, privateRoot: join(root, "private") });
		const request = {
			missionId: mission.id,
			nodeId: "01-quant",
			purpose: "selftest computation",
			script: "import json\nopen('result.json','w').write(json.dumps({'answer': 41 + 1}))\nprint('done')",
			timeoutMs: 60_000,
			networkMode: "open" as const,
			resultFile: "result.json",
		};
		const receipt = await port.run(request);
		check("backend is host-audit", receipt.backend === "host-audit");
		check("no box name claimed", receipt.boxName === "");
		check("network isolation honestly false", receipt.networkIsolationEnforced === false);
		check("process pid captured", receipt.processOwnershipVerified && receipt.targetPids.length === 1);
		check("exit code zero", receipt.exitCode === 0 && !receipt.timedOut);
		check("stdout captured", receipt.stdout.includes("done"));
		check("result file read", receipt.result?.trim() === '{"answer": 42}');
		check("host validator accepts", validateHostComputeReceipt(receipt, "open").length === 0);
		check("dispatch validator accepts", validateComputeReceipt(receipt, "open").length === 0);
		check("sandboxie validator rejects host receipt", validateSandboxieComputeReceipt(receipt, "open").some((issue) => issue.includes("did not use Sandboxie")));

		const replay = await attestComputeReplay(port, [receipt], "open");
		check("replay passes for deterministic script", replay.passed && replay.backend === "host-audit" && replay.processOwnershipVerified);

		const mutated: ComputeRunReceipt = { ...receipt, stdout: `${receipt.stdout}tampered` };
		const replayTampered = await attestComputeReplay(port, [mutated], "open");
		check("replay fails on tampered receipt", !replayTampered.passed);

		// Honesty gates: host-audit can never satisfy competition runtime validation.
		const hostCompute: ComputeReplayAttestation = { passed: true, backend: "host-audit", processOwnershipVerified: true };
		const hostDev = baseAttestation("host-development", "host-audit");
		const devIssues = validateRuntimeAttestation(hostDev, hostCompute, mission, [], []);
		check("host-development keeps other gates green", devIssues.every((issue) => !issue.includes("cleanup") && !issue.includes("token")));
		check("host-development is flagged not competition-eligible", devIssues.some((issue) => issue.includes("not competition-eligible")));

		const fakeCompetition = baseAttestation("competition", "host-audit");
		const competitionIssues = validateRuntimeAttestation(fakeCompetition, hostCompute, mission, [], []);
		check("competition with host-audit backend is rejected", competitionIssues.some((issue) => issue.includes("Sandboxie app-level isolation")));

		const mismatchedDev = baseAttestation("host-development", "sandboxie-app-level");
		const mismatchIssues = validateRuntimeAttestation(mismatchedDev, hostCompute, mission, [], []);
		check("mismatched host-development attestation rejected", mismatchIssues.some((issue) => issue.includes("must attest host-audit isolation")));

		// Tool surface honesty: host mode uses the python-host tool id.
		const tool = createSandboxiePythonResearchTool({ port, evidenceStore: { verify: () => true, putText: () => ({ id: "e", sha256: "a".repeat(64), kind: "tool-output", logicalName: "x", producerNodeId: "n", mediaType: "text/plain", createdUtc: "" }) } as never, networkMode: "open", capability: "python", toolId: "python-host" });
		check("tool id is python-host in host mode", tool.id === "python-host");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
	console.log(`direct-compute selftest passed (${passed} checks)`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
