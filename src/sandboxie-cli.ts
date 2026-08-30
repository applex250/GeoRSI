/** Low-level process adapter for Sandboxie CLI commands. */
import { spawn, spawnSync } from "node:child_process";

export interface SandboxieCommandResult {
	code: number | null;
	stdout: string;
	stderr: string;
	error?: string;
}

export function formatSandboxieCommand(file: string, args: readonly string[]): string {
	return [file, ...args].map((part) => (/\s|"/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

export class SandboxieCli {
	constructor(private readonly defaultTimeoutMs = 20_000) {}

	async run(file: string, args: readonly string[], timeoutMs = this.defaultTimeoutMs): Promise<SandboxieCommandResult> {
		return new Promise((resolveResult) => {
			let stdout = "";
			let stderr = "";
			let settled = false;
			const child = spawn(file, [...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
			const finish = (result: SandboxieCommandResult): void => {
				if (settled) return;
				settled = true;
				resolveResult(result);
			};
			const timer = setTimeout(() => {
				try { child.kill(); } catch { /* already exited */ }
				finish({ code: null, stdout, stderr, error: `command timeout after ${timeoutMs}ms` });
			}, timeoutMs);
			child.stdout?.on("data", (data: Buffer) => (stdout += data.toString("utf8")));
			child.stderr?.on("data", (data: Buffer) => (stderr += data.toString("utf8")));
			child.on("error", (error) => {
				clearTimeout(timer);
				finish({ code: null, stdout, stderr, error: error.message });
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				finish({ code, stdout, stderr });
			});
		});
	}

	runSync(file: string, args: readonly string[], timeoutMs = this.defaultTimeoutMs): SandboxieCommandResult {
		const result = spawnSync(file, [...args], {
			windowsHide: true,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: timeoutMs,
		});
		return {
			code: result.status,
			stdout: typeof result.stdout === "string" ? result.stdout : "",
			stderr: typeof result.stderr === "string" ? result.stderr : "",
			error: result.error?.message,
		};
	}
}
