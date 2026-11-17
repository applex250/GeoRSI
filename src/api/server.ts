/**
 * GeoRSI local HTTP API.
 *
 * This is intentionally a thin adapter around the existing CLI/research
 * runtime.  The browser talks in terms of research runs; it never receives
 * filesystem paths, model credentials, or arbitrary command-line arguments.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync, appendFileSync, renameSync, rmSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ROOT, loadConfig, researchModelConfigFingerprint } from "../config.js";
import { atomicWriteJson } from "../journal.js";
import { validateResearchMission, type ResearchMission, type ResearchWorkGraph } from "../research/contracts.js";
import { readResearchLedger, type ResearchEvent } from "../research/event-ledger.js";
import { foldNodeActivity } from "../research/node-activity.js";
import { buildBudgetReport } from "../research/budget-report.js";
import { receiveUpload, getUpload } from "./uploads.js";
import { ExperienceStore } from "../research/experience/store.js";
import { approvalId } from "../research/experience/approval.js";
import type { WorkspaceState, Direction } from "../research/workspace-agent.js";

const API_PREFIX = "/api/v1";
const DEFAULT_PORT = 8787;
/** Loopback by default: the API has no user accounts, so reachability IS authorization.
 * Containers set GEORSI_API_HOST=0.0.0.0 and publish the port on the host's loopback. */
const DEFAULT_HOST = "127.0.0.1";
const RUNS_ROOT = resolve(ROOT, "runs");
const TSX_CLI = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const RUN_TS = join(ROOT, "src", "run.ts");
/** Shared secret (optional). When set, every request except the health probes and
 * the service index must present it as `Authorization: Bearer` or `X-GeoRSI-Token`.
 * Read per request so a selftest (and an operator) can rotate it without a restart. */
const apiToken = (): string | undefined => process.env.GEORSI_API_TOKEN?.trim() || undefined;
/** Browser origin allowed to call the API cross-origin. Unset = no CORS headers at
 * all: the shipped frontend reaches the engine through its same-origin proxy. */
const allowedOrigin = (): string | undefined => process.env.GEORSI_API_ALLOWED_ORIGIN?.trim() || undefined;
/** Every managed run is a Node + Python + model-billing child; cap them uniformly. */
const MAX_CONCURRENT_RUNS = Math.max(1, Math.min(16, Number(process.env.GEORSI_API_MAX_CONCURRENT) || 2));

/** `rsi` (the classic agent-evolution loop) is frozen and no longer creatable here;
 * records from before the freeze still load, but cannot be started. */
type RunMode = "research-live" | "research-demo" | "evolve" | "research-agent";
type RunStatus = "queued" | "running" | "pausing" | "paused" | "stopping" | "completed" | "failed" | "cancelled";
type Action = "stop";

interface RunRecord {
	id: string;
	name: string;
	mode: RunMode;
	status: RunStatus;
	createdAt: string;
	startedAt?: string;
	updatedAt: string;
	finishedAt?: string;
	missionId?: string;
	/** Public config name, never an arbitrary filesystem path. */
	configName?: string;
	gens?: number;
	pid?: number;
	exitCode?: number | null;
	error?: string;
	command?: string[];
}

interface RunSnapshot {
	id: string;
	name: string;
	mode: RunMode;
	status: RunStatus;
	phase: string;
	progress: { completedNodes: number; totalNodes: number; percent: number };
	timing: { createdAt: string; startedAt?: string; updatedAt: string; finishedAt?: string; elapsedSeconds: number };
	usage: { evidenceCount: number; activeNodes: number; tokens?: number; totalEvents: number };
	currentNode: Record<string, unknown> | null;
	result: Record<string, unknown> | null;
	error?: string;
}

interface CreateRunBody {
	name?: unknown;
	mode?: unknown;
	mission?: unknown;
	config?: unknown;
	gens?: unknown;
	autoStart?: unknown;
}

interface StartRunBody {
	resume?: unknown;
}

interface ApiEvent {
	id: string;
	seq: number;
	timestamp: string;
	type: string;
	runId: string;
	data: unknown;
}

const activeChildren = new Map<string, ChildProcess>();
const subscribers = new Map<string, Set<ServerResponse>>();

function corsHeaders(): Record<string, string> {
	const origin = allowedOrigin();
	if (!origin) return {};
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, Last-Event-ID, Authorization, X-GeoRSI-Token",
		"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
		Vary: "Origin",
	};
}

function json(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders() });
	res.end(payload);
}

function errorResponse(res: ServerResponse, status: number, code: string, message: string, details?: unknown): void {
	// A failure after the headers went out (SSE stream, file body) cannot be turned
	// into a JSON error any more; a second writeHead would throw inside the outer
	// catch and take the whole process down as an unhandled rejection.
	if (res.headersSent) { res.destroy(); return; }
	json(res, status, { error: { code, message, ...(details === undefined ? {} : { details }), timestamp: new Date().toISOString() } });
}

function cors(res: ServerResponse): void {
	for (const [name, value] of Object.entries(corsHeaders())) res.setHeader(name, value);
}

function presentedToken(req: IncomingMessage): string | undefined {
	const header = req.headers.authorization;
	if (typeof header === "string" && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, "").trim();
	const custom = req.headers["x-georsi-token"];
	return typeof custom === "string" ? custom.trim() : undefined;
}

function authorized(req: IncomingMessage): boolean {
	const required = apiToken();
	if (!required) return true;
	const token = presentedToken(req);
	if (!token) return false;
	const expected = Buffer.from(required);
	const actual = Buffer.from(token);
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function capacityExceeded(): boolean {
	return activeChildren.size >= MAX_CONCURRENT_RUNS;
}

/** Read `[offset, offset+limit)` of a file without loading the whole log into memory. */
function readFileSlice(file: string, offset: number, limit: number): { chunk: Buffer; totalBytes: number } {
	if (!existsSync(file)) return { chunk: Buffer.alloc(0), totalBytes: 0 };
	const totalBytes = statSync(file).size;
	const start = Math.min(totalBytes, Math.max(0, offset));
	const length = Math.max(0, Math.min(limit, totalBytes - start));
	if (!length) return { chunk: Buffer.alloc(0), totalBytes };
	const fd = openSync(file, "r");
	try {
		const chunk = Buffer.alloc(length);
		const read = readSync(fd, chunk, 0, length, start);
		return { chunk: chunk.subarray(0, read), totalBytes };
	} finally { closeSync(fd); }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	let text = "";
	for await (const chunk of req) {
		text += String(chunk);
		if (text.length > 2_000_000) throw new Error("request body too large");
	}
	if (!text.trim()) return {};
	try { return JSON.parse(text); } catch { throw new Error("request body must be valid JSON"); }
}

function isRunMode(value: unknown): value is RunMode {
	return value === "research-live" || value === "research-demo" || value === "evolve";
}

function isAction(value: unknown): value is Action {
	return value === "stop";
}

function safeRunId(value: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(value)) throw new Error("invalid run id");
	return value;
}

function runDir(id: string): string {
	const safe = safeRunId(id);
	const dir = resolve(RUNS_ROOT, safe);
	if (!dir.toLowerCase().startsWith(RUNS_ROOT.toLowerCase() + "\\") && !dir.startsWith(RUNS_ROOT + "/")) throw new Error("invalid run path");
	return dir;
}

function metadataPath(id: string): string { return join(runDir(id), "api-run.json"); }

function readJsonFile<T>(path: string): T | null {
	try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}

function writeMetadata(record: RunRecord): void {
	mkdirSync(runDir(record.id), { recursive: true });
	// tmp + rename: a crash mid-write must never leave a truncated record that makes
	// the run vanish from the API while its child keeps running on the host.
	atomicWriteJson(metadataPath(record.id), record);
}

function loadRecord(id: string): RunRecord | null {
	return readJsonFile<RunRecord>(metadataPath(id));
}

