/** Cross-platform process-tree termination for agent-run computations. */
import { spawnSync } from "node:child_process";

/** Best-effort liveness probe used after timeout/kill operations. */
export function isProcessAlive(pid: number | undefined): boolean {
	if (pid == null || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Terminate a child and its descendants where the host permits it.
 *
 * This is lifecycle hygiene, not a security sandbox: it prevents orphaned
 * jobs after timeout/stop but does not restrict what a live process can read
 * or access while it is running.
 */
export function terminateProcessTree(pid: number | undefined): void {
	if (pid == null || pid <= 0) return;
	if (process.platform === "win32") {
		const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
		});
		if (result.status === 0 || !isProcessAlive(pid)) return;
	}

	// Foreground POSIX children are spawned detached by the caller, so a
	// negative pid addresses the entire process group. Escalate immediately:
	// this function is only called for explicit kill/timeout cleanup, and
	// leaving a descendant alive is worse than losing graceful shutdown.
	try {
		process.kill(-pid, "SIGTERM");
		process.kill(-pid, "SIGKILL");
		return;
	} catch {
		try {
			process.kill(pid, "SIGTERM");
			process.kill(pid, "SIGKILL");
		} catch {
			/* already gone or not killable */
		}
	}
}
