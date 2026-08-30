/** Cross-process lease protecting Sandboxie's process-global WFP setting. */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

export interface SandboxieLeaseRecord {
	pid: number;
	token: string;
	boxName: string;
	createdAt: string;
}

export interface SandboxieLeaseHandle {
	path: string;
	token: string;
}

export function sandboxieGlobalLeasePath(): string {
	return resolve(tmpdir(), "GeoRSI", "sandboxie-global-wfp.lock");
}

export class SandboxieGlobalLease {
	constructor(
		readonly path = sandboxieGlobalLeasePath(),
		private readonly ownerPid = process.pid,
		private readonly now = () => new Date(),
	) {}

	acquire(boxName: string): SandboxieLeaseHandle {
		mkdirSync(dirname(this.path), { recursive: true });
		const token = randomUUID();
		const record: SandboxieLeaseRecord = {
			pid: this.ownerPid,
			token,
			boxName,
			createdAt: this.now().toISOString(),
		};
		let handle: number;
		try {
			handle = openSync(this.path, "wx", 0o600);
		} catch (error) {
			let owner = "unknown owner";
			try {
				const existing = JSON.parse(readFileSync(this.path, "utf8")) as Partial<SandboxieLeaseRecord>;
				owner = `pid=${existing.pid ?? "?"} box=${existing.boxName ?? "?"} created=${existing.createdAt ?? "?"}`;
			} catch { /* retain generic owner text */ }
			throw new Error(
				`strict Sandboxie global-WFP lease is already present (${owner}) at ${this.path}. ` +
					`Concurrent strict episodes are refused. If the owner crashed, inspect/terminate stale GeoRSI boxes, restore Sandboxie.ini, run npm run sandboxie:selftest, then remove the stale lease manually. ` +
					`Original error: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		try {
			writeFileSync(handle, JSON.stringify(record), "utf8");
		} finally {
			closeSync(handle);
		}
		return { path: this.path, token };
	}

	release(path: string, token: string): boolean {
		if (resolve(path) !== resolve(this.path)) return false;
		try {
			const current = JSON.parse(readFileSync(this.path, "utf8")) as Partial<SandboxieLeaseRecord>;
			if (current.token !== token || current.pid !== this.ownerPid) return false;
			rmSync(this.path, { force: true });
			return !existsSync(this.path);
		} catch {
			return false;
		}
	}
}
