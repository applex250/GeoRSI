/** Explicit host-audit compute port: runs Python directly on the host with NO sandbox isolation.
 * Every receipt honestly records backend="host-audit" and networkIsolationEnforced=false; such runs
 * are never competition-eligible. This is the development default while Sandboxie hardening is
 * deferred to a later iteration; the Sandboxie path remains fully available via
 * execution_backend="sandboxie". */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, openSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";
import { sanitizeExecutionEnvironment } from "../process-env.js";
import { assertExchangeWorkspace, readWorkspaceFileStrict } from "../workspace-tools.js";
import type { SandboxieCleanupResult } from "../sandboxie-cleanup.js";
import type { ComputeReplayAttestation } from "./runtime-attestation.js";
import { scanFigureFiles, validateHostComputeReceipt, type SandboxieComputeRequest, type ComputeRunReceipt, type SandboxieResearchComputePort } from "./sandboxie-compute.js";

const MAX_CAPTURE_BYTES = 2_000_000;

/** No box exists in host-audit mode; cleanup fields are structural no-ops recorded honestly. */
function hostCleanupResult(): SandboxieCleanupResult {
	return { terminated: false, deletedData: false, removedConfig: false, reloaded: false, boxStillEnabled: false, globalWfpRestored: false, leaseReleased: false, errors: [] };
}

function safeResultFile(value: string): string {
	if (!value || value.includes("..") || value.includes("/") || value.includes("\\") || value.startsWith(".")) throw new Error(`host-audit compute resultFile must be one safe basename: ${value}`);
	return value;
}

/** Runs one host Python process per compute call inside the bounded exchange workspace. */
export class DirectHostComputePort implements SandboxieResearchComputePort {
	private counter = 0;
	private readonly requests = new Map<string, SandboxieComputeRequest>();

	constructor(private readonly options: { pythonCmd: string; workspace: string; repoRoot: string; privateRoot: string; log?: (message: string) => void }) {
		assertExchangeWorkspace(options.workspace, options.repoRoot, options.privateRoot, []);
		mkdirSync(options.workspace, { recursive: true });
	}

	/** Persisted-compute requests for WorkGraph resume (#83): replay after a resume must
	 * be able to re-run scripts recorded by EARLIER process sessions, so the checkpoint
	 * exports this map and the resumed port re-primes it. Abort signals are stripped. */
	exportRequests(): { id: string; request: SandboxieComputeRequest }[] {
		return [...this.requests.entries()].map(([id, request]) => ({ id, request: { ...request, signal: undefined } }));
	}

	primeRequests(entries: readonly { id: string; request: SandboxieComputeRequest }[]): void {
		for (const { id, request } of entries) this.requests.set(id, { ...request, signal: undefined });
	}

