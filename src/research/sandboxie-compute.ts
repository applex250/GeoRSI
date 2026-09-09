/** Fail-closed scientific-compute tool contract; concrete ports must use Sandboxie and never host fallback. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { assertExchangeWorkspace } from "../workspace-tools.js";
import { assertSandboxPythonCommand, makeSandboxieBoxName, type SandboxieAdapter, type SandboxieBoxRecord } from "../sandboxie.js";
import type { SandboxieCleanupResult } from "../sandboxie-cleanup.js";
import type { ComputeReplayAttestation } from "./runtime-attestation.js";
import type { ContentAddressedEvidenceStore } from "./evidence-store.js";
import type { EvidenceRef } from "./contracts.js";
import type { ScientificTool } from "./tool-registry.js";
import { sanitizeResearchEvidence } from "./event-ledger.js";
import type { NetworkFetchPort, NetworkFetchRequest, NetworkFetchResponse } from "./network-tools.js";

export interface SandboxieComputeRequest {
	missionId: string;
	nodeId: string;
	purpose: string;
	script: string;
	/** Optional fixed relative result file written in the exchange workspace. */
	resultFile?: string;
	timeoutMs: number;
	networkMode: "blocked" | "open";
}

export interface SandboxieComputeRunReceipt {
	version: 1;
	id: string;
	backend: "sandboxie-app-level";
	boxName: string;
	networkMode: "blocked" | "open";
	processOwnershipVerified: boolean;
	targetPids: number[];
	exitCode: number | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	generatedEvidence: EvidenceRef[];
	cleanup: SandboxieCleanupResult;
	error?: string;
	/** Bounded exchange-file output for structured/binary-safe tool results. */
	result?: string;
	resultFile?: string;
	scriptSha256: string;
}

export interface SandboxieResearchComputePort {
	run(request: SandboxieComputeRequest): Promise<SandboxieComputeRunReceipt>;
	replay(receipts: readonly SandboxieComputeRunReceipt[]): Promise<ComputeReplayAttestation>;
}

export interface SandboxiePythonComputePortOptions {
	adapter: SandboxieAdapter;
	pythonCmd: string;
	workspace: string;
	repoRoot: string;
	privateRoot: string;
	additionalProtectedRoots?: readonly string[];
	networkMode: "blocked" | "open";
	log?: (message: string) => void;
}

function safeResultFile(value: string): string {
	if (!value || value.includes("..") || value.includes("/") || value.includes("\\") || value.startsWith(".")) throw new Error(`Sandboxie compute resultFile must be one safe basename: ${value}`);
	return value;
}

function incompleteCleanup(error: unknown): SandboxieCleanupResult {
	return { terminated: false, deletedData: false, removedConfig: false, reloaded: false, boxStillEnabled: true, globalWfpRestored: false, leaseReleased: false, errors: [error instanceof Error ? error.message : String(error)] };
}

/** Uses one short-lived, independently prepared Sandboxie box per compute call. */
export class SandboxiePythonComputePort implements SandboxieResearchComputePort {
	private counter = 0;
	private readonly requests = new Map<string, SandboxieComputeRequest>();
	constructor(private readonly options: SandboxiePythonComputePortOptions) {
		assertExchangeWorkspace(options.workspace, options.repoRoot, options.privateRoot, options.additionalProtectedRoots ?? []);
		assertSandboxPythonCommand(options.pythonCmd, [options.repoRoot, options.privateRoot, ...(options.additionalProtectedRoots ?? [])]);
		mkdirSync(options.workspace, { recursive: true });
	}

