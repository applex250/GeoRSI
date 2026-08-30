/** Typed SbieIni adapter built on the low-level Sandboxie CLI port. */
import { SandboxieCli, formatSandboxieCommand, type SandboxieCommandResult } from "./sandboxie-cli.js";

function outputLines(text: string): string[] {
	return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export class SandboxieIni {
	constructor(private readonly cli: SandboxieCli, readonly path: string) {}

	async run(args: readonly string[]): Promise<SandboxieCommandResult> {
		const result = await this.cli.run(this.path, args);
		if (result.code !== 0) {
			throw new Error(
				`SbieIni failed (${result.code ?? "no code"}): ${formatSandboxieCommand(this.path, args)}` +
					`${result.error ? ` — ${result.error}` : ""}` +
					`${result.stderr || result.stdout ? `\n${(result.stderr || result.stdout).trim()}` : ""}`,
			);
		}
		return result;
	}

	async queryRaw(section: string, setting?: string): Promise<string[]> {
		const args = ["query", section];
		if (setting !== undefined) args.push(setting);
		return outputLines((await this.run(args)).stdout);
	}

	query(section: string, setting: string): Promise<string[]> {
		return this.queryRaw(section, setting);
	}

	async set(section: string, setting: string, value: string): Promise<void> {
		await this.run(["set", section, setting, value]);
	}

	async append(section: string, setting: string, value: string): Promise<void> {
		await this.run(["append", section, setting, value]);
	}

	async restore(section: string, setting: string, values: readonly string[]): Promise<void> {
		if (values.length === 0) {
			await this.set(section, setting, "");
			return;
		}
		await this.set(section, setting, values[0]!);
		for (const value of values.slice(1)) await this.append(section, setting, value);
	}

	restoreSync(section: string, setting: string, values: readonly string[]): SandboxieCommandResult[] {
		const commands = values.length === 0
			? [["set", section, setting, ""]]
			: [["set", section, setting, values[0]!], ...values.slice(1).map((value) => ["append", section, setting, value])];
		const results: SandboxieCommandResult[] = [];
		for (const args of commands) {
			const result = this.cli.runSync(this.path, args);
			results.push(result);
			if (result.code !== 0) break;
		}
		return results;
	}
}
