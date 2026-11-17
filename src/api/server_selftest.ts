/** Offline HTTP integration checks; fixtures remain under ignored runs/. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../config.js";
import { ResearchEventLedger } from "../research/event-ledger.js";
import { harvestRunExperience } from "../research/experience/harvest.js";
import { createApiServer } from "./server.js";

delete process.env.GEORSI_API_TOKEN;
delete process.env.GEORSI_API_ALLOWED_ORIGIN;
// Fixture runs must never enter the real experience lanes.
process.env.GEORSI_EXPERIENCE_ROOT = mkdtempSync(join(tmpdir(), "georsi-xp-api-"));
const server = createApiServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
async function request(path: string, status = 200, body?: unknown, headers: Record<string, string> = {}) {
	const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
	const json = await response.json();
	assert.equal(response.status, status, JSON.stringify(json));
	return json as any;
}
async function stream(path: string, lastId?: string) {
	const abort = new AbortController();
	const response = await fetch(base + path, { signal: abort.signal, headers: lastId ? { "Last-Event-ID": lastId } : {} });
	assert.equal(response.status, 200);
	const reader = response.body!.getReader();
	let text = "";
	return {
		abort,
		// A demo subprocess on a cold machine (tsx + Python startup) can take longer
		// than the default window; callers waiting on run_end pass a wider one.
		async until(fragment: string, timeoutMs = 10_000) {
			const timeout = setTimeout(() => abort.abort(), timeoutMs);
			try {
				while (!text.includes(fragment)) {
					const chunk = await reader.read();
					assert(!chunk.done, `stream ended before ${fragment}`);
					text += new TextDecoder().decode(chunk.value);
				}
				return text;
			} finally { clearTimeout(timeout); }
		},
	};
}
try {
	assert.equal((await request("/healthz")).ok, true);
	assert.equal((await request("/readyz")).ok, true);
	// No token configured: local loopback deployment, nothing to present. No CORS
	// headers either — the shipped frontend goes through its same-origin proxy.
	const bare = await fetch(base + "/api/v1/configs");
	assert.equal(bare.status, 200);
	assert.equal(bare.headers.get("access-control-allow-origin"), null, "CORS must be opt-in");
	// Token configured: everything but the health probes / service index is gated,
	// both header spellings work, and the comparison is exact.
	process.env.GEORSI_API_TOKEN = "selftest-token-0123456789";
	try {
		assert.equal((await request("/healthz")).ok, true);
		assert.equal((await request("/")).auth.startsWith("shared token"), true);
		assert.equal((await request("/api/v1/configs", 401)).error.code, "UNAUTHORIZED");
		await request("/api/v1/configs", 401, undefined, { Authorization: "Bearer selftest-token-012345678" });
		await request("/api/v1/research-runs", 401, { mode: "research-demo" }, { "X-GeoRSI-Token": "wrong" });
		await request("/api/v1/configs", 200, undefined, { Authorization: "Bearer selftest-token-0123456789" });
		await request("/api/v1/configs", 200, undefined, { "X-GeoRSI-Token": "selftest-token-0123456789" });
		const sse = await fetch(base + "/api/v1/research-runs/run_missing/events");
		assert.equal(sse.status, 401);
	} finally { delete process.env.GEORSI_API_TOKEN; }
	process.env.GEORSI_API_ALLOWED_ORIGIN = "http://localhost:3000";
	try {
		const withOrigin = await fetch(base + "/api/v1/configs");
		assert.equal(withOrigin.headers.get("access-control-allow-origin"), "http://localhost:3000");
	} finally { delete process.env.GEORSI_API_ALLOWED_ORIGIN; }
	assert(Array.isArray((await request("/api/v1/configs")).items));
	const templates = await request("/api/v1/research-missions");
	assert(templates.items.length > 0);
	await request(`/api/v1/research-missions/${templates.items[0].id}`);
	await request("/api/v1/research-runs/run_missing", 404);
	await request("/api/v1/research-runs", 400, { mode: "invalid" });
	// The classic agent-evolution loop is frozen: not creatable through the API.
	assert.match((await request("/api/v1/research-runs", 400, { mode: "rsi" })).error.message, /research-live, research-demo, or evolve/);
	const fixture = await request("/api/v1/research-runs", 202, { name: "API SSE selftest", mode: "research-demo", autoStart: false });
	const path = `/api/v1/research-runs/${fixture.id}`;
	const listing = await request("/api/v1/research-runs?status=queued&search=API%20SSE%20selftest&pageSize=100");
	assert(listing.items.some((item: any) => item.id === fixture.id));
	assert.equal(listing.pagination.pageSize, 100);
	assert.equal((await request(path)).status, "queued");
	assert.deepEqual((await request(path + "/workflow")).nodes, []);
	await request(path + "/score", 404);
	const ledger = new ResearchEventLedger(join(ROOT, "runs", fixture.id, "events.jsonl"));
	const append = () => ledger.append({ missionId: fixture.id, episodeId: fixture.id, actor: "controller", type: "node-completed", status: "success" });
	append();
	const events = await stream(path + "/events");
	try {
		assert((await events.until("event: snapshot")).includes("id: 1\n"));
		append();
		assert((await events.until("id: 2\n")).includes("event: node-completed"));
	} finally { events.abort.abort(); ledger.close(); }
	for (const useHeader of [false, true]) {
		const resumed = await stream(path + "/events" + (useHeader ? "" : "?after=1"), useHeader ? "1" : undefined);
		try {
			const text = await resumed.until("event: snapshot");
			assert(!text.includes("id: 1\n"));
			assert(text.includes("id: 2\n"));
		} finally { resumed.abort.abort(); }
	}
	const demo = await request("/api/v1/research-runs", 202, { name: "API demo selftest", mode: "research-demo", autoStart: false });
	const demoPath = `/api/v1/research-runs/${demo.id}`;
	const demoEvents = await stream(demoPath + "/events");
	try {
		await request(demoPath + "/start", 202, {});
		assert.equal((await request(demoPath + "/actions", 400, { action: "pause" })).error.code, "INVALID_ACTION");
		assert.equal((await request(demoPath + "/actions", 409, { action: "stop" })).error.code, "ACTION_UNSUPPORTED");
		const output = await demoEvents.until("event: run_end", 120_000);
		assert(!/^id: (log-|end-|cmd_)/m.test(output), "transient events cannot replace the ledger cursor");
	} finally { demoEvents.abort.abort(); }
	const result = await request(demoPath);
	assert.equal(result.status, "completed", JSON.stringify(result));
	assert.equal(result.progress.percent, 100);
	for (const resource of ["mission", "workflow", "score", "attestation", "replay", "claims", "logs"]) await request(`${demoPath}/${resource}`);
	// Node activity view: the demo graph runs through the scheduler, so a node has lifecycle
	// events even without model sessions; usage is honestly zero for a deterministic fixture.
	const demoPlan = await request(`${demoPath}/workflow`);
	const firstNode = demoPlan.nodes[0] as { id: string };
	const activity = await request(`${demoPath}/nodes/${firstNode.id}/activity`);
	assert.equal(activity.nodeId, firstNode.id);
	assert.equal(activity.usage.calls, 0);
	assert.ok(activity.timeline.some((item: any) => item.kind === "node-start") && activity.timeline.some((item: any) => item.kind === "node-completed"));
	await request(`${demoPath}/nodes/missing-node/activity`, 404);
	await request(`${demoPath}/nodes/..%2f..%2fetc/activity`, 404);
	const budget = await request(`${demoPath}/budget`);
	assert(budget.nodes.length === demoPlan.nodes.length && budget.planned.toolCalls > 0 && typeof budget.used.toolCalls === "number" && Array.isArray(budget.nodes) && "pressure" in budget, JSON.stringify(budget).slice(0, 300));
	const logTail = await request(`${demoPath}/logs?tail=64`);
	assert(logTail.totalBytes > 64 && logTail.content.length <= 64 && logTail.complete === true, JSON.stringify(logTail));
	const deliverables = await request(demoPath + "/deliverables");
	assert(deliverables.items.some((item: any) => item.name === "report.md"));
	for (const item of deliverables.items) assert.equal((await fetch(base + item.downloadUrl)).status, 200);
	const evidence = await request(demoPath + "/evidence");
	assert(evidence.items.length > 0);
	const first = evidence.items[0];
	const evidenceUrl = base + demoPath + `/evidence/${encodeURIComponent(first.id)}/content`;
	assert.equal((await fetch(evidenceUrl)).status, 200);
	// The id IS the content hash: same-length tampering in the temp CAS store must
	// be refused, not served under a matching ETag.
	const casFile = join(tmpdir(), "GeoRSI", "evidence", demo.id, first.sha256.slice(0, 2), first.sha256);
	const original = readFileSync(casFile);
	try {
		const tampered = Buffer.from(original);
		tampered[0] = tampered[0]! ^ 0xff;
		writeFileSync(casFile, tampered);
		const refused = await fetch(evidenceUrl);
		assert.equal(refused.status, 409);
		assert.equal(((await refused.json()) as any).error.code, "EVIDENCE_INTEGRITY");
	} finally { writeFileSync(casFile, original); }
	assert.equal((await fetch(evidenceUrl)).status, 200);
	await request(demoPath + "/feedback", 201, { text: "Selftest feedback" });
	// Experience layer endpoints over a harvested (fixture → retired) record.
	await request(demoPath + "/experience", 404);
	const harvested = harvestRunExperience(join(ROOT, "runs", demo.id));
	assert.equal((await request(demoPath + "/experience")).runRecord, harvested.runRecord);
	const experienceList = await request("/api/v1/experience?status=retired");
	assert(experienceList.items.some((item: any) => item.id === harvested.runRecord && item.runMode === "deterministic-demo"));
	assert.equal((await request("/api/v1/experience?pending=1")).items.length, 0);
	const detail = await request(`/api/v1/experience/${harvested.runRecord}`);
	assert.equal(detail.record.status, "retired");
	assert.deepEqual(detail.approvals, []);
	await request(`/api/v1/experience/${harvested.runRecord}/review`, 400, { decision: "maybe" });
	await request("/api/v1/experience/xp_missing_run/review", 404, { decision: "accept" });
	const reviewed = await request(`/api/v1/experience/${harvested.runRecord}/review`, 200, { decision: "accept", note: "fixture reviewed", actor: "selftest" });
	assert.equal(reviewed.record.gates.human, "approved");
	assert.equal(reviewed.approvals.length, 1);
	assert.equal(reviewed.record.status, "retired", "a fixture record stays retired even when approved");
	await request(demoPath + "/start", 409, {});
	// Heartbeat liveness (#36/#37): a running research-agent record counts as
	// alive only while its child still refreshes heartbeat.json — a reused pid
	// cannot fake that — and a stale heartbeat resolves the zombie to failed so
	// the resume path is offered instead of a false "running".
	const zombieId = "run_api_zombie_probe";
	const zombieDir = join(ROOT, "runs", zombieId);
	mkdirSync(zombieDir, { recursive: true });
	const heartbeatPath = join(zombieDir, "heartbeat.json");
	const writeZombie = (pid: number, configName?: string): void => writeFileSync(join(zombieDir, "api-run.json"), JSON.stringify({ id: zombieId, name: "API zombie probe", mode: "research-agent", status: "running", createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pid, ...(configName ? { configName } : {}) }));
	writeZombie(process.pid);
	writeFileSync(heartbeatPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
	assert.equal((await request(`/api/v1/research-runs/${zombieId}`)).status, "running", "live pid + fresh heartbeat = running");
	const stale = new Date(Date.now() - 10 * 60_000);
	utimesSync(heartbeatPath, stale, stale);
	assert.equal((await request(`/api/v1/research-runs/${zombieId}`)).status, "failed", "live pid + stale heartbeat resolves to failed — pid reuse cannot fake liveness");
	rmSync(heartbeatPath);
	assert.equal((await request(`/api/v1/research-runs/${zombieId}`)).status, "running", "a pre-heartbeat child (no file) falls back to the pid probe");
	// A zombie must not hide behind RUN_ALREADY_ACTIVE on /start: with a dead
	// pid the gate opens and the request proceeds to launch validation (a
	// missing config is a clean 400, never the 409 liveness refusal).
	writeZombie(4_194_303, "definitely-missing-config");
	assert.equal((await request(`/api/v1/research-runs/${zombieId}/start`, 400, { resume: true })).error.code, "INVALID_START");
	console.log("API selftest PASS: HTTP resources, token auth, opt-in CORS, demo subprocess, SSE live/reconnect, controls, downloads, CAS integrity, experience endpoints");
} finally {
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
}