	async run(request: SandboxieComputeRequest): Promise<ComputeRunReceipt> {
		if (request.signal?.aborted) throw new Error(`host-audit compute ${request.nodeId} aborted before launch`);
		const id = `${request.nodeId}-${++this.counter}-${randomId()}`;
		this.requests.set(id, { ...request });
		const cwd = join(this.options.workspace, "compute", id);
		mkdirSync(cwd, { recursive: true });
		const scriptPath = join(cwd, "main.py");
		const stdoutPath = join(cwd, "stdout.log");
		const stderrPath = join(cwd, "stderr.log");
		writeFileSync(scriptPath, request.script, { encoding: "utf8", flag: "wx", mode: 0o600 });
		const started = Date.now();
		let exitCode: number | null = null;
		let timedOut = false;
		let runError: unknown;
		let stdout = "";
		let stderr = "";
		let targetPids: number[] = [];
		const child = spawn(this.options.pythonCmd, [scriptPath], {
			cwd,
			env: sanitizeExecutionEnvironment(),
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		if (child.pid) targetPids = [child.pid];
		const killTree = (): void => {
			if (!child.pid) return;
			if (process.platform === "win32") {
				// Tree-kill so python-spawned children (GDAL helpers, etc.) cannot outlive the request.
				const result = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
				if (result.status !== 0) try { child.kill(); } catch { /* best effort */ }
			} else {
				try { child.kill("SIGKILL"); } catch { /* best effort */ }
			}
		};
		const onAbort = (): void => killTree();
		request.signal?.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(() => {
			timedOut = true;
			killTree();
		}, Math.max(1, request.timeoutMs));
		const drain = (stream: NodeJS.ReadableStream | null, sink: (chunk: string) => void, file: string): Promise<void> =>
			new Promise((resolveDrain) => {
				if (!stream) {
					resolveDrain();
					return;
				}
				let handle: number | null = null;
				try { handle = openSync(file, "w"); } catch { handle = null; }
				let total = 0;
				stream.on("data", (chunk: Buffer) => {
					total += chunk.length;
					if (handle !== null) {
						try { writeSync(handle, chunk); } catch { /* log file best effort */ }
					}
					if (total <= MAX_CAPTURE_BYTES) sink(chunk.toString("utf8"));
				});
				stream.on("end", () => {
					if (handle !== null) try { closeSync(handle); } catch { /* ignore */ }
					resolveDrain();
				});
				stream.on("error", () => {
					if (handle !== null) try { closeSync(handle); } catch { /* ignore */ }
					resolveDrain();
				});
			});
		try {
			const stdoutDone = drain(child.stdout, (chunk) => { stdout += chunk; }, stdoutPath);
			const stderrDone = drain(child.stderr, (chunk) => { stderr += chunk; }, stderrPath);
			const closed = new Promise<void>((resolveClosed) => child.once("close", (code) => { exitCode = code; resolveClosed(); }));
			await Promise.all([stdoutDone, stderrDone, closed]);
		} catch (error) {
			runError = error;
			killTree();
		} finally {
			clearTimeout(timer);
			request.signal?.removeEventListener("abort", onAbort);
		}
		if (request.signal?.aborted) runError = runError ?? new Error("host-audit compute aborted by signal");
		let resultText: string | undefined;
		let figureFiles: { filename: string; sha256: string; base64: string }[] | undefined;
		if (!runError) {
			try { figureFiles = scanFigureFiles(cwd, this.options.log); } catch { /* figures are best-effort */ }
		}
		if (!runError && request.resultFile) {
			try {
				resultText = readWorkspaceFileStrict(cwd, join(cwd, safeResultFile(request.resultFile)), 50_000_000).toString("utf8");
			} catch (error) { runError = error; }
		}
		const receipt: ComputeRunReceipt = {
			version: 1,
			id,
			backend: "host-audit",
			boxName: "",
			networkMode: request.networkMode,
			networkIsolationEnforced: false,
			processOwnershipVerified: targetPids.length > 0,
			targetPids,
			exitCode,
			timedOut,
			stdout,
			stderr: runError ? `${stderr}\n${String(runError)}`.trim() : stderr,
			generatedEvidence: [],
			cleanup: hostCleanupResult(),
			error: runError ? String(runError).slice(0, 500) : undefined,
			result: resultText,
			resultFile: request.resultFile,
			scriptSha256: createHash("sha256").update(request.script).digest("hex"),
			figureFiles,
		};
		this.options.log?.(`[research] host-audit compute ${id}: exit=${receipt.exitCode} wall=${Date.now() - started}ms`);
		return receipt;
	}

	async replay(receipts: readonly ComputeRunReceipt[], signal?: AbortSignal): Promise<ComputeReplayAttestation> {
		if (receipts.length === 0 || receipts.some((receipt) => validateHostComputeReceipt(receipt, receipt.networkMode).length > 0)) {
			return { passed: false, backend: "host-audit", processOwnershipVerified: false, detail: "recorded receipts failed host validation" };
		}
		for (const original of receipts) {
			if (signal?.aborted) return { passed: false, backend: "host-audit", processOwnershipVerified: false };
			const request = this.requests.get(original.id);
			if (!request || createHash("sha256").update(request.script).digest("hex") !== original.scriptSha256) return { passed: false, backend: "host-audit", processOwnershipVerified: false, detail: `${original.id}: recorded script hash not found` };
			const replayed = await this.run({ ...request, signal });
			const invalid = validateHostComputeReceipt(replayed, request.networkMode);
			if (invalid.length > 0) return { passed: false, backend: "host-audit", processOwnershipVerified: false, detail: `${original.id}: replayed receipt invalid (${invalid[0]})` };
			const mismatches: string[] = [];
			if (replayed.exitCode !== original.exitCode) mismatches.push(`exit ${original.exitCode} -> ${replayed.exitCode}`);
			if (replayed.timedOut !== original.timedOut) mismatches.push("timeout flag");
			if (replayed.stdout !== original.stdout) mismatches.push("stdout");
			if (replayed.stderr !== original.stderr) mismatches.push("stderr");
			if (replayed.result !== original.result) mismatches.push("result file");
			if (mismatches.length > 0) return { passed: false, backend: "host-audit", processOwnershipVerified: false, detail: `${original.id} mismatched: ${mismatches.join(", ")}` };
		}
		return { passed: true, backend: "host-audit", processOwnershipVerified: receipts.every((receipt) => receipt.processOwnershipVerified) };
	}
}

function randomId(): string {
	return createHash("sha256").update(`${process.pid}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 8);
}