	async run(request: SandboxieComputeRequest): Promise<SandboxieComputeRunReceipt> {
		if (request.networkMode !== this.options.networkMode) throw new Error(`Sandboxie compute request network mode ${request.networkMode} does not match configured mode ${this.options.networkMode}`);
		const id = `${request.nodeId}-${++this.counter}-${randomUUID().slice(0, 8)}`;
		this.requests.set(id, { ...request });
		const cwd = join(this.options.workspace, "compute", id);
		mkdirSync(cwd, { recursive: true });
		const scriptPath = join(cwd, "main.py");
		const stdoutPath = join(cwd, "stdout.log");
		const stderrPath = join(cwd, "stderr.log");
		writeFileSync(scriptPath, request.script, { encoding: "utf8", flag: "wx", mode: 0o600 });
		const generatedBoxName = makeSandboxieBoxName(`research-${request.nodeId}-${this.counter}`);
		let record: SandboxieBoxRecord | undefined;
		let run: Awaited<ReturnType<SandboxieAdapter["runPython"]>> | undefined;
		let runError: unknown;
		let resultText: string | undefined;
		let cleanup: SandboxieCleanupResult;
		try {
			record = await this.options.adapter.prepareBox({ name: generatedBoxName, exchangeWorkspace: cwd, repoRoot: this.options.repoRoot, privateRoot: this.options.privateRoot, additionalProtectedRoots: this.options.additionalProtectedRoots, networkMode: request.networkMode });
			try { run = await this.options.adapter.runPython({ boxName: record.name, pythonCmd: this.options.pythonCmd, scriptPath, cwd, stdoutPath, stderrPath, timeoutMs: request.timeoutMs }); }
			catch (error) { runError = error; }
			if (!runError && request.resultFile) {
				try {
					const content = readFileSync(join(cwd, safeResultFile(request.resultFile)));
					if (content.byteLength > 50_000_000) throw new Error("Sandboxie compute result file exceeded 50MB");
					resultText = content.toString("utf8");
				} catch (error) { runError = error; }
			}
			cleanup = await this.options.adapter.cleanupBox(record);
		} catch (error) {
			runError = runError ?? error;
			cleanup = record ? incompleteCleanup(error) : incompleteCleanup(error);
		}
		const receipt: SandboxieComputeRunReceipt = {
			version: 1, id, backend: "sandboxie-app-level", boxName: record?.name ?? generatedBoxName, networkMode: request.networkMode,
			processOwnershipVerified: !!run && run.targetPids.length > 0, targetPids: run?.targetPids ?? [], exitCode: run?.exitCode ?? null, timedOut: run?.timedOut ?? false,
			stdout: run?.stdout ?? "", stderr: run?.stderr ?? (runError ? String(runError) : ""), generatedEvidence: [], cleanup, error: runError ? String(runError).slice(0, 500) : undefined,
			result: resultText,
			resultFile: request.resultFile,
			scriptSha256: createHash("sha256").update(request.script).digest("hex"),
		};
		this.options.log?.(`[research] Sandboxie compute ${id}: exit=${receipt.exitCode} cleanup=${cleanup.errors.length === 0 ? "ok" : "failed"}`);
		return receipt;
	}

	async replay(receipts: readonly SandboxieComputeRunReceipt[]): Promise<ComputeReplayAttestation> {
		if (receipts.length === 0 || receipts.some((receipt) => validateSandboxieComputeReceipt(receipt, this.options.networkMode).length > 0)) return { passed: false, backend: "sandboxie-app-level", processOwnershipVerified: false };
		for (const original of receipts) {
			const request = this.requests.get(original.id);
			if (!request || createHash("sha256").update(request.script).digest("hex") !== original.scriptSha256) return { passed: false, backend: "sandboxie-app-level", processOwnershipVerified: false };
			const replayed = await this.run(request);
			if (validateSandboxieComputeReceipt(replayed, request.networkMode).length > 0 || replayed.exitCode !== original.exitCode || replayed.timedOut !== original.timedOut || replayed.stdout !== original.stdout || replayed.stderr !== original.stderr || replayed.result !== original.result) return { passed: false, backend: "sandboxie-app-level", processOwnershipVerified: false };
		}
		return { passed: true, backend: "sandboxie-app-level", processOwnershipVerified: receipts.every((receipt) => receipt.processOwnershipVerified) };
	}
}

/** Network adapter that performs the HTTP request inside a fresh Sandboxie box. */
export class SandboxieNetworkFetchPort implements NetworkFetchPort {
	constructor(private readonly compute: SandboxieResearchComputePort, private readonly missionId: string, private readonly networkMode: "blocked" | "open", private readonly onReceipt?: (receipt: SandboxieComputeRunReceipt) => void) {}

