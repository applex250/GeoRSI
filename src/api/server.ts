/**
 * GeoRSI local HTTP API.
 *
 * This is intentionally a thin adapter around the existing CLI/research
 * runtime.  The browser talks in terms of research runs; it never receives
 * filesystem paths, model credentials, or arbitrary command-line arguments.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT } from "../config.js";
import { validateResearchMission, type ResearchMission, type ResearchWorkGraph } from "../research/contracts.js";
import { readResearchLedger, type ResearchEvent } from "../research/event-ledger.js";

const API_PREFIX = "/api/v1";
const DEFAULT_PORT = 8787;
const RUNS_ROOT = resolve(ROOT, "runs");
const TSX_CLI = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const RUN_TS = join(ROOT, "src", "run.ts");

type RunMode = "research-live" | "research-demo" | "rsi" | "evolve";
type RunStatus = "queued" | "running" | "pausing" | "paused" | "stopping" | "completed" | "failed" | "cancelled";
type Action = "pause" | "resume" | "stop";

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

function json(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, Last-Event-ID",
		"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
	});
	res.end(payload);
}

function errorResponse(res: ServerResponse, status: number, code: string, message: string, details?: unknown): void {
	json(res, status, { error: { code, message, ...(details === undefined ? {} : { details }), timestamp: new Date().toISOString() } });
}

function cors(res: ServerResponse): void {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key, Last-Event-ID");
	res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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
	return value === "research-live" || value === "research-demo" || value === "rsi" || value === "evolve";
}

function isAction(value: unknown): value is Action {
	return value === "pause" || value === "resume" || value === "stop";
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
	writeFileSync(metadataPath(record.id), JSON.stringify(record, null, 2) + "\n", "utf8");
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
	if (!mission) return ["mission file is not valid JSON"];
	try { return validateResearchMission(mission); } catch (error) { return [error instanceof Error ? error.message : "mission shape is invalid"]; }
}

function parseLedger(id: string): ResearchEvent[] {
	const ledger = join(runDir(id), "events.jsonl");
	return readResearchLedger(ledger).events;
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
		if (pidAlive(record.pid)) {
			const note = "unmanaged: API server restarted while this run was active";
			if (record.error !== note) {
				record.error = note;
				record.updatedAt = new Date().toISOString();
				writeMetadata(record);
			}
			continue;
		}
		record.status = "failed";
		if (!record.error) record.error = "run did not finish: API server restarted while it was active";
		record.finishedAt = record.finishedAt ?? new Date().toISOString();
		record.updatedAt = record.finishedAt;
		record.exitCode = record.exitCode ?? null;
		writeMetadata(record);
	}
}

function snapshot(record: RunRecord): RunSnapshot {
	const status = deriveStatus(record);
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
		phase: current?.kind ?? (status === "completed" ? "completed" : status),
		progress: { completedNodes, totalNodes, percent: totalNodes ? Math.round((completedNodes / totalNodes) * 100) : result ? 100 : 0 },
		timing: { createdAt: record.createdAt, ...(record.startedAt ? { startedAt: record.startedAt } : {}), updatedAt: record.updatedAt, ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}), elapsedSeconds: Math.max(0, Math.floor((finished - started) / 1000)) },
		usage: { evidenceCount: evidenceIndex?.length ?? 0, activeNodes: active.length, totalEvents: events.length },
		currentNode: current ? { id: current.id, kind: current.kind, title: current.title, state: current.state, attempts: current.attempts, startedAt: current.startedAt } : null,
		result,
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
	// Keep the control channel inside the run directory and pass it to modes
	// that support cooperative process control.  Without this, /actions would
	// write a file that the child process never watches.
	const controlPath = join(runDir(record.id), "control.json");
	mkdirSync(runDir(record.id), { recursive: true });
	if (record.mode === "rsi" || record.mode === "research-live") {
		writeFileSync(controlPath, "", "utf8");
		args = [...args, "--control", controlPath];
	}
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
	const appendOutput = (chunk: Buffer): void => {
		Object.assign(record, loadRecord(record.id) ?? {});
		const path = join(runDir(record.id), "api-stream.log");
		appendFileSync(path, chunk.toString("utf8"));
		record.updatedAt = new Date().toISOString();
		writeMetadata(record);
		emit(record.id, { id: `log-${Date.now()}`, seq: Date.now(), timestamp: new Date().toISOString(), type: "log", runId: record.id, data: { text: chunk.toString("utf8") } });
	};
	child.stdout.on("data", appendOutput);
	child.stderr.on("data", appendOutput);
	child.on("error", (error) => {
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

function parseGens(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	const gens = Number(value);
	if (!Number.isInteger(gens) || gens < 1 || gens > 100) throw new Error("gens must be an integer between 1 and 100");
	return gens;
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
	const config = configPath(body.config);
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
	} else if (record.mode === "rsi") {
		const gens = parseGens(body.gens);
		if (gens !== undefined) args.push("--gens", String(gens));
	}
	return args;
}

function startArgs(record: RunRecord, resume: boolean): string[] {
	const args = buildCommand(record, { config: record.configName, gens: record.gens }, record.mode === "research-live" ? join(runDir(record.id), "mission-input.json") : undefined);
	if (resume) {
		if (record.mode === "research-live") {
			if (existsSync(join(runDir(record.id), "plan.json"))) args.push("--resume", runDir(record.id));
		} else if (record.mode === "rsi") {
			if (["state.json", "board.jsonl", "champion_scaffold.json", "memory"].some((entry) => existsSync(join(runDir(record.id), entry)))) args.push("--resume");
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

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
	cors(res);
	if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
	const url = new URL(req.url ?? "/", "http://localhost");
	const path = url.pathname.replace(/\/+$/, "") || "/";
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
			if (!isRunMode(mode)) throw new Error("mode must be research-live, research-demo, rsi, or evolve");
			const rawConfigName = body.config === undefined ? undefined : String(body.config);
			configPath(rawConfigName);
			const configName = rawConfigName?.endsWith(".json") ? rawConfigName.slice(0, -5) : rawConfigName;
			const gens = parseGens(body.gens);
			const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 160) : "Untitled research";
			const id = `run_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
			const createdAt = new Date().toISOString();
			const record: RunRecord = { id, name, mode, status: "queued", createdAt, updatedAt: createdAt, ...(configName ? { configName } : {}), ...(gens !== undefined ? { gens } : {}) };
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
			const autoStart = body.autoStart !== false;
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
			if (pidAlive(record.pid)) return errorResponse(res, 409, "RUN_ALREADY_ACTIVE", "run process is still alive (unmanaged after an API server restart); stop it by pid before restarting here");
			const currentStatus = deriveStatus(record);
			const resumable = resume && (currentStatus === "failed" || currentStatus === "cancelled" || currentStatus === "running" || currentStatus === "queued" || currentStatus === "paused");
			if (currentStatus !== "queued" && !resumable) return errorResponse(res, 409, "RUN_NOT_STARTABLE", `run cannot be started from status ${currentStatus}`);
			startRun(record, startArgs(record, resume));
			json(res, 202, { runId: id, status: record.status, resume, links: { self: `${API_PREFIX}/research-runs/${id}`, events: `${API_PREFIX}/research-runs/${id}/events` } });
		} catch (error) { errorResponse(res, 400, "INVALID_START", error instanceof Error ? error.message : String(error)); }
		return;
	}
	if (tail === "workflow" && req.method === "GET") { json(res, 200, readPlan(id) ?? { version: 1, missionId: record.missionId ?? id, nodes: [] }); return; }
	if (tail === "mission" && req.method === "GET") {
		const missionFile = existsSync(join(runDir(id), "mission.json")) ? join(runDir(id), "mission.json") : join(runDir(id), "mission-input.json");
		const mission = readJsonFile<ResearchMission>(missionFile);
		if (!mission) return errorResponse(res, 404, "MISSION_NOT_FOUND", "mission is not available yet");
		json(res, 200, { mission, source: basename(missionFile), updatedAt: statSync(missionFile).mtime.toISOString() });
		return;
	}
	if (tail === "events" && req.method === "GET") {
		res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": "*" });
		const set = subscribers.get(id) ?? new Set<ServerResponse>();
		set.add(res); subscribers.set(id, set);
		let after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0) || 0;
		const flushLedger = (): void => {
			for (const [index, event] of parseLedger(id).entries()) {
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
			if (!isAction(body.action)) throw new Error("action must be pause, resume, or stop");
			if (!activeChildren.has(id)) return errorResponse(res, 409, "RUN_NOT_ACTIVE", "run is not active");
			if (record.mode !== "rsi" && record.mode !== "research-live") {
				return errorResponse(res, 409, "ACTION_UNSUPPORTED", `control is not supported for ${record.mode} runs`);
			}
			if (body.action !== "stop" && record.mode !== "rsi") {
				return errorResponse(res, 409, "ACTION_UNSUPPORTED", `${body.action} is only supported for rsi runs`);
			}
			record.status = body.action === "pause" ? "pausing" : body.action === "stop" ? "stopping" : "running";
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
			const timestamp = new Date().toISOString();
			appendFileSync(join(runDir(id), "FEEDBACK.md"), `\n[api ${timestamp}] ${body.text.trim().slice(0, 10_000)}\n`, "utf8");
			json(res, 201, { id: `feedback_${randomUUID().slice(0, 8)}`, status: "recorded", effectiveAt: "next-generation" });
		} catch (error) { errorResponse(res, 400, "INVALID_FEEDBACK", error instanceof Error ? error.message : String(error)); }
		return;
	}
	if (tail === "logs" && req.method === "GET") {
		const file = join(runDir(id), "api-stream.log");
		const bytes = existsSync(file) ? readFileSync(file) : Buffer.alloc(0);
		const offset = Math.min(bytes.length, Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0));
		const limit = Math.min(1_000_000, Math.max(1, Number(url.searchParams.get("limit") ?? 200_000) || 200_000));
		const nextOffset = Math.min(bytes.length, offset + limit);
		json(res, 200, { content: bytes.subarray(offset, nextOffset).toString("utf8"), offset, nextOffset, totalBytes: bytes.length, complete: nextOffset >= bytes.length });
		return;
	}
	if (tail === "deliverables" && req.method === "GET") { json(res, 200, { items: listDeliverables(id) }); return; }
	const deliverableMatch = /^deliverables\/([^/]+)\/content$/.exec(tail);
	if (deliverableMatch && req.method === "GET") {
		const name = decodeURIComponent(deliverableMatch[1]!);
		const allowed = new Set(listDeliverables(id).map((item) => (item as { name: string }).name));
		if (!allowed.has(name) || basename(name) !== name) { errorResponse(res, 404, "DELIVERABLE_NOT_FOUND", "deliverable not found"); return; }
		const file = join(runDir(id), name);
		res.writeHead(200, { "Content-Type": contentType(name), "Content-Length": statSync(file).size, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
		res.end(readFileSync(file));
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
		const evidenceRoot = join(resolve(process.env.TEMP ?? process.env.TMP ?? "/tmp"), "GeoRSI", "evidence", basename(runDir(id)));
		const file = join(evidenceRoot, ref.sha256.slice(0, 2), ref.sha256);
		if (!existsSync(file) || statSync(file).size !== ref.bytes) return errorResponse(res, 404, "EVIDENCE_CONTENT_NOT_FOUND", "evidence content is unavailable");
		res.writeHead(200, { "Content-Type": evidenceMediaType, "Content-Length": String(ref.bytes), ETag: JSON.stringify(evidenceId), "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
		res.end(readFileSync(file));
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
	const port = Number(process.env.GEORSI_API_PORT ?? DEFAULT_PORT);
	const server = createApiServer();
	server.listen(port, "0.0.0.0", () => console.log(`GeoRSI API listening on http://localhost:${port}`));
}
