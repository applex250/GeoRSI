/**
 * Sandboxie-Plus app-level execution adapter.
 *
 * This module deliberately does not implement isolation itself. It only:
 *   - configures an ephemeral Sandboxie box through SbieIni.exe;
 *   - reloads and reads the configuration back;
 *   - starts the root process through Start.exe /box:<name>; normal boxed-parent
 *     propagation keeps its descendants in the same box;
 *   - verifies that the box actually owns a live process before continuing.
 *
 * A failed preflight is an error. Callers must not fall back to host Python in
 * the sandboxie backend. Sandboxie is app-level isolation, not a VM boundary.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	closeSync,
	mkdirSync,
	realpathSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import type { Config } from "./config.js";
import { isProcessAlive, terminateProcessTree } from "./process.js";
import { sanitizeExecutionEnvironment } from "./process-env.js";
import { SandboxieCli, type SandboxieCommandResult } from "./sandboxie-cli.js";
import { SandboxieIni } from "./sandboxie-ini.js";
import { SandboxieGlobalLease } from "./sandboxie-lease.js";
import {
	addSandboxieCleanupError,
	advanceSandboxieCleanup,
	initialSandboxieCleanupState,
	sandboxieCleanupResult,
	sandboxiePartialCleanupReadyForLease,
	type SandboxieCleanupResult,
} from "./sandboxie-cleanup.js";

export { sandboxieGlobalLeasePath } from "./sandboxie-lease.js";
export type { SandboxieCleanupResult } from "./sandboxie-cleanup.js";

export type { SandboxieCommandResult } from "./sandboxie-cli.js";

export const SANDBOXIE_MAX_BOX_NAME = 38;
export const SANDBOXIE_BACKEND = "sandboxie-app-level" as const;

export interface SandboxiePaths {
	startPath: string;
	iniPath: string;
}

export interface SandboxieRuleSet {
	fileRootPath: string;
	openFilePath: string;
	closedFilePaths: string[];
	closedKeyPaths: string[];
	networkAccess: string;
}

export interface SandboxieBoxRecord {
	name: string;
	rootPath: string;
	exchangeWorkspace: string;
	reload: boolean;
	rules: SandboxieRuleSet;
	verifiedSettings: Record<string, string[]>;
	pids: number[];
	globalWfpWasEnabled: boolean;
	globalWfpOriginalValues: string[];
	leasePath: string;
	leaseToken: string;
	networkProbe?: Record<string, unknown>;
	cleanup?: SandboxieCleanupResult;
}

export interface SandboxieRunResult {
	launcherPid: number | undefined;
	targetPids: number[];
	exitCode: number | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	error?: string;
	launcherStdoutPath: string;
	launcherStderrPath: string;
	wrapperPath: string;
}

export interface SandboxieBackgroundRun {
	child: ChildProcess;
	launcherPid: number | undefined;
	targetPids: number[];
	wrapperPath: string;
	launcherStdoutPath: string;
	launcherStderrPath: string;
}

export interface SandboxiePythonRunOptions {
	boxName: string;
	pythonCmd: string;
	scriptPath: string;
	cwd: string;
	stdoutPath: string;
	stderrPath: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs: number;
	background?: boolean;
}

interface SandboxieAdapterOptions {
	paths: SandboxiePaths;
	sandboxRoot: string;
	commandTimeoutMs?: number;
	log?: (message: string) => void;
}

interface SandboxieCleanupReadback {
	globalWfpRestored: boolean;
	boxReadbackVerified: boolean;
	boxStillEnabled: boolean;
	errors: string[];
}

function lines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function normalizeWindowsPath(value: string): string {
	return value.replace(/\//g, "\\");
}

function pathAliases(value: string): string[] {
	const lexical = resolve(value);
	let canonical = lexical;
	try {
		canonical = realpathSync.native(lexical);
	} catch (error) {
		if (existsSync(lexical)) {
			throw new Error(`cannot canonicalize protected path ${lexical}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return uniqueCaseInsensitive([lexical, canonical]);
}

function canonicalPath(value: string): string {
	return resolve(value).replace(/[\\/]+$/, "").toLowerCase();
}

function isWithin(root: string, candidate: string): boolean {
	const r = canonicalPath(root);
	const c = canonicalPath(candidate);
	return c === r || c.startsWith(r + sep);
}

function processImageMap(): Map<number, string> {
	const images = new Map<number, string>();
	if (process.platform !== "win32") return images;
	const result = spawnSync("tasklist.exe", ["/FO", "CSV", "/NH"], {
		encoding: "utf8",
		windowsHide: true,
		stdio: ["ignore", "pipe", "ignore"],
	});
	const text = typeof result.stdout === "string" ? result.stdout : "";
	for (const line of text.split(/\r?\n/)) {
		const match = /^"([^"]+)","(\d+)"/.exec(line.trim());
		if (match) images.set(Number(match[2]), match[1]!);
	}
	return images;
}

function processImageName(pid: number): string {
	if (process.platform !== "win32") return "unknown";
	const result = spawnSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
		encoding: "utf8",
		windowsHide: true,
		stdio: ["ignore", "pipe", "ignore"],
	});
	const line = typeof result.stdout === "string" ? result.stdout.trim() : "";
	const match = /^"([^"]+)"/.exec(line);
	return match?.[1] ?? "unknown";
}

function settingComparable(value: string): string {
	return value.trim().replace(/\//g, "\\").replace(/[\\]+$/, "").toLowerCase();
}

function uniqueCaseInsensitive(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const key = settingComparable(value);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(value);
	}
	return out;
}

export function sandboxieSettingValuesMatch(actual: readonly string[], expected: readonly string[]): boolean {
	const a = uniqueCaseInsensitive(actual);
	const e = uniqueCaseInsensitive(expected);
	return a.length === e.length && e.every((value) => a.some((candidate) => settingComparable(candidate) === settingComparable(value)));
}

/** Sandboxie accepts only ASCII letters, digits, and underscore in box names. */
export function sanitizeSandboxieBoxName(raw: string): string {
	let name = raw.replace(/[^A-Za-z0-9_]/g, "_");
	if (!/^[A-Za-z]/.test(name)) name = `GeoRSI_${name}`;
	name = name.replace(/^_+/, "");
	if (!name) name = "GeoRSI_box";
	if (name.length > SANDBOXIE_MAX_BOX_NAME) name = name.slice(0, SANDBOXIE_MAX_BOX_NAME);
	if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
		throw new Error(`invalid Sandboxie box name after sanitization: ${JSON.stringify(name)}`);
	}
	return name;
}