	async fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse> {
		if (!/^https?:$/i.test(new URL(request.url).protocol)) throw new Error("Sandboxie network fetch only permits HTTP(S)");
		const script = [
			"import base64, json, urllib.request",
			`url = ${JSON.stringify(request.url)}`,
			`method = ${JSON.stringify(request.method)}`,
			`limit = ${Math.floor(request.maxBytes)}`,
			`req = urllib.request.Request(url, method=method, headers={"User-Agent": "GeoRSI/1.0"})`,
			`with urllib.request.urlopen(req, timeout=${Math.max(1, request.timeoutMs) / 1000}) as response:`,
			"    body = response.read(limit + 1)",
			"    payload = {\"status\": response.status, \"final_url\": response.geturl(), \"headers\": {str(k).lower(): str(v) for k, v in response.headers.items()}, \"too_large\": len(body) > limit, \"body_b64\": base64.b64encode(body[:limit]).decode(\"ascii\")}",
			"    open(\"result.json\", \"w\", encoding=\"utf-8\").write(json.dumps(payload, separators=(\",\", \":\")))",
		].join("\n");
		const receipt = await this.compute.run({ missionId: this.missionId, nodeId: "network-fetch", purpose: `HTTP ${request.method} ${request.url}`, script, resultFile: "result.json", timeoutMs: request.timeoutMs, networkMode: this.networkMode });
		this.onReceipt?.(receipt);
		const line = receipt.result;
		if (!line) throw new Error(`Sandboxie network fetch produced no response payload (exit=${receipt.exitCode})`);
		const payload = JSON.parse(line) as { status: number; final_url: string; headers: Record<string, string>; too_large: boolean; body_b64: string };
		if (payload.too_large) throw new Error(`Sandboxie network fetch exceeded maxBytes=${request.maxBytes}`);
		const body = request.method === "HEAD" ? Buffer.alloc(0) : Buffer.from(payload.body_b64, "base64");
		return { finalUrl: payload.final_url, status: payload.status, headers: payload.headers, body, retrievedAt: new Date().toISOString() };
	}
}

export function sandboxieCleanupComplete(cleanup: SandboxieCleanupResult): boolean {
	return cleanup.terminated && cleanup.deletedData && cleanup.removedConfig && cleanup.reloaded && !cleanup.boxStillEnabled && cleanup.globalWfpRestored && cleanup.leaseReleased && cleanup.errors.length === 0;
}

export function validateSandboxieComputeReceipt(receipt: SandboxieComputeRunReceipt, expectedNetworkMode: "blocked" | "open"): string[] {
	const issues: string[] = [];
	if (receipt.version !== 1) issues.push("Sandboxie compute receipt version must be 1");
	if (receipt.backend !== "sandboxie-app-level") issues.push("scientific compute did not use Sandboxie app-level isolation");
	if (receipt.networkMode !== expectedNetworkMode) issues.push("Sandboxie compute network mode mismatch");
	if (!receipt.processOwnershipVerified || receipt.targetPids.length === 0 || receipt.targetPids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) issues.push("Sandboxie compute process ownership was not verified");
	if (receipt.exitCode !== 0 || receipt.timedOut) issues.push(`Sandboxie compute failed: exit=${receipt.exitCode} timeout=${receipt.timedOut}`);
	if (!sandboxieCleanupComplete(receipt.cleanup)) issues.push("Sandboxie compute cleanup is incomplete");
	if (receipt.error) issues.push(`Sandboxie compute reported an error: ${receipt.error}`);
	if (receipt.resultFile && typeof receipt.result !== "string") issues.push("Sandboxie compute result file is missing");
	if (!receipt.id.trim() || !receipt.boxName.trim()) issues.push("Sandboxie compute receipt identity is missing");
	if (!/^[a-f0-9]{64}$/i.test(receipt.scriptSha256)) issues.push("Sandboxie compute script hash is invalid");
	return issues;
}

