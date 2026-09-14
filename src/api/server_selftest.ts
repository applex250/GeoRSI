/** Offline HTTP integration checks; fixtures remain under ignored runs/. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../config.js";
import { ResearchEventLedger } from "../research/event-ledger.js";
import { createApiServer } from "./server.js";

delete process.env.GEORSI_API_TOKEN;
delete process.env.GEORSI_API_ALLOWED_ORIGIN;
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
	await request(demoPath + "/start", 409, {});
	console.log("API selftest PASS: HTTP resources, token auth, opt-in CORS, demo subprocess, SSE live/reconnect, controls, downloads, CAS integrity");
} finally {
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
}
