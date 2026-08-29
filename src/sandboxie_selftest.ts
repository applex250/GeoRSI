/** Real no-LLM Sandboxie-Plus integration smoke test. */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig, ROOT } from "./config.js";
import { sandboxProbeSource, hostNetworkReachable } from "./inner/solve.js";
import { SandboxieAdapter, assertSandboxPythonCommand, makeSandboxieBoxName, resolveExchangeWorkspace, sandboxieGlobalLeasePath, type SandboxieBoxRecord } from "./sandboxie.js";

const cfg = loadConfig();
const exchange = resolveExchangeWorkspace(
	join(ROOT, "runs", "sandboxie-selftest", "episodes", "probe"),
	cfg.sandboxie_exchange_root,
);
const repoRoot = resolve(ROOT);
const privateRoot = resolve(ROOT, cfg.private_truth_dir);
const additionalProtectedRoot = join(tmpdir(), "GeoRSI", `sandboxie-protected-${process.pid}`);
const additionalProtectedFile = join(additionalProtectedRoot, "canary.txt");
mkdirSync(additionalProtectedRoot, { recursive: true });
writeFileSync(additionalProtectedFile, "sandboxie-protected-canary", "utf8");
const pythonCmd = assertSandboxPythonCommand(process.env.GEORSI_SANDBOXIE_PYTHON ?? cfg.python_cmd, [repoRoot, privateRoot]);
const probeScript = join(exchange, ".sandboxie-selftest.py");
const probeResult = join(exchange, ".sandboxie-selftest.json");
const adapter = SandboxieAdapter.fromConfig(cfg, (message) => console.log(message));
let record: SandboxieBoxRecord | null = null;