function listRecords(): RunRecord[] {
	if (!existsSync(RUNS_ROOT)) return [];
	const records: RunRecord[] = [];
	for (const entry of readdirSync(RUNS_ROOT, { withFileTypes: true })) {
		// CLI runs and test fixtures share this root, but are not API resources.
		if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(entry.name)) continue;
		const record = loadRecord(entry.name);
		if (record && record.id === entry.name) records.push(record);
	}
	return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function listConfigs(): unknown[] {
	const configRoot = join(ROOT, "config");
	const describe = (id: string, name: string, file: string): Record<string, unknown> => {
			const raw = readJsonFile<Record<string, unknown>>(file) ?? {};
			const researchModel = raw.research_model && typeof raw.research_model === "object" ? raw.research_model as Record<string, unknown> : {};
			return {
				id,
				name,
				kind: name.endsWith(".problems.json") ? "problem-suite" : "run",
				networkMode: typeof raw.network_mode === "string" ? raw.network_mode : null,
				executionBackend: typeof raw.execution_backend === "string" ? raw.execution_backend : null,
				generations: typeof raw.generations === "number" ? raw.generations : null,
				proposals: typeof raw.proposals === "number" ? raw.proposals : null,
				researchModel: {
					gateway: typeof researchModel.gateway === "string" ? researchModel.gateway : null,
					model: typeof researchModel.model === "string" ? researchModel.model : null,
					thinkingLevel: typeof researchModel.thinking_level === "string" ? researchModel.thinking_level : null,
				},
			};
		};
	const entries: Record<string, unknown>[] = [];
	const defaultFile = join(ROOT, "config.json");
	if (existsSync(defaultFile)) entries.push(describe("default", "config.json", defaultFile));
	if (existsSync(configRoot)) {
		for (const name of readdirSync(configRoot)) {
			const lower = name.toLowerCase();
			// Mission templates, benchmark manifests, model profiles, and problem
			// suite files are separate resources. They are not valid --config
			// values for a run and should not appear in a run-config selector.
			if (!lower.endsWith(".json") || lower.endsWith(".problems.json") || lower === "model-profiles.json" || lower === "research-benchmark-manifest.json" || lower.startsWith("research-mission-")) continue;
			entries.push(describe(name.slice(0, -5), name, join(configRoot, name)));
		}
	}
	return entries.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function listMissionTemplates(): unknown[] {
	const configRoot = join(ROOT, "config");
	if (!existsSync(configRoot)) return [];
	return readdirSync(configRoot)
		.filter((name) => /^research-mission-[A-Za-z0-9_-]+\.json$/.test(name))
		.map((name) => {
			const mission = readJsonFile<ResearchMission>(join(configRoot, name));
			const issues = validateMission(mission);
			return {
				id: name.slice(0, -5),
				name,
				missionId: mission?.id ?? null,
				question: mission?.question ?? null,
				scope: mission?.scope ?? null,
				taskFamily: mission?.taskProfile?.family ?? null,
				networkMode: mission?.taskProfile?.networkMode ?? null,
				requiredStages: mission?.taskProfile?.requiredStages ?? [],
				deliverables: mission?.requiredDeliverables ?? [],
				valid: issues.length === 0,
				issues,
			};
		})
		.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function missionTemplate(id: string): { name: string; mission: ResearchMission } | null {
	if (!/^research-mission-[A-Za-z0-9_-]+$/.test(id)) return null;
	const name = `${id}.json`;
	const mission = readJsonFile<ResearchMission>(join(ROOT, "config", name));
	if (!mission || validateMission(mission).length > 0) return null;
	return { name, mission };
}

function validateMission(mission: ResearchMission | null): string[] {
	if (!mission || typeof mission !== "object") return ["mission must be a JSON object"];
	// Shape pre-check first: validateResearchMission assumes the top-level fields
	// exist, so client garbage must be answered with named issues, not the raw
	// text of a TypeError from undefined property access.
	const required: [keyof ResearchMission, string][] = [["id", "string"], ["question", "string"], ["scope", "string"], ["estimands", "array"], ["units", "array"], ["successCriteria", "array"], ["requiredDeliverables", "array"]];
	const issues: string[] = [];
	for (const [field, kind] of required) {
		const value = (mission as unknown as Record<string, unknown>)[field as string];
		if (value === undefined || value === null) issues.push(`mission.${field} is required`);
		else if (kind === "string" && typeof value !== "string") issues.push(`mission.${field} must be a string`);
		else if (kind === "array" && !Array.isArray(value)) issues.push(`mission.${field} must be an array`);
	}
	if (issues.length > 0) return issues;
	try { return validateResearchMission(mission); } catch (error) { return [error instanceof Error ? error.message : "mission shape is invalid"]; }
}

/**
 * Ledger parse cache. readResearchLedger re-verifies the whole hash chain on every
 * call; the history list (100 runs every 10 s) and every SSE poll tick (500 ms per
 * subscriber) would otherwise re-hash every event of every run. Keyed on the file's
 * (mtime, size) so a new append invalidates it; bounded so idle runs age out.
 */
const LEDGER_CACHE_LIMIT = 64;
const ledgerCache = new Map<string, { mtimeMs: number; size: number; events: ResearchEvent[] }>();

function parseLedger(id: string): ResearchEvent[] {
	const ledger = join(runDir(id), "events.jsonl");
	if (!existsSync(ledger)) return [];
	const stat = statSync(ledger);
	const cached = ledgerCache.get(ledger);
	if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.events;
	const events = readResearchLedger(ledger).events;
	ledgerCache.delete(ledger);
	ledgerCache.set(ledger, { mtimeMs: stat.mtimeMs, size: stat.size, events });
	if (ledgerCache.size > LEDGER_CACHE_LIMIT) ledgerCache.delete(ledgerCache.keys().next().value!);
	return events;
}

function readPlan(id: string): ResearchWorkGraph | null {
	return readJsonFile<ResearchWorkGraph>(join(runDir(id), "plan.json"));
}

function readResult(id: string): Record<string, unknown> | null {
	const dir = runDir(id);
	const score = readJsonFile<Record<string, unknown>>(join(dir, "research-score.json"));
	const manifest = readJsonFile<Record<string, unknown>>(join(dir, "research-manifest.json"));
	const replay = readJsonFile<Record<string, unknown>>(join(dir, "replay.json"));
	if (!score && !manifest && !replay) return null;
	return { score, manifestHash: manifest?.manifestHash ?? null, replay };
}

function deriveStatus(record: RunRecord): RunStatus {
	if (activeChildren.has(record.id)) return record.status;
	if (record.mode === "research-agent" && record.status === "running") {
		// An unmanaged child that SURVIVED a server restart is still alive and
		// writing state — report it as running; only dead children get resolved
		// from the durable workspace phase.
		if (childProcessAlive(record)) return "running";
		const phase = readJsonFile<WorkspaceState>(join(runDir(record.id), "workspace-state.json"))?.phase;
		return phase === "completed" ? "completed" : phase === "cancelled" ? "cancelled" : "failed";
	}
	if (record.status === "queued" || record.status === "running" || record.status === "pausing" || record.status === "stopping") {
		if (record.exitCode !== undefined) return record.exitCode === 0 ? "completed" : "failed";
	}
	return record.status;
}

/** Signal-0 existence probe (EPERM still proves the pid is alive on Windows). */
function pidAlive(pid: number | undefined): boolean {
	if (typeof pid !== "number" || pid <= 0) return false;
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/**
 * Two-factor child liveness (#37): a bare signal-0 pid probe only proves SOME
 * process holds that pid — after a silent child death the OS can reuse the
 * number and the probe then reports a dead run as running forever. The child
 * rewrites heartbeat.json every 5 s (src/run.ts), which a reused pid cannot
 * fake. Runs spawned before the heartbeat existed carry no file at all and fall
 * back to the pid probe alone.
 */
const HEARTBEAT_STALE_MS = 90_000;

function heartbeatAgeMs(id: string): number | null {
	try { return Date.now() - statSync(join(runDir(id), "heartbeat.json")).mtimeMs; }
	catch { return null; }
}

function childProcessAlive(record: RunRecord): boolean {
	if (activeChildren.has(record.id)) return true; // managed handle is authoritative
	if (!pidAlive(record.pid)) return false;
	const age = heartbeatAgeMs(record.id);
	return age === null || age <= HEARTBEAT_STALE_MS;
}

/**
 * A recorded pid that is alive while its heartbeat is stale is either our own
 * hung child or an innocent victim of pid reuse. Either way, relaunching beside
 * it would put two writers on one run dir; terminating is the lesser evil, and
 * it only ever fires for a pid this server spawned and recorded whose heartbeat
 * file has gone quiet.
 */
function terminateStaleChild(record: RunRecord): void {
	if (activeChildren.has(record.id)) return;
	const pid = record.pid;
	if (typeof pid !== "number" || pid <= 0 || !pidAlive(pid)) return;
	const age = heartbeatAgeMs(record.id);
	if (age === null || age <= HEARTBEAT_STALE_MS) return;
	try {
		process.kill(pid);
		record.error = `stale child (pid ${String(pid)}, no heartbeat for ${Math.round(age / 1000)}s) was terminated before relaunch`;
	} catch { /* already gone */ }
}

/**
 * Startup sweep: the API server loses its ChildProcess handles when it exits,
 * but spawned children SURVIVE it on Windows. Without this sweep, records stay
 * "running" forever (zombies) and /start could double-launch a live run.
 * Alive-but-unmanaged runs keep their status with an explicit note; dead ones
 * resolve to failed with an honest error.
 */
function sweepOrphanedRuns(): void {
	if (!existsSync(RUNS_ROOT)) return;
	for (const record of listRecords()) {
		if (record.status !== "queued" && record.status !== "running" && record.status !== "pausing" && record.status !== "stopping") continue;
		// A research-agent run may have finished writing its final state before the
		// server died; trust the durable workspace phase over the lost handle.
		if (record.mode === "research-agent") {
			const phase = readJsonFile<WorkspaceState>(join(runDir(record.id), "workspace-state.json"))?.phase;
			if (phase === "completed") { record.status = "completed"; record.exitCode = record.exitCode ?? 0; record.finishedAt = record.finishedAt ?? new Date().toISOString(); record.updatedAt = record.finishedAt; writeMetadata(record); continue; }
			if (phase === "cancelled") { record.status = "cancelled"; record.finishedAt = record.finishedAt ?? new Date().toISOString(); record.updatedAt = record.finishedAt; writeMetadata(record); continue; }
		}
		if (childProcessAlive(record)) {
			const note = "unmanaged: API server restarted while this run was active";
			if (record.error !== note) {
				record.error = note;
				record.updatedAt = new Date().toISOString();
				writeMetadata(record);
			}
			continue;
		}
		record.status = "failed";
		if (!record.error) {
			const age = heartbeatAgeMs(record.id);
			record.error = age !== null
				? `run did not finish: child stopped heart-beating ${Math.round(age / 1000)}s ago (died or hung while the API server was down)`
				: "run did not finish: API server restarted while it was active";
		}
		record.finishedAt = record.finishedAt ?? new Date().toISOString();
		record.updatedAt = record.finishedAt;
		record.exitCode = record.exitCode ?? null;
		writeMetadata(record);
	}
}

function snapshot(record: RunRecord): RunSnapshot {
	const status = deriveStatus(record);
	const workspace = readJsonFile<WorkspaceState>(join(runDir(record.id), "workspace-state.json"));
	const plan = readPlan(record.id);
	const events = parseLedger(record.id);
	const nodes = plan?.nodes ?? [];
	const completedNodes = nodes.filter((n) => n.state === "completed").length;
	const active = nodes.filter((n) => n.state === "running" || n.state === "verifying");
	const current = active[0] ?? nodes.find((n) => n.state === "failed") ?? null;
	const now = Date.now();
	const started = record.startedAt ? Date.parse(record.startedAt) : Date.parse(record.createdAt);
	const finished = record.finishedAt ? Date.parse(record.finishedAt) : now;
	const evidenceIndex = readJsonFile<unknown[]>(join(runDir(record.id), "evidence-index.json"));
	const result = readResult(record.id);
	const totalNodes = nodes.length;
	return {
		id: record.id,
		name: record.name,
		mode: record.mode,
		status,
		phase: workspace?.phase ?? current?.kind ?? (status === "completed" ? "completed" : status),
		progress: { completedNodes, totalNodes, percent: totalNodes ? Math.round((completedNodes / totalNodes) * 100) : result ? 100 : 0 },
		timing: { createdAt: record.createdAt, ...(record.startedAt ? { startedAt: record.startedAt } : {}), updatedAt: record.updatedAt, ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}), elapsedSeconds: Math.max(0, Math.floor((finished - started) / 1000)) },
		usage: { evidenceCount: evidenceIndex?.length ?? 0, activeNodes: active.length, totalEvents: events.length },
		currentNode: current ? { id: current.id, kind: current.kind, title: current.title, state: current.state, attempts: current.attempts, startedAt: current.startedAt } : null,
		result,
		...(workspace ? { workspace, error: workspace.error } : {}),
		...(record.error ? { error: record.error } : {}),
	};
}

function emit(id: string, event: ApiEvent): void {
	const listeners = subscribers.get(id);
	if (!listeners) return;
	// Transient log/control/end events must not replace the durable ledger cursor.
	const encoded = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
	for (const res of listeners) {
		try { res.write(encoded); } catch { listeners.delete(res); }
	}
}

function eventFromLedger(id: string, event: ResearchEvent, index: number): ApiEvent {
	return { id: String(event.seq ?? index + 1), seq: event.seq ?? index + 1, timestamp: event.timestamp, type: event.type, runId: id, data: { nodeId: event.nodeId, status: event.status, actor: event.actor, payload: event.payload, artifactIds: event.artifactIds } };
}

function startRun(record: RunRecord, args: string[]): void {
	if (activeChildren.has(record.id)) throw new Error("run is already active");
	if (!isRunMode(record.mode) && record.mode !== "research-agent") throw new Error(`${String(record.mode)} runs are no longer managed by the API`);
	// Keep the control channel inside the run directory and pass it to modes
	// that support cooperative process control.  Without this, /actions would
	// write a file that the child process never watches.
	const controlPath = join(runDir(record.id), "control.json");
	mkdirSync(runDir(record.id), { recursive: true });
	if (record.mode === "research-live") {
		writeFileSync(controlPath, "", "utf8");
		args = [...args, "--control", controlPath];
	}
	// research-agent reads control.json directly from its run dir; clear any stale
	// stop flag so a fresh start does not instantly abort.
	if (record.mode === "research-agent") writeFileSync(controlPath, "", "utf8");
	record.status = "running";
	delete record.finishedAt;
	delete record.exitCode;
	delete record.error;
	record.startedAt = new Date().toISOString();
	record.updatedAt = record.startedAt;
	record.command = args;
	writeMetadata(record);
	const child = spawn(process.execPath, [TSX_CLI, RUN_TS, ...args], {
		cwd: ROOT,
		env: { ...process.env, PYTHONIOENCODING: "utf-8" },
		windowsHide: true,
	});
	record.pid = child.pid;
	activeChildren.set(record.id, child);
	writeMetadata(record);
	// Child output only has to bump updatedAt; rewriting the whole record on every
	// stdout chunk turned a chatty child into thousands of metadata writes. Coalesce
	// into one trailing write and flush unconditionally on exit.
	let metadataTimer: ReturnType<typeof setTimeout> | null = null;
	const flushMetadata = (): void => {
		if (metadataTimer) { clearTimeout(metadataTimer); metadataTimer = null; }
		Object.assign(record, loadRecord(record.id) ?? {});
		record.updatedAt = new Date().toISOString();
		writeMetadata(record);
	};
	const appendOutput = (chunk: Buffer): void => {
		const text = chunk.toString("utf8");
		appendFileSync(join(runDir(record.id), "api-stream.log"), text);
		if (!metadataTimer) metadataTimer = setTimeout(flushMetadata, 500);
		emit(record.id, { id: `log-${Date.now()}`, seq: Date.now(), timestamp: new Date().toISOString(), type: "log", runId: record.id, data: { text } });
	};
	child.stdout.on("data", appendOutput);
	child.stderr.on("data", appendOutput);
	child.on("error", (error) => {
		if (metadataTimer) { clearTimeout(metadataTimer); metadataTimer = null; }
		record.status = "failed";
		record.error = error.message;
		record.exitCode = 1;
		record.finishedAt = new Date().toISOString();
		record.updatedAt = record.finishedAt;
		activeChildren.delete(record.id);
		writeMetadata(record);
		emit(record.id, { id: `end-${Date.now()}`, seq: Date.now(), timestamp: new Date().toISOString(), type: "run_end", runId: record.id, data: { status: record.status, error: record.error } });
	});
	child.on("close", (code, signal) => {
		if (metadataTimer) { clearTimeout(metadataTimer); metadataTimer = null; }
		Object.assign(record, loadRecord(record.id) ?? {});
		record.exitCode = code;
		record.finishedAt = new Date().toISOString();
		record.updatedAt = record.finishedAt;
		// Exit-code semantics are per-mode: research-live exits 2 for a completed
		// but honestly-ineligible package, evolve exits 2 when no candidate is
		// promoted — both are completed outcomes, not failures. research-demo's
		// code 2 is a genuine replay failure.
		const completedOutcome = code === 0 || ((record.mode === "research-live" || record.mode === "evolve") && code === 2);
		record.status = record.status === "stopping" || record.status === "cancelled" ? "cancelled" : completedOutcome ? "completed" : "failed";
		if (signal) record.error = `process exited by ${signal}`;
		activeChildren.delete(record.id);
		writeMetadata(record);
		emit(record.id, { id: `end-${Date.now()}`, seq: Date.now(), timestamp: new Date().toISOString(), type: "run_end", runId: record.id, data: { status: record.status, exitCode: code, signal } });
	});
}

function configPath(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string") throw new Error("config must be a config name, not a path");
	const configName = value.endsWith(".json") ? value.slice(0, -5) : value;
	if (!/^[A-Za-z0-9_-]+$/.test(configName)) throw new Error("config must be a config name, not a path");
	if (configName === "default") {
		const defaultFile = join(ROOT, "config.json");
		if (!existsSync(defaultFile)) throw new Error("config not found: default");
		return defaultFile;
	}
	const candidate = join(ROOT, "config", `${configName}.json`);
	if (!existsSync(candidate)) throw new Error(`config not found: ${value}`);
	return candidate;
}

function buildCommand(record: RunRecord, body: CreateRunBody, missionPath?: string): string[] {
	const config = configPath(body.config ?? record.configName);
	// The public API keeps a stable resource mode name while the CLI retains
	// its historical `research-evolve` command spelling.
	const args: string[] = [record.mode === "evolve" ? "research-evolve" : String(record.mode)];
	if (config) args.push("--config", config);
	// research-evolve parses --run-prefix (its campaign child runs land under
	// runs/<prefix>-baseline, runs/<prefix>-cand1, ...); --run-name is not a flag
	// there and would be silently ignored.
	if (record.mode === "evolve") args.push("--run-prefix", record.id);
	else args.push("--run-name", record.id);
	if (record.mode === "research-live") {
		if (!missionPath) throw new Error("research-live requires mission");
		args.push("--mission", missionPath);
	} else if (record.mode === "research-agent") {
		args.push("--run-dir", runDir(record.id));
	}
	return args;
}

function startArgs(record: RunRecord, resume: boolean): string[] {
	const args = buildCommand(record, { config: record.configName }, record.mode === "research-live" ? join(runDir(record.id), "mission-input.json") : undefined);
	if (resume) {
		if (record.mode === "research-live") {
			if (existsSync(join(runDir(record.id), "plan.json"))) args.push("--resume", runDir(record.id));
		} else if (record.mode === "research-agent") {
			// Manual retry after a failure (e.g. gateway outage): the agent restores
			// its checkpointed graph/state/evidence and re-executes only what did not
			// finish — with whatever gateway the config now points at.
			if (!existsSync(join(runDir(record.id), "plan.json")) || !existsSync(join(runDir(record.id), "workspace-state.json"))) throw new Error("resume is not available: no workspace checkpoint for this run");
			args.push("--resume");
		} else throw new Error(`resume is not supported for ${record.mode}`);
	}
	return args;
}

function contentType(name: string): string {
	const ext = extname(name).toLowerCase();
	return ext === ".json" ? "application/json"
		: ext === ".md" || ext === ".txt" ? "text/plain; charset=utf-8"
		: ext === ".csv" ? "text/csv; charset=utf-8"
		: ext === ".tif" || ext === ".tiff" ? "image/tiff"
		: ext === ".png" ? "image/png"
		: "application/octet-stream";
}

function listDeliverables(id: string): unknown[] {
	const dir = runDir(id);
	const names = ["report.md", "presentation.md", "defense.json", "research-score.json", "runtime-attestation.json", "replay.json", "evidence-index.json", "research-manifest.json", "package-seal.json"];
	return names.filter((name) => existsSync(join(dir, name))).map((name) => {
		const stat = statSync(join(dir, name));
		return { id: name.replace(/\.[^.]+$/, ""), name, path: name, mediaType: contentType(name), bytes: stat.size, status: "ready", downloadUrl: `${API_PREFIX}/research-runs/${encodeURIComponent(id)}/deliverables/${encodeURIComponent(name)}/content` };
	});
}

/**
 * Gateway switches serialize per config file. Both the CLI and this endpoint used
 * to share ONE fixed temp filename: two concurrent switches could validate each
 * other's payload, rename the wrong file in, or rm the other's temp mid-flight.
 */
const gatewaySwitchQueue = new Map<string, Promise<unknown>>();
async function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
	const previous = gatewaySwitchQueue.get(key) ?? Promise.resolve();
	const next = previous.catch(() => undefined).then(task);
	gatewaySwitchQueue.set(key, next);
	try { return await next; }
	finally { if (gatewaySwitchQueue.get(key) === next) gatewaySwitchQueue.delete(key); }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
	cors(res);
	if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
	const url = new URL(req.url ?? "/", "http://localhost");
	const path = url.pathname.replace(/\/+$/, "") || "/";
	const publicRoute = path === "/" || path === "/api" || path === "/api/v1" || path === "/healthz" || path === "/readyz";
	if (!publicRoute && !authorized(req)) {
		req.resume();
		errorResponse(res, 401, "UNAUTHORIZED", "this API requires the shared token (Authorization: Bearer <GEORSI_API_TOKEN> or X-GeoRSI-Token)");
		return;
	}
	if (req.method === "GET" && (path === "/" || path === "/api" || path === "/api/v1")) {
		// Humans opening the root in a browser get a service index instead of a 404.
		json(res, 200, {
			service: "georsi-api",
			version: 1,
			message: "GeoRSI local HTTP API — pure JSON, no UI served here.",
			auth: apiToken() ? "shared token required (Authorization: Bearer … or X-GeoRSI-Token)" : "none (loopback-only deployment)",
			endpoints: {
				health: "/healthz",
				ready: "/readyz",
				configs: `${API_PREFIX}/configs`,
				missionTemplates: `${API_PREFIX}/research-missions`,
				gateways: `${API_PREFIX}/gateways (GET list, POST /select)`,
				uploads: `${API_PREFIX}/uploads?name= (POST, streamed)`,
				researchRequests: `${API_PREFIX}/research-requests (POST natural-language question → research-agent run)`,
				runs: `${API_PREFIX}/research-runs`,
				runExample: `${API_PREFIX}/research-runs/{id}`,
				runEvents: `${API_PREFIX}/research-runs/{id}/events (SSE)`,
				runActions: `${API_PREFIX}/research-runs/{id}/actions (stop)`,
				runFeedback: `${API_PREFIX}/research-runs/{id}/feedback (directions for research-agent)`,
				runRounds: `${API_PREFIX}/research-runs/{id}/rounds, /rounds/{n}/report`,
				runDeliverables: `${API_PREFIX}/research-runs/{id}/deliverables`,
				runPackage: `${API_PREFIX}/research-runs/{id}/{score|claims|attestation|replay|evidence|mission|workflow|budget|logs|request|directions|experience}`,
				experience: `${API_PREFIX}/experience (GET list; GET /{id}; POST /{id}/review)`,
			},
			docs: "docs/API.md",
			createRunExample: { method: "POST", url: `${API_PREFIX}/research-runs`, body: { mode: "research-demo", name: "first run" } },
		});
		return;
	}
	if (req.method === "POST" && path === API_PREFIX + "/uploads") {
		try { json(res, 201, await receiveUpload(req, url.searchParams.get("name") ?? "")); }
		catch (error) { req.resume(); errorResponse(res, 400, "INVALID_UPLOAD", error instanceof Error ? error.message : "upload failed"); }
		return;
	}
	if (req.method === "GET" && path === API_PREFIX + "/gateways") {
		const configFilePath = configPath(process.env.GEORSI_API_DEFAULT_CONFIG ?? "research-competition-luna")!;
		const raw = readJsonFile<Record<string, unknown>>(configFilePath) ?? {};
		const gateways = (raw.research_gateways ?? {}) as Record<string, Record<string, unknown>>;
		const current = (raw.research_model as Record<string, unknown> | undefined)?.gateway;
		const items = Object.keys(gateways).sort().map((name) => {
			const entry = gateways[name]!;
			const credentialEnv = typeof entry.credential_env === "string" ? entry.credential_env : "";
			return {
				id: name,
				provider: String(entry.provider ?? ""),
				model: String(entry.model ?? ""),
				api: String(entry.api ?? ""),
				baseUrl: String(entry.base_url ?? ""),
				thinkingLevel: String(entry.thinking_level ?? ""),
				thinkingEvidence: String(entry.thinking_evidence ?? ""),
				credentialEnv,
				credentialConfigured: !!credentialEnv && !!process.env[credentialEnv],
				current: current === name,
			};
		});
		json(res, 200, { items, note: "switching affects NEW runs; already-running children keep the policy they were spawned with" });
		return;
	}
	if (req.method === "POST" && path === API_PREFIX + "/gateways/select") {
		try {
			const body = (await readJson(req)) as { gateway?: unknown };
			const target = typeof body.gateway === "string" ? body.gateway : "";
			const configFilePath = configPath(process.env.GEORSI_API_DEFAULT_CONFIG ?? "research-competition-luna")!;
			await serialized(configFilePath, async () => {
				const raw = JSON.parse(readFileSync(configFilePath, "utf8")) as Record<string, unknown>;
				const gateways = (raw.research_gateways ?? {}) as Record<string, Record<string, unknown>>;
				if (!gateways[target]) return errorResponse(res, 404, "GATEWAY_NOT_FOUND", `unknown gateway "${target}"`, { registered: Object.keys(gateways).sort() });
				const credentialEnv = String(gateways[target]!.credential_env ?? "");
				if (!credentialEnv || !process.env[credentialEnv]) return errorResponse(res, 400, "GATEWAY_CREDENTIAL_MISSING", `${target} needs ${credentialEnv || "a credential env"} to be set in the API server environment`);
				raw.research_model = { gateway: target };
				// Validate the switched config fully parses before writing (same contract as
				// the research:gateway CLI: unique temp file -> loadConfig -> atomic rename).
				const tempPath = `${configFilePath}.gateway-switch.${process.pid}.${randomBytes(4).toString("hex")}.tmp.json`;
				writeFileSync(tempPath, JSON.stringify(raw, null, 2) + "\n", { encoding: "utf-8", flag: "wx" });
				try {
					const switched = loadConfig(tempPath);
					if (!switched.research_model) throw new Error("expanded config has no research_model");
					const fingerprint = researchModelConfigFingerprint(switched.research_model);
					renameSync(tempPath, configFilePath);
					json(res, 200, { gateway: target, provider: switched.research_model.provider, model: switched.research_model.model, api: switched.research_model.api, fingerprint, note: "new runs use this gateway; running children are unaffected" });
				} catch (error) {
					try { rmSync(tempPath, { force: true }); } catch { /* best effort */ }
					throw error;
				}
			});
		} catch (error) { errorResponse(res, 400, "GATEWAY_SWITCH_FAILED", error instanceof Error ? error.message : String(error)); }
		return;
	}
	if (req.method === "POST" && path === API_PREFIX + "/research-requests") {
		try {
			const body = await readJson(req) as { question?: unknown; uploadIds?: unknown };
			if (typeof body.question !== "string" || !body.question.trim() || body.question.length > 20000) throw new Error("question must contain 1–20000 characters");
			if (body.uploadIds !== undefined && (!Array.isArray(body.uploadIds) || body.uploadIds.length > 8 || body.uploadIds.some((value) => typeof value !== "string"))) throw new Error("uploadIds must contain at most 8 uploaded file IDs");
			const uploadIds = [...new Set((body.uploadIds ?? []) as string[])];
			uploadIds.forEach(getUpload);
			if (capacityExceeded()) return errorResponse(res, 429, "RUN_CAPACITY", `${MAX_CONCURRENT_RUNS} research tasks are already running; wait for a task to finish`);
			const configName = process.env.GEORSI_API_DEFAULT_CONFIG ?? "research-competition-luna";
			configPath(configName);
			const id = `run_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
			const createdAt = new Date().toISOString();
			const record: RunRecord = { id, name: body.question.trim().slice(0, 160), mode: "research-agent", status: "queued", configName, createdAt, updatedAt: createdAt };
			writeMetadata(record);
			writeFileSync(join(runDir(id), "request.json"), JSON.stringify({ question: body.question.trim(), uploadIds }), "utf8");
			startRun(record, buildCommand(record, { config: configName }));
			json(res, 202, { id, name: record.name, status: record.status, mode: record.mode });
		} catch (error) { errorResponse(res, 400, "INVALID_RESEARCH_REQUEST", error instanceof Error ? error.message : "request failed"); }
		return;
	}
	// ---- experience layer (store only; routing is a later stage) ----
	if (req.method === "GET" && path === API_PREFIX + "/experience") {
		const store = new ExperienceStore();
		const status = url.searchParams.get("status");
		const family = url.searchParams.get("family");
		const signature = url.searchParams.get("signature");
		const pending = url.searchParams.get("pending") === "1";
		const items = store.all()
			.filter((record) => (!status || record.status === status) && (!family || record.family === family) && (!signature || record.signature.exact === signature) && (!pending || record.gates.human === "pending"))
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
			.slice(0, 500)
			.map((record) => ({ id: record.id, status: record.status, family: record.family, tier: record.tier, signature: record.signature.exact, keywords: record.signature.keywords.slice(0, 8), scienceScore: record.outcome.scienceScore, verifier: record.gates.verifier, replay: record.gates.replay, human: record.gates.human, runId: record.origin.runId, runMode: record.origin.runMode, createdAt: record.createdAt, question: record.origin.question?.slice(0, 160) ?? null, failureClass: record.failure?.class ?? null }));
		json(res, 200, { items, index: store.index() });
		return;
	}
	const experienceMatch = new RegExp(`^${API_PREFIX.replaceAll("/", "\\/")}/experience/([^/]+)(?:/(review))?$`).exec(path);
	if (experienceMatch) {
		const store = new ExperienceStore();
		let experienceId: string;
		try { experienceId = decodeURIComponent(experienceMatch[1]!); } catch { return errorResponse(res, 400, "INVALID_EXPERIENCE_ID", "invalid experience id"); }
		if (!/^xp_[A-Za-z0-9_-]{3,160}$/.test(experienceId)) return errorResponse(res, 400, "INVALID_EXPERIENCE_ID", "invalid experience id");
		const record = store.get(experienceId);
		if (!record) return errorResponse(res, 404, "EXPERIENCE_NOT_FOUND", "experience record not found", { id: experienceId });
		if (!experienceMatch[2] && req.method === "GET") { json(res, 200, { record, approvals: store.approvals(experienceId) }); return; }
		if (experienceMatch[2] === "review" && req.method === "POST") {
			try {
				const body = (await readJson(req)) as { decision?: unknown; note?: unknown; actor?: unknown; patch?: unknown };
				if (body.decision !== "accept" && body.decision !== "modify" && body.decision !== "reject") throw new Error("decision must be accept, modify, or reject");
				const at = new Date().toISOString();
				const patch = body.patch && typeof body.patch === "object" ? body.patch as { tier?: string | null; stages?: string[] } : undefined;
				if (patch?.stages !== undefined && (!Array.isArray(patch.stages) || patch.stages.some((stage) => typeof stage !== "string"))) throw new Error("patch.stages must be a string array");
				// Human approval is the operator evidence source: recorded, applied, auditable.
				const updated = store.recordApproval({ id: approvalId(experienceId, at), recordId: experienceId, decision: body.decision, note: typeof body.note === "string" ? body.note.slice(0, 2_000) : "", actor: typeof body.actor === "string" && body.actor.trim() ? body.actor.trim().slice(0, 80) : "workspace-user", at, ...(patch ? { patch } : {}) });
				json(res, 200, { record: updated, approvals: store.approvals(experienceId) });
			} catch (error) { errorResponse(res, 400, "INVALID_REVIEW", error instanceof Error ? error.message : String(error)); }
			return;
		}
		errorResponse(res, 404, "NOT_FOUND", "route not found");
		return;
	}
	if (req.method === "GET" && path === "/healthz") { json(res, 200, { ok: true, service: "georsi-api", time: new Date().toISOString() }); return; }
	if (req.method === "GET" && path === "/readyz") { json(res, existsSync(TSX_CLI) ? 200 : 503, { ok: existsSync(TSX_CLI), runsRoot: RUNS_ROOT, tsx: existsSync(TSX_CLI) }); return; }
	if (req.method === "GET" && path === API_PREFIX + "/configs") { json(res, 200, { items: listConfigs() }); return; }
	if (req.method === "GET" && path === API_PREFIX + "/research-missions") { json(res, 200, { items: listMissionTemplates() }); return; }
	const missionTemplateMatch = new RegExp(`^${API_PREFIX.replaceAll("/", "\\/")}/research-missions/([^/]+)$`).exec(path);
	if (req.method === "GET" && missionTemplateMatch) {
		let templateId: string;
		try { templateId = decodeURIComponent(missionTemplateMatch[1]!); } catch { errorResponse(res, 400, "INVALID_MISSION_ID", "invalid mission template id"); return; }
		const template = missionTemplate(templateId);
		if (!template) { errorResponse(res, 404, "MISSION_TEMPLATE_NOT_FOUND", "mission template not found", { id: templateId }); return; }
		json(res, 200, { id: templateId, name: template.name, mission: template.mission });
		return;
	}
	if (path === API_PREFIX + "/research-runs" && req.method === "GET") {
		const status = url.searchParams.get("status");
		const search = url.searchParams.get("search")?.toLowerCase();
		const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
		const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? 20) || 20));
		const filtered = listRecords().filter((r) => (!status || deriveStatus(r) === status) && (!search || r.name.toLowerCase().includes(search)));
		const items = filtered.slice((page - 1) * pageSize, page * pageSize);
		json(res, 200, { items: items.map((r) => { const s = snapshot(r); return { id: r.id, name: r.name, mode: r.mode, status: s.status, progress: s.progress.percent, currentPhase: s.phase, createdAt: r.createdAt, startedAt: r.startedAt, updatedAt: r.updatedAt }; }), pagination: { page, pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / pageSize), hasNext: page * pageSize < filtered.length, hasPrevious: page > 1 } });
		return;
	}
	if (path === API_PREFIX + "/research-runs" && req.method === "POST") {
		try {
			const body = (await readJson(req)) as CreateRunBody;
			const mode = body.mode ?? "research-live";
			if (!isRunMode(mode)) throw new Error("mode must be research-live, research-demo, or evolve");
			const rawConfigName = body.config === undefined ? process.env.GEORSI_API_DEFAULT_CONFIG : String(body.config);
			configPath(rawConfigName);
			const configName = rawConfigName?.endsWith(".json") ? rawConfigName.slice(0, -5) : rawConfigName;
			const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 160) : "Untitled research";
			const autoStart = body.autoStart !== false;
			if (autoStart && capacityExceeded()) return errorResponse(res, 429, "RUN_CAPACITY", `${MAX_CONCURRENT_RUNS} runs are already active; create with autoStart=false or wait for one to finish`);
			const id = `run_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
			const createdAt = new Date().toISOString();
			const record: RunRecord = { id, name, mode, status: "queued", createdAt, updatedAt: createdAt, ...(configName ? { configName } : {}) };
			let missionPath: string | undefined;
			if (mode === "research-live") {
				if (!body.mission || typeof body.mission !== "object") throw new Error("mission is required for research-live");
				const mission = body.mission as ResearchMission;
				// validateMission() wraps validateResearchMission in try/catch: a payload
				// missing required fields must surface as clean 422 issues, never as a
				// TypeError from undefined property access.
				const issues = validateMission(mission);
				if (issues.length) return errorResponse(res, 422, "INVALID_MISSION", "mission validation failed", issues);
				record.missionId = mission.id;
				missionPath = join(runDir(id), "mission-input.json");
				mkdirSync(runDir(id), { recursive: true });
				writeFileSync(missionPath, JSON.stringify(mission, null, 2) + "\n", "utf8");
			}
			writeMetadata(record);
			if (autoStart) startRun(record, buildCommand(record, body, missionPath));
			json(res, 202, { id, name, mode, status: record.status, createdAt, links: { self: `${API_PREFIX}/research-runs/${id}`, events: `${API_PREFIX}/research-runs/${id}/events`, workflow: `${API_PREFIX}/research-runs/${id}/workflow`, ...(mode === "research-live" ? { mission: `${API_PREFIX}/research-runs/${id}/mission` } : {}) } });
		} catch (error) { errorResponse(res, 400, "INVALID_REQUEST", error instanceof Error ? error.message : String(error)); }
		return;
	}

	const match = new RegExp(`^${API_PREFIX.replaceAll("/", "\\/")}/research-runs/([^/]+)(?:/(.*))?$`).exec(path);
	if (!match) { errorResponse(res, 404, "NOT_FOUND", "route not found"); return; }
	let id: string;
	try { id = safeRunId(decodeURIComponent(match[1]!)); } catch { errorResponse(res, 400, "INVALID_RUN_ID", "invalid run id"); return; }
	const record = loadRecord(id);
	if (!record) { errorResponse(res, 404, "RUN_NOT_FOUND", "research run not found", { id }); return; }
	const tail = match[2] ?? "";

	if (!tail && req.method === "GET") { json(res, 200, snapshot(record)); return; }
	if (tail === "start" && req.method === "POST") {
		try {
			const body = (await readJson(req)) as StartRunBody;
			const resume = body.resume === true;
			if (activeChildren.has(id)) return errorResponse(res, 409, "RUN_ALREADY_ACTIVE", "run is already active");
			if (childProcessAlive(record)) return errorResponse(res, 409, "RUN_ALREADY_ACTIVE", "run process is still alive (unmanaged after an API server restart); stop it by pid before restarting here");
			// Zombie (#36/#37): the recorded pid lives on but its heartbeat went
			// stale — kill it before relaunch so two writers never share the run dir.
			terminateStaleChild(record);
			const currentStatus = deriveStatus(record);
			const resumable = resume && (currentStatus === "failed" || currentStatus === "cancelled" || currentStatus === "running" || currentStatus === "queued" || currentStatus === "paused");
			if (currentStatus !== "queued" && !resumable) return errorResponse(res, 409, "RUN_NOT_STARTABLE", `run cannot be started from status ${currentStatus}`);
			if (capacityExceeded()) return errorResponse(res, 429, "RUN_CAPACITY", `${MAX_CONCURRENT_RUNS} runs are already active; wait for one to finish`);
			startRun(record, startArgs(record, resume));
			json(res, 202, { runId: id, status: record.status, resume, links: { self: `${API_PREFIX}/research-runs/${id}`, events: `${API_PREFIX}/research-runs/${id}/events` } });
		} catch (error) { errorResponse(res, 400, "INVALID_START", error instanceof Error ? error.message : String(error)); }
		return;
	}
	if (tail === "workflow" && req.method === "GET") { json(res, 200, readPlan(id) ?? { version: 1, missionId: record.missionId ?? id, nodes: [] }); return; }
	// Three-layer budget view: plan-time fixed envelopes vs ledger-derived usage per node
	// and run-wide, plus the engine's tightening pressure — the frontend's budget dashboard.
	if (tail === "budget" && req.method === "GET") { json(res, 200, buildBudgetReport({ plan: readPlan(id), events: parseLedger(id), nowMs: Date.now() })); return; }
	const nodeActivityMatch = /^nodes\/([A-Za-z0-9_-]{1,80})\/activity$/.exec(tail);
	if (nodeActivityMatch && req.method === "GET") {
		const plan = readPlan(id);
		const node = plan?.nodes.find((candidate) => candidate.id === nodeActivityMatch[1]);
		if (!plan || !node) return errorResponse(res, 404, "NODE_NOT_FOUND", "node not found in this run's work graph", { id: nodeActivityMatch[1] });
		const events = parseLedger(id).filter((event) => event.nodeId === node.id);
		const sessionFile = join(runDir(id), "sessions", `${node.id}.jsonl`);
		let session: Array<{ t?: string; kind: string; detail?: string; isError?: boolean }> = [];
		if (existsSync(sessionFile)) {
			try {
				const text = readFileSync(sessionFile, "utf8");
				const lines = text.split("\n").filter(Boolean);
				// Tail-bounded: the UI shows the end of the stream; a capped chatty session must
				// not ship megabytes on every poll.
				session = lines.slice(-2_000).flatMap((line) => { try { return [JSON.parse(line) as { t?: string; kind: string; detail?: string; isError?: boolean }]; } catch { return []; } });
			} catch { /* unreadable telemetry degrades to the ledger view */ }
		}
		const snapshot = readJsonFile<{ executor?: { submissions?: { nodeId: string; submission: { summary: string; artifactIds: string[]; decisions: unknown[] } }[] } }>(join(runDir(id), "executor_state.json"));
		const submission = snapshot?.executor?.submissions?.find((entry) => entry.nodeId === node.id)?.submission;
		const activity = foldNodeActivity({
			node: { id: node.id, kind: node.kind, title: node.title, state: node.state, attempts: node.attempts },
			events,
			session,
			submission: submission ? { summary: submission.summary, artifactIds: submission.artifactIds, decisions: submission.decisions.length } : null,
		});
		json(res, 200, activity);
		return;
	}
	if (tail === "mission" && req.method === "GET") {
		const missionFile = existsSync(join(runDir(id), "mission.json")) ? join(runDir(id), "mission.json") : join(runDir(id), "mission-input.json");
		const mission = readJsonFile<ResearchMission>(missionFile);
		if (!mission) return errorResponse(res, 404, "MISSION_NOT_FOUND", "mission is not available yet");
		let updatedAt: string | null = null;
		try { updatedAt = statSync(missionFile).mtime.toISOString(); } catch { /* removed between read and stat */ }
		json(res, 200, { mission, source: basename(missionFile), updatedAt });
		return;
	}
	if (tail === "events" && req.method === "GET") {
		res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", ...corsHeaders() });
		const set = subscribers.get(id) ?? new Set<ServerResponse>();
		set.add(res); subscribers.set(id, set);
		let after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0) || 0;
		const flushLedger = (): void => {
			const events = parseLedger(id);
			// Sequence numbers are monotonic (verified on read): nothing past the
			// cursor means nothing to send, without walking the whole ledger again.
			const last = events.length ? (events[events.length - 1]!.seq ?? events.length) : 0;
			if (last <= after) return;
			for (const [index, event] of events.entries()) {
				const seq = event.seq ?? index + 1;
				if (seq <= after) continue;
				res.write(`id: ${seq}\nevent: ${event.type}\ndata: ${JSON.stringify(eventFromLedger(id, event, index))}\n\n`);
				after = seq;
			}
		};
		flushLedger();
		res.write(`event: snapshot\ndata: ${JSON.stringify({ type: "snapshot", runId: id, data: snapshot(record) })}\n\n`);
		const ledgerTimer = setInterval(() => {
			try { flushLedger(); } catch { res.destroy(); }
		}, 500);
		const timer = setInterval(() => { try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch { clearInterval(timer); } }, 15_000);
		res.on("close", () => { clearInterval(timer); clearInterval(ledgerTimer); set.delete(res); if (!set.size) subscribers.delete(id); });
		return;
	}
	if (tail === "actions" && req.method === "POST") {
		try {
			const body = (await readJson(req)) as { action?: unknown };
			if (!isAction(body.action)) throw new Error("action must be stop");
			if (!activeChildren.has(id)) return errorResponse(res, 409, "RUN_NOT_ACTIVE", "run is not active");
			if (record.mode !== "research-live" && record.mode !== "research-agent") {
				return errorResponse(res, 409, "ACTION_UNSUPPORTED", `control is not supported for ${record.mode} runs`);
			}
			record.status = "stopping";
			record.updatedAt = new Date().toISOString();
			writeMetadata(record);
			writeFileSync(join(runDir(id), "control.json"), JSON.stringify({ action: body.action, ts: record.updatedAt }), "utf8");
			const commandId = `cmd_${randomUUID().slice(0, 8)}`;
			emit(id, { id: commandId, seq: Date.now(), timestamp: record.updatedAt, type: "control", runId: id, data: { action: body.action, status: "accepted" } });
			json(res, 202, { commandId, runId: id, action: body.action, status: "accepted" });
		} catch (error) { errorResponse(res, 400, "INVALID_ACTION", error instanceof Error ? error.message : String(error)); }
		return;
	}
	if (tail === "feedback" && req.method === "POST") {
		try {
			const body = (await readJson(req)) as { text?: unknown };
			if (typeof body.text !== "string" || !body.text.trim()) throw new Error("text is required");
			if (record.mode === "research-agent") {
				const phase = readJsonFile<WorkspaceState>(join(runDir(id), "workspace-state.json"))?.phase;
				if (phase && ["finalizing", "completed", "failed", "cancelled"].includes(phase)) return errorResponse(res, 409, "RUN_NOT_ACTIVE", "The research is finalizing or has ended");
				if (!activeChildren.has(id) || !["running", "queued"].includes(deriveStatus(record))) return errorResponse(res, 409, "RUN_NOT_ACTIVE", "This research has ended and no longer accepts directions");
				const direction: Direction = { id: `direction_${randomUUID().replaceAll("-", "")}`, text: body.text.trim().slice(0, 10000), createdAt: new Date().toISOString() };
				appendFileSync(join(runDir(id), "directions.jsonl"), JSON.stringify(direction) + "\n", "utf8");
				json(res, 201, { ...direction, status: "queued", effectiveAt: "next-node" }); return;
			}
			const timestamp = new Date().toISOString();
			appendFileSync(join(runDir(id), "FEEDBACK.md"), `\n[api ${timestamp}] ${body.text.trim().slice(0, 10_000)}\n`, "utf8");
			json(res, 201, { id: `feedback_${randomUUID().slice(0, 8)}`, status: "recorded", effectiveAt: "next-generation" });
		} catch (error) { errorResponse(res, 400, "INVALID_FEEDBACK", error instanceof Error ? error.message : String(error)); }
		return;
	}
	if (tail === "rounds" && req.method === "GET") {
		const workspace = readJsonFile<import("../research/workspace-agent.js").WorkspaceState>(join(runDir(id), "workspace-state.json"));
		const items = (workspace?.iterations ?? []).map((iteration) => {
			const file = `report-round-${iteration.round}.md`;
			const exists = existsSync(join(runDir(id), file));
			return {
				round: iteration.round,
				completed: iteration.completed,
				review: { complete: iteration.complete ?? null, summary: iteration.summary, next: iteration.next ?? null },
				reportAvailable: exists,
				reportUrl: exists ? `${API_PREFIX}/research-runs/${encodeURIComponent(id)}/rounds/${iteration.round}/report` : null,
			};
		});
		json(res, 200, { items });
		return;
	}
	const roundReportMatch = /^rounds\/(\d+)\/report$/.exec(tail);
	if (roundReportMatch && req.method === "GET") {
		const file = join(runDir(id), `report-round-${Number(roundReportMatch[1])}.md`);
		// Read before writeHead: a draft that disappears between the check and the
		// read must become a 404, not a half-sent response.
		let body: Buffer;
		try { body = readFileSync(file); } catch { return errorResponse(res, 404, "ROUND_REPORT_NOT_FOUND", "no report draft for this round"); }
		res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders() });
		res.end(body);
		return;
	}
	if (tail === "directions" && req.method === "GET") {
		const file = join(runDir(id), "directions.jsonl");
		const applied = readJsonFile<WorkspaceState>(join(runDir(id), "workspace-state.json"))?.appliedDirectionIds ?? [];
		const items = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { const d = JSON.parse(line) as Direction; return [{ ...d, status: applied.includes(d.id) ? "applied" : "queued" }]; } catch { return []; } }) : [];
		json(res, 200, { items }); return;
	}
	if (tail === "experience" && req.method === "GET") {
		const value = readJsonFile<Record<string, unknown>>(join(runDir(id), "experience.json"));
		if (!value) return errorResponse(res, 404, "EXPERIENCE_NOT_READY", "no experience has been harvested from this run yet");
		json(res, 200, value); return;
	}
	if (tail === "request" && req.method === "GET") {
		const value = readJsonFile<{ question: string; uploadIds: string[] }>(join(runDir(id), "request.json"));
		if (!value) return errorResponse(res, 404, "REQUEST_NOT_FOUND", "request is not available for this mode");
		// An upload can disappear from the temp store after the fact; the request
		// view must stay readable instead of 500-ing on one missing file.
		const files = value.uploadIds.map((uploadId) => { try { return { available: true, ...getUpload(uploadId) }; } catch { return { id: uploadId, available: false, name: null, bytes: null }; } });
		json(res, 200, { question: value.question, files }); return;
	}
	if (tail === "logs" && req.method === "GET") {
		const file = join(runDir(id), "api-stream.log");
		const totalBytes = existsSync(file) ? statSync(file).size : 0;
		const limit = Math.min(1_000_000, Math.max(1, Number(url.searchParams.get("limit") ?? 200_000) || 200_000));
		const offset = url.searchParams.has("tail")
			? Math.max(0, totalBytes - Math.min(1_000_000, Number(url.searchParams.get("tail")) || 24000))
			: Math.min(totalBytes, Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0));
		// Only the requested window leaves the disk; a multi-megabyte stream log must
		// not be loaded whole on every 2.5 s poll.
		const { chunk } = readFileSlice(file, offset, limit);
		const nextOffset = Math.min(totalBytes, offset + chunk.length);
		json(res, 200, { content: chunk.toString("utf8"), offset, nextOffset, totalBytes, complete: nextOffset >= totalBytes });
		return;
	}
	if (tail === "deliverables" && req.method === "GET") { json(res, 200, { items: listDeliverables(id) }); return; }
	const deliverableMatch = /^deliverables\/([^/]+)\/content$/.exec(tail);
	if (deliverableMatch && req.method === "GET") {
		const name = decodeURIComponent(deliverableMatch[1]!);
		const allowed = new Set(listDeliverables(id).map((item) => (item as { name: string }).name));
		if (!allowed.has(name) || basename(name) !== name) { errorResponse(res, 404, "DELIVERABLE_NOT_FOUND", "deliverable not found"); return; }
		let body: Buffer;
		try { body = readFileSync(join(runDir(id), name)); } catch { return errorResponse(res, 404, "DELIVERABLE_NOT_FOUND", "deliverable not found"); }
		res.writeHead(200, { "Content-Type": contentType(name), "Content-Length": body.length, "Cache-Control": "no-store", ...corsHeaders() });
		res.end(body);
		return;
	}
	if (tail === "evidence" && req.method === "GET") { json(res, 200, { items: readJsonFile<unknown[]>(join(runDir(id), "evidence-index.json")) ?? [] }); return; }
	const evidenceContentMatch = /^evidence\/([^/]+)\/content$/.exec(tail);
	if (evidenceContentMatch && req.method === "GET") {
		const evidenceId = decodeURIComponent(evidenceContentMatch[1]!);
		if (!/^sha256:[a-f0-9]{64}$/.test(evidenceId)) return errorResponse(res, 400, "INVALID_EVIDENCE_ID", "invalid evidence id");
		const refs = readJsonFile<Array<{ id: string; sha256: string; bytes: number; mediaType?: string; logicalName?: string }>>(join(runDir(id), "evidence-index.json")) ?? [];
		const ref = refs.find((item) => item.id === evidenceId && /^[a-f0-9]{64}$/.test(item.sha256));
		if (!ref) return errorResponse(res, 404, "EVIDENCE_NOT_FOUND", "evidence is not indexed for this run");
		// Evidence refs do not carry a media type; derive it from the logical name so
		// figures render in-browser instead of downloading as octet-stream.
		const evidenceMediaType = ref.mediaType ?? (ref.logicalName ? contentType(ref.logicalName) : "application/octet-stream");
		// Same resolver every writer uses (os.tmpdir honours TMPDIR on POSIX; the old
		// TEMP ?? TMP ?? /tmp lookup 404'd evidence on a box with only TMPDIR set).
		const evidenceRoot = join(tmpdir(), "GeoRSI", "evidence", basename(runDir(id)));
		const file = join(evidenceRoot, ref.sha256.slice(0, 2), ref.sha256);
		let body: Buffer;
		try { body = readFileSync(file); } catch { return errorResponse(res, 404, "EVIDENCE_CONTENT_NOT_FOUND", "evidence content is unavailable"); }
		// The id IS the content hash. Serving on a size match alone would let anything
		// that can write the temp store (host-audit runs execute model code there)
		// hand the browser tampered bytes under a matching ETag.
		if (body.length !== ref.bytes || createHash("sha256").update(body).digest("hex") !== ref.sha256) return errorResponse(res, 409, "EVIDENCE_INTEGRITY", "evidence content does not match its content hash");
		res.writeHead(200, { "Content-Type": evidenceMediaType, "Content-Length": String(body.length), ETag: JSON.stringify(evidenceId), "Cache-Control": "no-store", ...corsHeaders() });
		res.end(body);
		return;
	}
	if (tail === "claims" && req.method === "GET") { json(res, 200, { items: readJsonFile<unknown[]>(join(runDir(id), "claims.json")) ?? [] }); return; }
	if (tail === "score" && req.method === "GET") {
		const value = readJsonFile(join(runDir(id), "research-score.json"));
		if (!value) return errorResponse(res, 404, "SCORE_NOT_READY", "research score is not available yet");
		json(res, 200, value); return;
	}
	if (tail === "attestation" && req.method === "GET") {
		const value = readJsonFile(join(runDir(id), "runtime-attestation.json"));
		if (!value) return errorResponse(res, 404, "ATTESTATION_NOT_READY", "runtime attestation is not available yet");
		json(res, 200, value); return;
	}
	if (tail === "replay" && req.method === "GET") {
		const value = readJsonFile(join(runDir(id), "replay.json"));
		if (!value) return errorResponse(res, 404, "REPLAY_NOT_READY", "replay result is not available yet");
		json(res, 200, value); return;
	}
	errorResponse(res, 404, "NOT_FOUND", "route not found");
}