export function createSandboxiePythonResearchTool(input: {
	port: SandboxieResearchComputePort;
	evidenceStore: ContentAddressedEvidenceStore;
	networkMode: "blocked" | "open";
	capability?: string;
	onRunReceipt?: (receipt: SandboxieComputeRunReceipt) => void;
}): ScientificTool<{ purpose: string; script: string; timeoutMs?: number }, { receiptId: string; backend: string; boxName: string; exitCode: number; stdoutTail: string; stderrTail: string; evidenceIds: string[] }> {
	return {
		id: "sandboxie-python",
		version: "1",
		capability: input.capability ?? "sandboxie-python",
		validate: (value) => {
			const request = value as { purpose?: unknown; script?: unknown; timeoutMs?: unknown };
			const issues: string[] = [];
			if (typeof request.purpose !== "string" || !request.purpose.trim() || request.purpose.length > 500) issues.push("purpose must be 1..500 characters");
			if (typeof request.script !== "string" || !request.script.trim() || request.script.length > 250_000) issues.push("script must be 1..250000 characters");
			if (request.timeoutMs !== undefined && (!Number.isSafeInteger(request.timeoutMs) || Number(request.timeoutMs) <= 0 || Number(request.timeoutMs) > 900_000)) issues.push("timeoutMs must be within 1..900000");
			return issues;
		},
		execute: async (context, request) => {
			const timeoutMs = Math.min(request.timeoutMs ?? 120_000, context.remainingWallMs);
			const receipt = await input.port.run({ missionId: context.missionId, nodeId: context.nodeId, purpose: request.purpose, script: request.script, timeoutMs, networkMode: input.networkMode });
			input.onRunReceipt?.(receipt);
			const issues = validateSandboxieComputeReceipt(receipt, input.networkMode);
			if (issues.length > 0) throw new Error(issues.join("; "));
			for (const reference of receipt.generatedEvidence) if (!input.evidenceStore.verify(reference)) throw new Error(`Sandboxie compute produced unverifiable evidence: ${reference.id}`);
			const scriptEvidence = input.evidenceStore.putText(request.script, { kind: "script", logicalName: `${context.nodeId}-sandboxie.py`, producerNodeId: context.nodeId, mediaType: "text/x-python" });
			const stdoutEvidence = input.evidenceStore.putText(String(sanitizeResearchEvidence(receipt.stdout)), { kind: "tool-output", logicalName: `${context.nodeId}-stdout.txt`, producerNodeId: context.nodeId, mediaType: "text/plain" });
			const evidenceRefs = [scriptEvidence, stdoutEvidence, ...receipt.generatedEvidence];
			if (receipt.stderr) evidenceRefs.push(input.evidenceStore.putText(String(sanitizeResearchEvidence(receipt.stderr)), { kind: "tool-output", logicalName: `${context.nodeId}-stderr.txt`, producerNodeId: context.nodeId, mediaType: "text/plain" }));
			return {
				output: {
					receiptId: receipt.id,
					backend: receipt.backend,
					boxName: receipt.boxName,
					exitCode: receipt.exitCode!,
					stdoutTail: String(sanitizeResearchEvidence(receipt.stdout)).slice(-4000),
					stderrTail: String(sanitizeResearchEvidence(receipt.stderr)).slice(-2000),
					evidenceIds: evidenceRefs.map((reference) => reference.id),
				},
				artifactIds: evidenceRefs.map((reference) => reference.id),
				evidenceRefs,
				exitCode: receipt.exitCode,
			};
		},
	};
}

export async function attestSandboxieComputeReplay(port: SandboxieResearchComputePort, receipts: readonly SandboxieComputeRunReceipt[], expectedNetworkMode?: "blocked" | "open"): Promise<ComputeReplayAttestation> {
	const expected = expectedNetworkMode ?? receipts[0]?.networkMode;
	if (!expected || receipts.length === 0 || receipts.some((receipt) => validateSandboxieComputeReceipt(receipt, expected).length > 0)) {
		return { passed: false, backend: "sandboxie-app-level", processOwnershipVerified: false };
	}
	const attestation = await port.replay(receipts);
	return attestation.backend === "sandboxie-app-level" && attestation.processOwnershipVerified
		? attestation
		: { passed: false, backend: "sandboxie-app-level", processOwnershipVerified: false };
}