export function makeSandboxieBoxName(tag: string): string {
	const digest = createHash("sha256")
		.update(`${tag}\0${Date.now()}\0${process.pid}`)
		.digest("hex")
		.slice(0, 16);
	return sanitizeSandboxieBoxName(`GeoRSI_${digest}`);
}

/** Arguments for a named root process. `/fcp` is deliberately not here. */
export function sandboxieRootCommandArgs(boxName: string, pythonCmd: string, wrapperPath: string): string[] {
	return [`/box:${sanitizeSandboxieBoxName(boxName)}`, "/wait", "/silent", "/hide_window", pythonCmd, wrapperPath];
}

/** `delete_sandbox_silent` is a command token, not a slash-prefixed option. */
export function sandboxieDeleteCommandArgs(boxName: string): string[] {
	return [`/box:${sanitizeSandboxieBoxName(boxName)}`, "delete_sandbox_silent"];
}

/**
 * Put an episode outside the repository. The requested path is used only to
 * derive stable run/episode labels; it is never used as the exchange root.
 */
export function resolveExchangeWorkspace(requestedPath: string, exchangeRoot?: string): string {
	const requested = resolve(requestedPath);
	const pieces = requested.split(/[\\/]+/).filter(Boolean);
	const lower = pieces.map((p) => p.toLowerCase());
	const runsIndex = lower.lastIndexOf("runs");
	const episodesIndex = lower.lastIndexOf("episodes");
	const runId = sanitizePathSegment(
		runsIndex >= 0 && pieces[runsIndex + 1]
			? pieces[runsIndex + 1]!
			: episodesIndex > 0 && pieces[episodesIndex - 1]
				? pieces[episodesIndex - 1]!
				: pieces.length > 1
					? pieces[pieces.length - 2]!
					: "run",
	);
	const episodeId = sanitizePathSegment(basename(requested) || "episode");
	const root = resolve(exchangeRoot ?? join(tmpdir(), "GeoRSI", "episodes"));
	return resolve(root, runId, episodeId);
}

function sanitizePathSegment(raw: string): string {
	const clean = raw.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+$/, "_");
	return (clean || "item").slice(0, 96);
}

function defaultStartCandidates(): string[] {
	const pf = process.env.ProgramFiles;
	const pf86 = process.env["ProgramFiles(x86)"];
	return [
		process.env.GEORSI_SANDBOXIE_START,
		pf ? join(pf, "Sandboxie-Plus", "Start.exe") : undefined,
		pf86 ? join(pf86, "Sandboxie-Plus", "Start.exe") : undefined,
		"C:\\Program Files\\Sandboxie-Plus\\Start.exe",
	].filter((x): x is string => !!x);
}

function defaultIniCandidates(): string[] {
	const pf = process.env.ProgramFiles;
	const pf86 = process.env["ProgramFiles(x86)"];
	return [
		process.env.GEORSI_SANDBOXIE_INI,
		pf ? join(pf, "Sandboxie-Plus", "SbieIni.exe") : undefined,
		pf86 ? join(pf86, "Sandboxie-Plus", "SbieIni.exe") : undefined,
		"C:\\Program Files\\Sandboxie-Plus\\SbieIni.exe",
	].filter((x): x is string => !!x);
}

function firstExisting(candidates: readonly string[], label: string): string {
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found) throw new Error(`${label} not found; tried: ${candidates.join(", ")}`);
	return resolve(found);
}

export function discoverSandboxiePaths(cfg?: Partial<Config>): SandboxiePaths {
	const startPath = firstExisting(
		[cfg?.sandboxie_start_path, ...defaultStartCandidates()].filter((x): x is string => !!x),
		"Sandboxie Start.exe",
	);
	const iniPath = firstExisting(
		[cfg?.sandboxie_ini_path, ...defaultIniCandidates()].filter((x): x is string => !!x),
		"Sandboxie SbieIni.exe",
	);
	return { startPath, iniPath };
}

/**
 * Strict episodes may not execute an interpreter located in a protected root.
 * Sandboxie intentionally closes the repository/private roots, so accepting
 * such a command would either fail mysteriously or tempt a caller to weaken
 * the rules. Bare commands are resolved through the host's command lookup so
 * a PATH entry pointing back into the repository is rejected too.
 */
