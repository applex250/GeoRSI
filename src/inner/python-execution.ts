/** Host Python execution adapter and source-policy preflight. */
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";
import { scanPythonExecutionPolicy } from "../guard.js";
import { terminateProcessTree } from "../process.js";
import { sanitizeExecutionEnvironment } from "../process-env.js";

export interface ExecutionPolicyResult {
	blocked: boolean;
	notice: string;
}

export interface ForegroundPythonRequest {
	cwd: string;
	pythonCmd: string;
	file: string;
	timeoutMs: number;
	stdoutPath: string;
	stderrPath: string;
}

export interface ForegroundPythonResult {
	exitCode: number | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	error?: string;
	startError?: boolean;
	targetPids?: number[];
	wrapperPath?: string;
}

export interface ForegroundPythonPort {
	execute(request: ForegroundPythonRequest): Promise<ForegroundPythonResult>;
}

export interface ForegroundPythonRunnerOptions {
	workspace: string;
	pythonCmd: string;
	port: ForegroundPythonPort;
	now?: () => number;
	recordTargetPids?: (pids: readonly number[]) => void;
	removeWrapper?: (path: string) => void;
}

export function formatForegroundPythonResult(result: ForegroundPythonResult): string {
	if (result.startError) return `failed to start python: ${result.error ?? "unknown error"}`;
	const head = result.timedOut ? "[execution timed out]\n" : "";
	let message = `${head}exit=${result.exitCode}\nstdout (tail):\n${result.stdout.slice(-3000)}`;
	if (result.error) message = `error: ${result.error}\n` + message;
	if (result.stderr) message += `\nstderr (tail):\n${result.stderr.slice(-1500)}`;
	return message;
}

/** Application service for one foreground invocation. The injected port owns
 * host-vs-strict process execution; this class owns evidence paths, PID
 * recording, wrapper cleanup, and stable tool-facing formatting. */
export class ForegroundPythonRunner {
	private invocation = 0;
	private readonly now: () => number;
	private readonly recordTargetPids: (pids: readonly number[]) => void;
	private readonly removeWrapper: (path: string) => void;

	constructor(private readonly options: ForegroundPythonRunnerOptions) {
		this.now = options.now ?? (() => Date.now());
		this.recordTargetPids = options.recordTargetPids ?? (() => {});
		this.removeWrapper = options.removeWrapper ?? ((path) => rmSync(path, { force: true }));
	}

	async run(file: string, timeoutMs: number): Promise<string> {
		const runtimeDir = join(this.options.workspace, "runtime");
		mkdirSync(runtimeDir, { recursive: true });
		const id = `${String(++this.invocation).padStart(3, "0")}-${this.now().toString(36)}`;
		const result = await this.options.port.execute({
			cwd: this.options.workspace,
			pythonCmd: this.options.pythonCmd,
			file,
			timeoutMs,
			stdoutPath: join(runtimeDir, `${id}.stdout.log`),
			stderrPath: join(runtimeDir, `${id}.stderr.log`),
		});
		this.recordTargetPids(result.targetPids ?? []);
		if (result.wrapperPath) {
			try { this.removeWrapper(result.wrapperPath); }
			catch { /* exchange-only wrapper cleanup is best effort */ }
		}
		return formatForegroundPythonResult(result);
	}
}

export const hostForegroundPythonPort: ForegroundPythonPort = {
	execute(request) {
		return new Promise((resolve) => {
			const child = spawn(request.pythonCmd, [request.file], {
				cwd: request.cwd,
				windowsHide: true,
				detached: process.platform !== "win32",
				env: sanitizeExecutionEnvironment(),
			});
			let out = "";
			let err = "";
			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				terminateProcessTree(child.pid);
			}, request.timeoutMs);
			child.stdout.on("data", (data: Buffer) => (out += data.toString("utf8")));
			child.stderr.on("data", (data: Buffer) => (err += data.toString("utf8")));
			child.on("error", (error) => {
				clearTimeout(timer);
				resolve({ exitCode: null, timedOut: false, stdout: out, stderr: err, error: error.message, startError: true });
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				resolve({ exitCode: code, timedOut, stdout: out, stderr: err });
			});
		});
	},
};

/** Run Python explicitly on the host. Callers must label this as host-audit,
 * never as an OS sandbox or strict fallback. */
export async function runPythonHost(cwd: string, pythonCmd: string, file: string, timeoutMs: number): Promise<string> {
	return formatForegroundPythonResult(await hostForegroundPythonPort.execute({
		cwd,
		pythonCmd,
		file,
		timeoutMs,
		stdoutPath: "",
		stderrPath: "",
	}));
}

/** Apply the optional pre-launch policy without pretending it is a sandbox. */
export function checkPythonExecutionPolicy(file: string, label: string, mode: Config["execution_policy"]): ExecutionPolicyResult {
	let source: string;
	try {
		source = readFileSync(file, "utf8");
	} catch {
		return { blocked: false, notice: "" };
	}
	const breaches = scanPythonExecutionPolicy(source, label);
	if (breaches.length === 0) return { blocked: false, notice: "" };
	const summary = breaches
		.slice(0, 4)
		.map((breach) => `${breach.rule} at line ${breach.line}`)
		.join(", ");
	const suffix = breaches.length > 4 ? ` (+${breaches.length - 4} more)` : "";
	if (mode === "restricted") {
		return {
			blocked: true,
			notice: `restricted execution policy blocked ${label}: ${summary}${suffix}. Use data-only analysis APIs; this policy is not an OS sandbox.`,
		};
	}
	return {
		blocked: false,
		notice: `execution policy audit warning for ${label}: ${summary}${suffix}; audit mode permits the run, but this is not an OS sandbox.`,
	};
}