export function createApiServer(): ReturnType<typeof createServer> {
	sweepOrphanedRuns();
	return createServer((req, res) => {
		handle(req, res).catch((error) => errorResponse(res, 500, "INTERNAL_ERROR", error instanceof Error ? error.message : String(error)));
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	// Host development: pick up the repo-root .env (the same file docker-compose reads) so
	// the gateway credential does not have to be exported in every terminal. Variables
	// already in the environment take precedence; the file is gitignored.
	const envFile = join(ROOT, ".env");
	if (existsSync(envFile)) {
		try { process.loadEnvFile(envFile); console.log(`GeoRSI API: loaded ${envFile}`); }
		catch (error) { console.warn(`GeoRSI API: could not load ${envFile}: ${error instanceof Error ? error.message : String(error)}`); }
	}
	const port = Number(process.env.GEORSI_API_PORT ?? DEFAULT_PORT);
	const host = process.env.GEORSI_API_HOST?.trim() || DEFAULT_HOST;
	if (host !== DEFAULT_HOST && host !== "localhost" && host !== "::1" && !apiToken()) {
		console.warn(`GeoRSI API: listening on ${host} WITHOUT GEORSI_API_TOKEN — anyone who can reach this port can start runs and read every artifact`);
	}
	const server = createApiServer();
	server.listen(port, host, () => console.log(`GeoRSI API listening on http://${host}:${port}${apiToken() ? " (token required)" : ""}`));
}