export function assertSandboxPythonCommand(pythonCmd: string, protectedRoots: readonly string[]): string {
	const raw = pythonCmd.trim().replace(/^(["'])(.*)\1$/, "$2");
	if (!raw) throw new Error("strict Sandboxie requires a non-empty python_cmd");
	const pathLike = isAbsolute(raw) || /[\\/]/.test(raw);
	let candidate: string | null = null;
	if (pathLike) {
		candidate = resolve(raw);
	} else {
		const lookup = process.platform === "win32" ? "where.exe" : "which";
		const result = spawnSync(lookup, [raw], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		if (result.status === 0) candidate = lines(typeof result.stdout === "string" ? result.stdout : "")[0] ?? null;
	}
	if (!candidate) {
		throw new Error(`strict Sandboxie could not resolve python_cmd ${JSON.stringify(pythonCmd)}; use an external absolute interpreter`);
	}
	const resolved = resolve(candidate);
	let actual = resolved;
	try {
		actual = realpathSync(resolved);
	} catch {
		/* the command lookup already proved the executable exists */
	}
	for (const root of protectedRoots.flatMap(pathAliases)) {
		if (isWithin(root, actual)) {
			throw new Error(
				`strict Sandboxie refuses python_cmd inside a protected root: ${resolved}. ` +
				`Move the interpreter/venv outside the repository and private-truth roots; do not weaken ClosedFilePath rules.`,
			);
		}
	}
	return actual;
}

function credentialClosedPaths(repoRoot: string): string[] {
	const home = homedir();
	const candidates = [
		join(repoRoot, "api_key.txt"),
		join(home, ".pi", "agent", "*"),
		join(home, ".aws", "*"),
		join(home, ".azure", "*"),
		join(home, ".ssh", "*"),
		join(home, ".kube", "*"),
		join(home, ".docker", "*"),
		join(home, ".git-credentials"),
		join(home, ".npmrc"),
		join(home, "AppData", "Roaming", "pi", "*"),
		join(home, "AppData", "Local", "pi", "*"),
		process.env.APPDATA ? join(process.env.APPDATA, "pi", "*") : "",
		process.env.APPDATA ? join(process.env.APPDATA, "npm", "*") : "",
	];
	return candidates.filter(Boolean).map((p) => `${normalizeWindowsPath(resolve(p))}`);
}

export function credentialClosedKeys(): string[] {
	return [
		"HKEY_CURRENT_USER\\Software\\Microsoft\\Credentials\\*",
		"HKEY_CURRENT_USER\\Software\\Microsoft\\Vault\\*",
		"HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Authentication\\*",
	];
}

/** Shared environment policy; retained export for existing callers. */
export { sanitizeExecutionEnvironment as sanitizeSandboxEnvironment } from "./process-env.js";

export class SandboxieAdapter {
	readonly paths: SandboxiePaths;
	readonly sandboxRoot: string;
	private readonly cli: SandboxieCli;
	private readonly ini: SandboxieIni;
	private readonly globalLease: SandboxieGlobalLease;
	private readonly log: (message: string) => void;
	private runtimeCounter = 0;

	constructor(options: SandboxieAdapterOptions) {
		this.paths = options.paths;
		this.sandboxRoot = resolve(options.sandboxRoot);
		this.cli = new SandboxieCli(options.commandTimeoutMs ?? 20_000);
		this.ini = new SandboxieIni(this.cli, this.paths.iniPath);
		this.globalLease = new SandboxieGlobalLease();
		this.log = options.log ?? (() => {});
	}

	static fromConfig(cfg: Config, log?: (message: string) => void): SandboxieAdapter {
		const paths = discoverSandboxiePaths(cfg);
		const root = cfg.sandboxie_root ?? join(tmpdir(), "GeoRSI", "sandbox-roots");
		return new SandboxieAdapter({ paths, sandboxRoot: root, log });
	}

	private acquireGlobalLease(boxName: string): { path: string; token: string } {
		return this.globalLease.acquire(boxName);
	}

	private releaseGlobalLease(path: string, token: string): boolean {
		return this.globalLease.release(path, token);
	}

	private runCli(file: string, args: string[], timeoutMs?: number): Promise<SandboxieCommandResult> {
		return this.cli.run(file, args, timeoutMs);
	}

	private runCliSync(file: string, args: string[], timeoutMs?: number): SandboxieCommandResult {
		return this.cli.runSync(file, args, timeoutMs);
	}

	private runIni(args: string[]): Promise<SandboxieCommandResult> {
		return this.ini.run(args);
	}

	private runStartSync(args: string[]): SandboxieCommandResult {
		return this.runCliSync(this.paths.startPath, args);
	}

	private queryRaw(section: string, setting?: string): Promise<string[]> {
		return this.ini.queryRaw(section, setting);
	}

	async listSections(): Promise<string[]> {
		return this.queryRaw("*");
	}

	/**
	 * Important: `/boxes` is an option and `*` is still the required section
	 * argument. Calling `query /boxes` is not a valid box-list query.
	 */
	async listEnabledBoxes(): Promise<string[]> {
		const result = await this.runIni(["query", "/boxes", "*"]);
		return lines(result.stdout);
	}

	async query(section: string, setting: string): Promise<string[]> {
		return this.queryRaw(section, setting);
	}

	private set(section: string, setting: string, value: string): Promise<void> {
		return this.ini.set(section, setting, value);
	}

	private append(section: string, setting: string, value: string): Promise<void> {
		return this.ini.append(section, setting, value);
	}

	private restoreSetting(section: string, setting: string, values: readonly string[]): Promise<void> {
		return this.ini.restore(section, setting, values);
	}

	private restoreSettingSync(section: string, setting: string, values: readonly string[]): SandboxieCommandResult[] {
		return this.ini.restoreSync(section, setting, values);
	}

	async reload(): Promise<void> {
		const result = this.runStartSync(["/reload"]);
		if (result.code !== 0) {
			throw new Error(
				`Sandboxie /reload failed (${result.code ?? "no code"})${result.error ? `: ${result.error}` : ""}`,
			);
		}
	}

	private async assertServices(): Promise<void> {
		if (!existsSync(this.paths.startPath) || !existsSync(this.paths.iniPath)) {
			throw new Error("Sandboxie executables disappeared after discovery");
		}
		for (const service of ["SbieSvc", "SbieDrv"]) {
			const result = this.runCliSync("sc.exe", ["query", service]);
			if (result.code !== 0 || !/STATE\s*:\s*4\s+RUNNING/i.test(result.stdout)) {
				throw new Error(`Sandboxie service ${service} is not running; refusing host fallback`);
			}
		}
	}

	private async assertEnabled(name: string): Promise<void> {
		const boxes = await this.listEnabledBoxes();
		if (!boxes.some((box) => box.toLowerCase() === name.toLowerCase())) {
			throw new Error(
				`Sandboxie rejected box "${name}" as inactive/invalid. ` +
				`The box must have Enabled=y and be present in "SbieIni.exe query /boxes *"; ` +
				`refusing /box fallback to DefaultBox or host Python.`,
			);
		}
	}

	private async verifySetting(section: string, setting: string, expected: string): Promise<string[]> {
		const values = await this.query(section, setting);
		const hit = values.some((value) => settingComparable(value) === settingComparable(expected));
		if (!hit) {
			throw new Error(
				`Sandboxie rule read-back failed for [${section}] ${setting}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(values)}`,
			);
		}
		return values;
	}

	async prepareBox(args: {
		name: string;
		exchangeWorkspace: string;
		repoRoot: string;
		privateRoot: string;
		additionalProtectedRoots?: readonly string[];
	}): Promise<SandboxieBoxRecord> {
		const name = sanitizeSandboxieBoxName(args.name);
		const exchangeWorkspace = resolve(args.exchangeWorkspace);
		const repoAliases = pathAliases(args.repoRoot);
		const privateAliases = pathAliases(args.privateRoot);
		const additionalAliases = (args.additionalProtectedRoots ?? []).flatMap(pathAliases);
		const protectedRoots = uniqueCaseInsensitive([...repoAliases, ...privateAliases, ...additionalAliases]);
		const repoRoot = repoAliases[0]!;
		mkdirSync(exchangeWorkspace, { recursive: true });
		mkdirSync(this.sandboxRoot, { recursive: true });

		await this.assertServices();
		const sections = await this.listSections();
		if (sections.some((section) => section.toLowerCase() === name.toLowerCase())) {
			throw new Error(`Sandboxie box name collision: [${name}] already exists; refusing to modify it`);
		}

		const rootPath = resolve(this.sandboxRoot, name);
		if (
			protectedRoots.some((protectedRoot) => isWithin(protectedRoot, rootPath) || isWithin(rootPath, protectedRoot)) ||
			isWithin(exchangeWorkspace, rootPath) ||
			isWithin(rootPath, exchangeWorkspace)
		) {
			throw new Error(`Sandboxie virtual root overlaps a protected/exchange root: ${rootPath}`);
		}
		const exchangeRule = `${normalizeWindowsPath(exchangeWorkspace)}\\*`;
		const closedFilePaths = uniqueCaseInsensitive([
			...protectedRoots.map((protectedRoot) => `${normalizeWindowsPath(protectedRoot)}\\*`),
			...credentialClosedPaths(repoRoot),
		]);
		const closedKeyPaths = uniqueCaseInsensitive(credentialClosedKeys());
		const rules: SandboxieRuleSet = {
			fileRootPath: normalizeWindowsPath(rootPath),
			openFilePath: exchangeRule,
			closedFilePaths,
			closedKeyPaths,
			networkAccess: "*,Block",
		};
		const lease = this.acquireGlobalLease(name);
		let globalWfpOriginalValues: string[] = [];
		let globalWfpWasEnabled = true;
		let globalWfpSnapshotCaptured = false;

		// ConfigLevel=10 + Enabled=y is the critical fix for the recurring
		// "invalid sandbox name parameter DefaultBox" error. A section that is
		// merely present in Sandboxie.ini is not a usable box.
		try {
			globalWfpOriginalValues = await this.query("GlobalSettings", "NetworkEnableWFP");
			globalWfpSnapshotCaptured = true;
			globalWfpWasEnabled = globalWfpOriginalValues.some((value) => /^y$/i.test(value.trim()));
			if (!globalWfpWasEnabled) await this.set("GlobalSettings", "NetworkEnableWFP", "y");
			await this.set(name, "ConfigLevel", "10");
			await this.set(name, "Enabled", "y");
			await this.set(name, "FileRootPath", rules.fileRootPath);
			await this.set(name, "OpenFilePath", rules.openFilePath);
			await this.set(name, "DropAdminRights", "y");
			await this.set(name, "AllowNetworkAccess", "n");
			await this.set(name, "NetworkEnableWFP", "y");
			await this.set(name, "NetworkAccess", rules.networkAccess);
			await this.set(name, "BlockNetworkFiles", "y");
			await this.set(name, "ClosedFilePath", rules.closedFilePaths[0]!);
			for (const value of rules.closedFilePaths.slice(1)) await this.append(name, "ClosedFilePath", value);
			await this.set(name, "ClosedKeyPath", rules.closedKeyPaths[0]!);
			for (const value of rules.closedKeyPaths.slice(1)) await this.append(name, "ClosedKeyPath", value);

			// SbieIni writes are not enough. Sandboxie must reload before the box is
			// considered usable, and every load-bearing rule is read back afterward.
			await this.reload();
			await this.assertEnabled(name);
			const verifiedSettings: Record<string, string[]> = {};
			for (const [setting, expected] of [
				["ConfigLevel", "10"],
				["Enabled", "y"],
				["FileRootPath", rules.fileRootPath],
				["OpenFilePath", rules.openFilePath],
				["DropAdminRights", "y"],
				["AllowNetworkAccess", "n"],
				["NetworkEnableWFP", "y"],
				["NetworkAccess", rules.networkAccess],
				["BlockNetworkFiles", "y"],
			] as const) {
				verifiedSettings[setting] = await this.verifySetting(name, setting, expected);
			}
			verifiedSettings["GlobalSettings.NetworkEnableWFP"] = await this.verifySetting("GlobalSettings", "NetworkEnableWFP", "y");
			verifiedSettings.ClosedFilePath = await this.verifySetting(name, "ClosedFilePath", rules.closedFilePaths[0]!);
			for (const value of rules.closedFilePaths.slice(1)) {
				if (!verifiedSettings.ClosedFilePath.some((actual) => settingComparable(actual) === settingComparable(value))) {
					throw new Error(`Sandboxie ClosedFilePath read-back missing ${value}`);
				}
			}
			verifiedSettings.ClosedKeyPath = await this.verifySetting(name, "ClosedKeyPath", rules.closedKeyPaths[0]!);
			for (const value of rules.closedKeyPaths.slice(1)) {
				if (!verifiedSettings.ClosedKeyPath.some((actual) => settingComparable(actual) === settingComparable(value))) {
					throw new Error(`Sandboxie ClosedKeyPath read-back missing ${value}`);
				}
			}

			this.log(`[sandboxie] prepared ${name}; exchange=${exchangeWorkspace}`);
			return {
				name,
				rootPath,
				exchangeWorkspace,
				reload: true,
				rules,
				verifiedSettings,
				pids: [],
				globalWfpWasEnabled,
				globalWfpOriginalValues,
				leasePath: lease.path,
				leaseToken: lease.token,
			};
		} catch (error) {
			let removedConfig = false;
			let globalRestored = globalWfpSnapshotCaptured && globalWfpWasEnabled;
			let reloaded = false;
			try {
				await this.runIni(["set", name, "*", ""]);
				removedConfig = true;
			} catch (cleanupError) {
				this.log(`[sandboxie] failed to remove partial box ${name}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
			}
			if (globalWfpSnapshotCaptured && !globalWfpWasEnabled) {
				try {
					await this.restoreSetting("GlobalSettings", "NetworkEnableWFP", globalWfpOriginalValues);
					globalRestored = true;
				} catch (restoreError) {
					globalRestored = false;
					this.log(`[sandboxie] failed to restore global WFP after partial box ${name}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
				}
			}
			try {
				await this.reload();
				reloaded = true;
			} catch (reloadError) {
				this.log(`[sandboxie] failed to reload after partial box ${name}: ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`);
			}
			const readback = globalWfpSnapshotCaptured
				? await this.cleanupReadback(name, globalWfpOriginalValues)
				: { globalWfpRestored: false, boxReadbackVerified: false, boxStillEnabled: true, errors: ["global WFP pre-episode snapshot was not captured"] };
			for (const readbackError of readback.errors) this.log(`[sandboxie] partial cleanup read-back: ${readbackError}`);
			const safeToRelease = sandboxiePartialCleanupReadyForLease({
				globalWfpSnapshotCaptured,
				removedConfig,
				globalWfpWriteSucceeded: globalRestored,
				reloaded,
				globalWfpRestored: readback.globalWfpRestored,
				boxReadbackVerified: readback.boxReadbackVerified,
				boxStillEnabled: readback.boxStillEnabled,
			});
			if (safeToRelease) {
				if (!this.releaseGlobalLease(lease.path, lease.token)) {
					this.log(`[sandboxie] failed to release global-WFP lease after verified partial cleanup for ${name}`);
				}
			} else {
				this.log(`[sandboxie] retaining global-WFP lease after unverified partial cleanup for ${name}`);
			}
			throw error;
		}
	}

	private listPidsResultSync(name: string): { ok: boolean; pids: number[]; error?: string } {
		const result = this.runStartSync([`/box:${sanitizeSandboxieBoxName(name)}`, "/silent", "/listpids"]);
		if (result.code !== 0) {
			return { ok: false, pids: [], error: result.error ?? (result.stderr.trim() || `exit=${result.code}`) };
		}
		const raw = lines(result.stdout);
		const count = Number(raw[0]);
		const pidLines = Number.isInteger(count) && count >= 0 ? raw.slice(1, count + 1) : raw;
		return {
			ok: true,
			pids: pidLines
				.map((line) => Number(line))
				.filter((pid) => Number.isInteger(pid) && pid > 0),
		};
	}

	listPidsSync(name: string): number[] {
		return this.listPidsResultSync(name).pids;
	}

	private waitForBaselineRestored(name: string, baselinePids: ReadonlySet<number>, timeoutMs: number): Promise<void> {
		return new Promise((resolveDone, reject) => {
			const started = Date.now();
			const poll = (): void => {
				const listed = this.listPidsResultSync(name);
				if (!listed.ok) {
					reject(new Error(`Sandboxie /listpids failed while waiting for foreground exit in box ${name}: ${listed.error ?? "unknown error"}`));
					return;
				}
				const extra = listed.pids.filter((pid) => !baselinePids.has(pid) && isProcessAlive(pid));
				if (extra.length === 0) {
					resolveDone();
					return;
				}
				if (Date.now() - started >= timeoutMs) {
					const described = extra.map((pid) => `${pid}:${processImageName(pid)}`).join(",");
					reject(new Error(`Sandboxie foreground command left undeclared live descendants in box ${name}: ${described}`));
					return;
				}
				setTimeout(poll, 100);
			};
			poll();
		});
	}

	private waitForBoxPid(
		name: string,
		launcherPid: number | undefined,
		baselinePids: ReadonlySet<number>,
		timeoutMs: number,
		expectedImage?: string,
	): Promise<number[]> {
		return new Promise((resolvePids, reject) => {
			const started = Date.now();
			let lastPids: number[] = [];
			const observed = new Set<string>();
			const poll = (): void => {
				const listed = this.listPidsResultSync(name);
				if (!listed.ok) {
					reject(new Error(`Sandboxie /listpids failed for box ${name}: ${listed.error ?? "unknown error"}`));
					return;
				}
				lastPids = listed.pids;
				const expectedStem = expectedImage?.toLowerCase().replace(/\.exe$/, "");
				const imageMap = expectedStem ? processImageMap() : new Map<number, string>();
				for (const pid of listed.pids) observed.add(`${pid}:${imageMap.get(pid) ?? "unknown"}`);
				const pids = listed.pids.filter(
					(pid) =>
						pid !== process.pid &&
						pid !== launcherPid &&
						!baselinePids.has(pid) &&
						isProcessAlive(pid) &&
						(!expectedStem || (imageMap.get(pid) ?? "").toLowerCase().replace(/\.exe$/, "") === expectedStem),
				);
				if (pids.length > 0) {
					resolvePids(pids);
					return;
				}
				if (Date.now() - started >= timeoutMs) {
					reject(new Error(`Sandboxie process ownership could not be proven for box ${name}; baseline=[${[...baselinePids].join(",")}] current=[${lastPids.join(",")}] observed=[${[...observed].slice(-20).join(",")}] expectedImage=${expectedImage ?? "any"}`));
					return;
				}
				setTimeout(poll, 100);
			};
			poll();
		});
	}

	private buildPythonWrapper(options: SandboxiePythonRunOptions): string {
		const id = `${Date.now().toString(36)}_${this.runtimeCounter++}`;
		const wrapperPath = join(options.cwd, `.georsi_sandbox_runner_${id}.py`);
		const target = JSON.stringify(resolve(options.scriptPath));
		const stdout = JSON.stringify(resolve(options.stdoutPath));
		const stderr = JSON.stringify(resolve(options.stderrPath));
		const content = [
			"import contextlib, json, runpy, sys, time, traceback",
			`TARGET = ${target}`,
			`STDOUT = ${stdout}`,
			`STDERR = ${stderr}`,
			"code = 0",
			"try:",
			"    with open(STDOUT, 'w', encoding='utf-8') as _out, open(STDERR, 'w', encoding='utf-8') as _err:",
			"        with contextlib.redirect_stdout(_out), contextlib.redirect_stderr(_err):",
			"            sys.argv = [TARGET]",
			"            try:",
			"                runpy.run_path(TARGET, run_name='__main__')",
			"            except SystemExit as _exit:",
			"                code = int(_exit.code) if isinstance(_exit.code, int) else 0",
			"            except BaseException:",
			"                traceback.print_exc()",
			"                code = 1",
			"except BaseException:",
			"    try:",
			"        with open(STDERR, 'a', encoding='utf-8') as _err:",
			"            traceback.print_exc(file=_err)",
			"    except BaseException:",
			"        pass",
			"    code = 1",
			"# Keep a short-lived root process so the parent/box ownership check",
			"# cannot miss a very fast script.",
			"time.sleep(5.0)",
			"raise SystemExit(code)",
		].join("\n");
		writeFileSync(wrapperPath, content, "utf8");
		return wrapperPath;
	}

	private safePythonEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
		return sanitizeExecutionEnvironment(env);
	}

	private launchPython(options: SandboxiePythonRunOptions): {
		child: ChildProcess;
		wrapperPath: string;
		launcherStdoutPath: string;
		launcherStderrPath: string;
	} {
		const wrapperPath = this.buildPythonWrapper(options);
		const launcherStdoutPath = join(options.cwd, ".georsi_sandbox_start.stdout.log");
		const launcherStderrPath = join(options.cwd, ".georsi_sandbox_start.stderr.log");
		const outFd = openSync(launcherStdoutPath, "a");
		const errFd = openSync(launcherStderrPath, "a");
		// Do not put /fcp on this outer invocation. Sandboxie's parser treats
		// /fcp as "run this program outside and force only future children";
		// that would leave the Python root unboxed. /box restarts Start.exe into
		// the named box; normal parent propagation keeps descendants boxed.
		const args = sandboxieRootCommandArgs(options.boxName, options.pythonCmd, wrapperPath);
		try {
			const child = spawn(this.paths.startPath, args, {
				cwd: options.cwd,
				env: this.safePythonEnv(options.env),
				windowsHide: true,
				stdio: ["ignore", outFd, errFd],
			});
			return { child, wrapperPath, launcherStdoutPath, launcherStderrPath };
		} finally {
			closeSync(outFd);
			closeSync(errFd);
		}
	}

	async runPython(options: SandboxiePythonRunOptions): Promise<SandboxieRunResult> {
		if (options.background) throw new Error("use startPython for background Sandboxie jobs");
		const baseline = this.listPidsResultSync(options.boxName);
		if (!baseline.ok) throw new Error(`Sandboxie /listpids failed before launch for box ${options.boxName}: ${baseline.error ?? "unknown error"}`);
		const launchStarted = Date.now();
		const launched = this.launchPython(options);
		let launchError: Error | null = null;
		launched.child.once("error", (error) => {
			launchError = error;
		});
		let timedOut = false;
		let targetPids: number[] = [];
		let ownershipError: Error | null = null;
		try {
			targetPids = await this.waitForBoxPid(
				options.boxName,
				launched.child.pid,
				new Set(baseline.pids),
				Math.max(8_000, Math.min(options.timeoutMs, 15_000)),
				basename(options.pythonCmd),
			);
		} catch (error) {
			ownershipError = error instanceof Error ? error : new Error(String(error));
		}
		if (launchError || ownershipError) {
			this.terminateSync(options.boxName);
			terminateProcessTree(launched.child.pid);
			try {
				rmSync(launched.wrapperPath, { force: true });
			} catch {
				/* best effort */
			}
			throw launchError ?? ownershipError!;
		}
		const executionTimeoutMs = Math.max(1, options.timeoutMs - (Date.now() - launchStarted));
		const result = await new Promise<{ code: number | null; error?: string }>((resolveResult) => {
			let settled = false;
			let runtimeError: string | undefined;
			const finish = (code: number | null): void => {
				if (settled) return;
				settled = true;
				resolveResult({ code, error: runtimeError });
			};
			const timer = setTimeout(() => {
				timedOut = true;
				this.terminateSync(options.boxName);
				terminateProcessTree(launched.child.pid);
				finish(null);
			}, executionTimeoutMs);
			launched.child.on("error", (error) => {
				runtimeError = error.message;
				clearTimeout(timer);
				finish(null);
			});
			launched.child.on("close", (code) => {
				clearTimeout(timer);
				finish(code);
			});
		});
		try {
			await this.waitForBaselineRestored(
				options.boxName,
				timedOut ? new Set<number>() : new Set(baseline.pids),
				Math.min(5_000, Math.max(1_000, options.timeoutMs)),
			);
		} catch (error) {
			this.terminateSync(options.boxName);
			terminateProcessTree(launched.child.pid);
			try {
				rmSync(launched.wrapperPath, { force: true });
			} catch {
				/* best effort */
			}
			throw error;
		}
		return {
			launcherPid: launched.child.pid,
			targetPids,
			exitCode: result.code,
			timedOut,
			error: result.error,
			stdout: readTail(launched.launcherStdoutPath, 3000) + readTail(options.stdoutPath, 3000),
			stderr: readTail(launched.launcherStderrPath, 1500) + readTail(options.stderrPath, 1500),
			launcherStdoutPath: launched.launcherStdoutPath,
			launcherStderrPath: launched.launcherStderrPath,
			wrapperPath: launched.wrapperPath,
		};
	}

	async startPython(options: SandboxiePythonRunOptions): Promise<SandboxieBackgroundRun> {
		if (!options.background) throw new Error("startPython requires background=true");
		for (let attempt = 0; attempt < 2; attempt++) {
			const baseline = this.listPidsResultSync(options.boxName);
			if (!baseline.ok) throw new Error(`Sandboxie /listpids failed before background launch for box ${options.boxName}: ${baseline.error ?? "unknown error"}`);
			const retrySafe = baseline.pids.every((pid) => !isProcessAlive(pid));
			const launched = this.launchPython(options);
			let launchError: Error | null = null;
			launched.child.once("error", (error) => {
				launchError = error;
			});
			try {
				const targetPids = await this.waitForBoxPid(
					options.boxName,
					launched.child.pid,
					new Set(baseline.pids),
					Math.min(options.timeoutMs, 30_000),
					basename(options.pythonCmd),
				);
				if (launchError) throw launchError;
				launched.child.unref();
				return {
					child: launched.child,
					launcherPid: launched.child.pid,
					targetPids,
					wrapperPath: launched.wrapperPath,
					launcherStdoutPath: launched.launcherStdoutPath,
					launcherStderrPath: launched.launcherStderrPath,
				};
			} catch (error) {
				const preExitCode = launched.child.exitCode;
				const preSignalCode = launched.child.signalCode;
				this.terminateSync(options.boxName);
				terminateProcessTree(launched.child.pid);
				try {
					rmSync(launched.wrapperPath, { force: true });
				} catch {
					/* best effort */
				}
				if (!retrySafe || attempt === 1) {
					throw new Error(
						`${error instanceof Error ? error.message : String(error)}; ` +
						`launcher pid=${launched.child.pid ?? "none"} exitCode=${preExitCode ?? "null"} signal=${preSignalCode ?? "null"}; ` +
						`launcher stdout=${readTail(launched.launcherStdoutPath, 800)}; ` +
						`launcher stderr=${readTail(launched.launcherStderrPath, 800)}; ` +
						`python stdout=${readTail(options.stdoutPath, 800)}; ` +
						`python stderr=${readTail(options.stderrPath, 800)}`,
					);
				}
				await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
			}
		}
		throw new Error(`Sandboxie background launch failed for box ${options.boxName}`);
	}

	terminateSync(name: string): SandboxieCommandResult {
		const result = this.runStartSync([`/box:${sanitizeSandboxieBoxName(name)}`, "/silent", "/terminate"]);
		if (result.code !== 0) this.log(`[sandboxie] terminate ${name}: exit=${result.code}`);
		return result;
	}

	private cleanupReadbackSync(name: string, expectedGlobal: readonly string[]): SandboxieCleanupReadback {
		const errors: string[] = [];
		const globalQuery = this.runCliSync(this.paths.iniPath, ["query", "GlobalSettings", "NetworkEnableWFP"]);
		const globalWfpRestored = globalQuery.code === 0 && sandboxieSettingValuesMatch(lines(globalQuery.stdout), expectedGlobal);
		if (!globalWfpRestored) errors.push("GlobalSettings NetworkEnableWFP read-back did not match its pre-episode value");
		const boxes = this.runCliSync(this.paths.iniPath, ["query", "/boxes", "*"]);
		const boxReadbackVerified = boxes.code === 0;
		const boxStillEnabled = boxReadbackVerified && lines(boxes.stdout).some((box) => box.toLowerCase() === name.toLowerCase());
		if (!boxReadbackVerified) errors.push(`enabled-box read-back failed during sync cleanup (exit=${boxes.code})`);
		else if (boxStillEnabled) errors.push(`box ${name} remains enabled after sync cleanup`);
		return { globalWfpRestored, boxReadbackVerified, boxStillEnabled, errors };
	}

	private async cleanupReadback(name: string, expectedGlobal: readonly string[]): Promise<SandboxieCleanupReadback> {
		const errors: string[] = [];
		let globalWfpRestored = false;
		try {
			globalWfpRestored = sandboxieSettingValuesMatch(await this.query("GlobalSettings", "NetworkEnableWFP"), expectedGlobal);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
		if (!globalWfpRestored) errors.push("GlobalSettings NetworkEnableWFP read-back did not match its pre-episode value");
		let boxReadbackVerified = false;
		let boxStillEnabled = false;
		try {
			boxStillEnabled = (await this.listEnabledBoxes()).some((box) => box.toLowerCase() === name.toLowerCase());
			boxReadbackVerified = true;
			if (boxStillEnabled) errors.push(`box ${name} remains enabled after cleanup`);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
		return { globalWfpRestored, boxReadbackVerified, boxStillEnabled, errors };
	}

	cleanupBoxSync(record: SandboxieBoxRecord): SandboxieCleanupResult {
		let state = initialSandboxieCleanupState();
		const terminate = this.terminateSync(record.name);
		const remaining = this.listPidsResultSync(record.name);
		const livePids = remaining.pids.filter(isProcessAlive);
		const terminated = terminate.code === 0 && remaining.ok && livePids.length === 0;
		state = advanceSandboxieCleanup(state, {
			type: "termination",
			ok: terminated,
			error: terminated
				? undefined
				: remaining.ok
					? `box ${record.name} still has live pids before sync cleanup`
					: `Sandboxie /listpids failed before sync cleanup: ${remaining.error ?? "unknown error"}`,
		});
		if (!terminated) return sandboxieCleanupResult(state);

		const deleted = this.runCliSync(this.paths.startPath, sandboxieDeleteCommandArgs(record.name));
		state = advanceSandboxieCleanup(state, {
			type: "data-deletion",
			ok: deleted.code === 0,
			error: deleted.code === 0 ? undefined : `delete_sandbox_silent exit=${deleted.code}`,
		});
		const removed = this.runCliSync(this.paths.iniPath, ["set", record.name, "*", ""]);
		state = advanceSandboxieCleanup(state, {
			type: "config-removal",
			ok: removed.code === 0,
			error: removed.code === 0 ? undefined : `SbieIni remove section exit=${removed.code}`,
		});

		let globalWriteOk = record.globalWfpWasEnabled;
		if (!record.globalWfpWasEnabled) {
			const restored = this.restoreSettingSync("GlobalSettings", "NetworkEnableWFP", record.globalWfpOriginalValues);
			globalWriteOk = restored.every((result) => result.code === 0);
		}
		state = advanceSandboxieCleanup(state, {
			type: "global-wfp-write",
			ok: globalWriteOk,
			error: globalWriteOk ? undefined : "failed to restore GlobalSettings NetworkEnableWFP",
		});
		const reload = this.runStartSync(["/reload"]);
		state = advanceSandboxieCleanup(state, {
			type: "reload",
			ok: reload.code === 0,
			error: reload.code === 0 ? undefined : `Sandboxie /reload exit=${reload.code}`,
		});

		const readback = this.cleanupReadbackSync(record.name, record.globalWfpOriginalValues);
		state = advanceSandboxieCleanup(state, {
			type: "read-back",
			...readback,
		});
		if (state.stage === "release-lease") {
			const released = this.releaseGlobalLease(record.leasePath, record.leaseToken);
			state = advanceSandboxieCleanup(state, {
				type: "lease-release",
				ok: released,
				error: released ? undefined : "Sandboxie global-WFP lease could not be released",
			});
		}
		try {
			rmSync(record.rootPath, { recursive: true, force: true });
		} catch (error) {
			state = addSandboxieCleanupError(state, `sandbox root cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		return sandboxieCleanupResult(state);
	}

	async cleanupBox(record: SandboxieBoxRecord): Promise<SandboxieCleanupResult> {
		let state = initialSandboxieCleanupState();
		const terminate = this.terminateSync(record.name);
		const remaining = this.listPidsResultSync(record.name);
		const terminated = terminate.code === 0 && remaining.ok && remaining.pids.filter(isProcessAlive).length === 0;
		state = advanceSandboxieCleanup(state, {
			type: "termination",
			ok: terminated,
			error: terminated
				? undefined
				: remaining.ok
					? `box ${record.name} still has live pids before cleanup`
					: `Sandboxie /listpids failed before cleanup: ${remaining.error ?? "unknown error"}`,
		});
		if (!terminated) return sandboxieCleanupResult(state);

		const deleteResult = await this.runCli(this.paths.startPath, sandboxieDeleteCommandArgs(record.name));
		state = advanceSandboxieCleanup(state, {
			type: "data-deletion",
			ok: deleteResult.code === 0,
			error: deleteResult.code === 0 ? undefined : `delete_sandbox_silent exit=${deleteResult.code}`,
		});

		let configError: string | undefined;
		try {
			await this.runIni(["set", record.name, "*", ""]);
		} catch (error) {
			configError = error instanceof Error ? error.message : String(error);
		}
		state = advanceSandboxieCleanup(state, { type: "config-removal", ok: !configError, error: configError });

		let globalWriteOk = record.globalWfpWasEnabled;
		let globalWriteError: string | undefined;
		if (!record.globalWfpWasEnabled) {
			try {
				await this.restoreSetting("GlobalSettings", "NetworkEnableWFP", record.globalWfpOriginalValues);
				globalWriteOk = true;
			} catch (error) {
				globalWriteOk = false;
				globalWriteError = error instanceof Error ? error.message : String(error);
			}
		}
		state = advanceSandboxieCleanup(state, { type: "global-wfp-write", ok: globalWriteOk, error: globalWriteError });

		let reloadError: string | undefined;
		try {
			await this.reload();
		} catch (error) {
			reloadError = error instanceof Error ? error.message : String(error);
		}
		state = advanceSandboxieCleanup(state, { type: "reload", ok: !reloadError, error: reloadError });

		const readback = await this.cleanupReadback(record.name, record.globalWfpOriginalValues);
		state = advanceSandboxieCleanup(state, {
			type: "read-back",
			...readback,
		});
		if (state.stage === "release-lease") {
			const released = this.releaseGlobalLease(record.leasePath, record.leaseToken);
			state = advanceSandboxieCleanup(state, {
				type: "lease-release",
				ok: released,
				error: released ? undefined : "Sandboxie global-WFP lease could not be released",
			});
		}
		try {
			rmSync(record.rootPath, { recursive: true, force: true });
		} catch (error) {
			state = addSandboxieCleanupError(state, `sandbox root cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		return sandboxieCleanupResult(state);
	}

}

function readTail(path: string, maxChars: number): string {
	try {
		const text = readFileSync(path, "utf8");
		return text.slice(-maxChars);
	} catch {
		return "";
	}
}

export function defaultSandboxieRoot(): string {
	return join(tmpdir(), "GeoRSI", "sandbox-roots");
}

export function defaultExchangeRoot(): string {
	return join(tmpdir(), "GeoRSI", "episodes");
}

export function isSandboxieBackend(cfg: Config): boolean {
	if (cfg.execution_backend === "sandboxie") return true;
	if (cfg.execution_backend === "host-audit") return false;
	return process.platform === "win32";
}

export function ensureAbsoluteExchangeWorkspace(path: string, root?: string): string {
	const absolute = resolve(path);
	const exchangeRoot = resolve(root ?? defaultExchangeRoot());
	if (!isWithin(exchangeRoot, absolute)) {
		throw new Error(`workspace is outside the configured exchange root: ${absolute}`);
	}
	return absolute;
}

export function sandboxieRulePaths(repoRoot: string, privateRoot: string, exchangeWorkspace: string): SandboxieRuleSet {
	const repo = resolve(repoRoot);
	const priv = resolve(privateRoot);
	const exchange = resolve(exchangeWorkspace);
	return {
		fileRootPath: normalizeWindowsPath(join(defaultSandboxieRoot(), "placeholder")),
		openFilePath: `${normalizeWindowsPath(exchange)}\\*`,
		closedFilePaths: uniqueCaseInsensitive([
			`${normalizeWindowsPath(repo)}\\*`,
			`${normalizeWindowsPath(priv)}\\*`,
			...credentialClosedPaths(repo),
		]),
		closedKeyPaths: credentialClosedKeys(),
		networkAccess: "*,Block",
	};
}
