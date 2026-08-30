/** Host Python execution adapter and source-policy preflight. */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Config } from "../config.js";
import { scanPythonExecutionPolicy } from "../guard.js";
import { terminateProcessTree } from "../process.js";
import { sanitizeExecutionEnvironment } from "../process-env.js";

export interface ExecutionPolicyResult {
	blocked: boolean;
	notice: string;
}

/** Run Python explicitly on the host. Callers must label this as host-audit,
 * never as an OS sandbox or strict fallback. */
export function runPythonHost(cwd: string, pythonCmd: string, file: string, timeoutMs: number): Promise<string> {
	return new Promise((resolve) => {
		const child = spawn(pythonCmd, [file], {
			cwd,
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
		}, timeoutMs);
		child.stdout.on("data", (data: Buffer) => (out += data.toString("utf8")));
		child.stderr.on("data", (data: Buffer) => (err += data.toString("utf8")));
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve(`failed to start python: ${error.message}`);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			const head = timedOut ? "[execution timed out]\n" : "";
			let message = `${head}exit=${code}\nstdout (tail):\n${out.slice(-3000)}`;
			if (err) message += `\nstderr (tail):\n${err.slice(-1500)}`;
			resolve(message);
		});
	});
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