try {
	rmSync(exchange, { recursive: true, force: true });
	mkdirSync(exchange, { recursive: true });
	const hostNetwork = await hostNetworkReachable();
	if (!hostNetwork) throw new Error("host network preflight failed; refusing to classify an unavailable network as sandbox blocking");
	writeFileSync(
		probeScript,
		sandboxProbeSource(join(repoRoot, "README.md"), privateRoot, probeResult, hostNetwork, [additionalProtectedFile]),
		"utf8",
	);
	record = await adapter.prepareBox({
		name: makeSandboxieBoxName("sandboxie-selftest"),
		exchangeWorkspace: exchange,
		repoRoot,
		privateRoot,
		additionalProtectedRoots: [additionalProtectedRoot],
	});
	let concurrentLeaseRejected = false;
	try {
		await adapter.prepareBox({
			name: makeSandboxieBoxName("sandboxie-selftest-concurrent"),
			exchangeWorkspace: exchange,
			repoRoot,
			privateRoot,
		});
	} catch (error) {
		concurrentLeaseRejected = String(error).includes("global-WFP lease");
	}
	if (!concurrentLeaseRejected) throw new Error("concurrent strict Sandboxie prepare did not fail on the global-WFP lease");
	const run = await adapter.runPython({
		boxName: record.name,
		pythonCmd,
		scriptPath: probeScript,
		cwd: exchange,
		stdoutPath: join(exchange, ".sandboxie-selftest.stdout.log"),
		stderrPath: join(exchange, ".sandboxie-selftest.stderr.log"),
		timeoutMs: 30_000,
	});
	console.log(`sandboxie run exit=${run.exitCode} timeout=${run.timedOut} pids=${run.targetPids.join(",")}`);
	if (!existsSync(probeResult)) {
		throw new Error(`probe result missing; stdout=${run.stdout.slice(-500)} stderr=${run.stderr.slice(-500)}`);
	}
	const result = JSON.parse(readFileSync(probeResult, "utf8")) as Record<string, unknown>;
	if (run.exitCode !== 0 || run.timedOut || run.targetPids.length === 0) {
		throw new Error(`Sandboxie runner failed: exit=${run.exitCode} timeout=${run.timedOut} pids=${run.targetPids.join(",")}`);
	}
	for (const key of ["repo_file", "private_dir", "network"]) {
		if (result[key] !== "BLOCKED") throw new Error(`isolation probe ${key}=${String(result[key])} detail=${String(result[`${key}_detail`] ?? "missing")}`);
	}
	const additional = result.additional_protected as { status?: unknown }[] | undefined;
	if (!additional || additional.length !== 1 || additional[0]?.status !== "BLOCKED") {
		throw new Error(`additional protected canary was not blocked: ${JSON.stringify(additional)}`);
	}
	const timeoutScript = join(exchange, ".sandboxie-timeout.py");
	writeFileSync(timeoutScript, "import time\ntime.sleep(20)\n", "utf8");
	const timed = await adapter.runPython({
		boxName: record.name,
		pythonCmd,
		scriptPath: timeoutScript,
		cwd: exchange,
		stdoutPath: join(exchange, ".sandboxie-timeout.stdout.log"),
		stderrPath: join(exchange, ".sandboxie-timeout.stderr.log"),
		timeoutMs: 1_500,
	});
	if (!timed.timedOut || timed.exitCode !== null) {
		throw new Error(`foreground timeout was not enforced: exit=${timed.exitCode} timeout=${timed.timedOut}`);
	}
	const exceptionScript = join(exchange, ".sandboxie-exception.py");
	writeFileSync(exceptionScript, "raise RuntimeError('expected selftest failure')\n", "utf8");
	const failed = await adapter.runPython({
		boxName: record.name,
		pythonCmd,
		scriptPath: exceptionScript,
		cwd: exchange,
		stdoutPath: join(exchange, ".sandboxie-exception.stdout.log"),
		stderrPath: join(exchange, ".sandboxie-exception.stderr.log"),
		timeoutMs: 15_000,
	});
	if (failed.exitCode !== 1 || failed.timedOut || !failed.stderr.includes("expected selftest failure")) {
		throw new Error(`exception exit was not captured: exit=${failed.exitCode} timeout=${failed.timedOut} stderr=${failed.stderr.slice(-200)}`);
	}
	if (process.env.GEORSI_SANDBOXIE_PYTHON) {
		const gisScript = join(exchange, ".sandboxie-gis-runtime.py");
		writeFileSync(gisScript, "import geopandas, rasterio, shapely, pyproj\nprint('GIS_RUNTIME_OK')\n", "utf8");
		const gisRun = await adapter.runPython({
			boxName: record.name,
			pythonCmd,
			scriptPath: gisScript,
			cwd: exchange,
			stdoutPath: join(exchange, ".sandboxie-gis-runtime.stdout.log"),
			stderrPath: join(exchange, ".sandboxie-gis-runtime.stderr.log"),
			timeoutMs: 30_000,
		});
		if (gisRun.exitCode !== 0 || gisRun.timedOut || !gisRun.stdout.includes("GIS_RUNTIME_OK")) {
			throw new Error(`external GIS runtime failed: exit=${gisRun.exitCode} timeout=${gisRun.timedOut} stderr=${gisRun.stderr.slice(-300)}`);
		}
	}
	const backgroundScript = join(exchange, ".sandboxie-background.py");
	const backgroundStarted = join(exchange, ".sandboxie-background.started");
	const backgroundMarker = join(exchange, ".sandboxie-background.marker");
	writeFileSync(backgroundScript, `import pathlib, time\npathlib.Path(${JSON.stringify(backgroundStarted)}).write_text('started')\ntime.sleep(20)\npathlib.Path(${JSON.stringify(backgroundMarker)}).write_text('finished')\n`, "utf8");
	const background = await adapter.startPython({
		boxName: record.name,
		pythonCmd,
		scriptPath: backgroundScript,
		cwd: exchange,
		stdoutPath: join(exchange, ".sandboxie-background.stdout.log"),
		stderrPath: join(exchange, ".sandboxie-background.stderr.log"),
		timeoutMs: 60_000,
		background: true,
	});
	if (background.targetPids.length === 0) throw new Error("background Sandboxie job had no verified target PID");
	const foregroundScript = join(exchange, ".sandboxie-foreground.py");
	writeFileSync(foregroundScript, "print('foreground-ok')\n", "utf8");
	const foreground = await adapter.runPython({
		boxName: record.name,
		pythonCmd,
		scriptPath: foregroundScript,
		cwd: exchange,
		stdoutPath: join(exchange, ".sandboxie-foreground.stdout.log"),
		stderrPath: join(exchange, ".sandboxie-foreground.stderr.log"),
		timeoutMs: 15_000,
	});
	if (foreground.exitCode !== 0 || foreground.timedOut) {
		throw new Error(`foreground Sandboxie job failed: exit=${foreground.exitCode} timeout=${foreground.timedOut}`);
	}
	if (foreground.targetPids.length === 0) throw new Error("foreground Sandboxie job had no verified target PID");
	if (foreground.targetPids.some((pid) => background.targetPids.includes(pid))) {
		throw new Error(`foreground PID ownership was confused with an existing background job: ${foreground.targetPids.join(",")}`);
	}
	adapter.terminateSync(record.name);
	await new Promise<void>((done) => {
		if (background.child.exitCode !== null) {
			done();
			return;
		}
		const timer = setTimeout(done, 5_000);
		background.child.once("exit", () => {
			clearTimeout(timer);
			done();
		});
	});
	if (existsSync(backgroundMarker)) throw new Error("terminated background job wrote its completion marker");
	const detachedScript = join(exchange, ".sandboxie-detached-descendant.py");
	writeFileSync(
		detachedScript,
		"import subprocess, sys\nflags = getattr(subprocess, 'DETACHED_PROCESS', 0) | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)\nsubprocess.Popen([sys.executable, '-c', 'import time; time.sleep(20)'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True, creationflags=flags)\nprint('spawned')\n",
		"utf8",
	);
	let detachedRejected = false;
	try {
		await adapter.runPython({
			boxName: record.name,
			pythonCmd,
			scriptPath: detachedScript,
			cwd: exchange,
			stdoutPath: join(exchange, ".sandboxie-detached.stdout.log"),
			stderrPath: join(exchange, ".sandboxie-detached.stderr.log"),
			timeoutMs: 12_000,
		});
	} catch (error) {
		detachedRejected = String(error).includes("undeclared live descendants");
	}
	if (!detachedRejected) throw new Error("foreground detached descendant was not detected and rejected");
	const { scanWorkspaceForBreaches } = await import("./guard.js");
	const probeLeaks = scanWorkspaceForBreaches(exchange);
	if (probeLeaks.length > 0) throw new Error(`probe diagnostics leaked protected paths: ${JSON.stringify(probeLeaks)}`);
	const cleanup = await adapter.cleanupBox(record);
	if (cleanup.errors.length > 0 || cleanup.boxStillEnabled || !cleanup.globalWfpRestored || !cleanup.leaseReleased) {
		throw new Error(`cleanup failed: ${cleanup.errors.join("; ") || "box remains enabled or global WFP was not restored"}`);
	}
	const staleLease = sandboxieGlobalLeasePath();
	mkdirSync(resolve(staleLease, ".."), { recursive: true });
	writeFileSync(staleLease, JSON.stringify({ pid: 0, token: "stale", boxName: "GeoRSI_stale", createdAt: "stale" }), "utf8");
	let staleRejected = false;
	try {
		await adapter.prepareBox({
			name: makeSandboxieBoxName("sandboxie-stale-lease"),
			exchangeWorkspace: exchange,
			repoRoot,
			privateRoot,
		});
	} catch (error) {
		staleRejected = String(error).includes("remove the stale lease manually");
	} finally {
		rmSync(staleLease, { force: true });
	}
	if (!staleRejected) throw new Error("stale Sandboxie global-WFP lease did not fail closed with recovery guidance");
	console.log(`SANDBOXIE_OK box=${record.name} pids=${run.targetPids.join(",")} exchange=${exchange}`);
} catch (error) {
	console.error(`SANDBOXIE_FAIL: ${error instanceof Error ? error.message : String(error)}`);
	if (record) {
		try {
			await adapter.cleanupBox(record);
		} catch {
			/* preserve the original failure */
		}
	}
	process.exitCode = 1;
} finally {
	if (existsSync(exchange)) rmSync(exchange, { recursive: true, force: true });
	if (existsSync(additionalProtectedRoot)) rmSync(additionalProtectedRoot, { recursive: true, force: true });
}
