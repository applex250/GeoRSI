/** Offline HTTP integration checks; fixtures remain under ignored runs/. */
import assert from "node:assert/strict";
import { once } from "node:events";
import { join } from "node:path";
import { ROOT } from "../config.js";
import { ResearchEventLedger } from "../research/event-ledger.js";
import { createApiServer } from "./server.js";

const server = createApiServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
async function request(path: string, status = 200, body?: unknown) {
	const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
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
		async until(fragment: string) {
			const timeout = setTimeout(() => abort.abort(), 10_000);
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
	assert(Array.isArray((await request("/api/v1/configs")).items));
	const templates = await request("/api/v1/research-missions");
	assert(templates.items.length > 0);
	await request(`/api/v1/research-missions/${templates.items[0].id}`);
	await request("/api/v1/research-runs/run_missing", 404);
	await request("/api/v1/research-runs", 400, { mode: "invalid" });
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
		assert.equal((await request(demoPath + "/actions", 409, { action: "stop" })).error.code, "ACTION_UNSUPPORTED");
		const output = await demoEvents.until("event: run_end");
		assert(!/^id: (log-|end-|cmd_)/m.test(output), "transient events cannot replace the ledger cursor");
	} finally { demoEvents.abort.abort(); }
	const result = await request(demoPath);
	assert.equal(result.status, "completed", JSON.stringify(result));
	assert.equal(result.progress.percent, 100);
	for (const resource of ["mission", "workflow", "score", "attestation", "replay", "claims", "logs"]) await request(`${demoPath}/${resource}`);
	const deliverables = await request(demoPath + "/deliverables");
	assert(deliverables.items.some((item: any) => item.name === "report.md"));
	for (const item of deliverables.items) assert.equal((await fetch(base + item.downloadUrl)).status, 200);
	const evidence = await request(demoPath + "/evidence");
	assert(evidence.items.length > 0);
	assert.equal((await fetch(base + demoPath + `/evidence/${encodeURIComponent(evidence.items[0].id)}/content`)).status, 200);
	await request(demoPath + "/feedback", 201, { text: "Selftest feedback" });
	await request(demoPath + "/start", 409, {});
	console.log("API selftest PASS: HTTP resources, demo subprocess, SSE live/reconnect, controls, downloads");
} finally {
	server.closeAllConnections();
	await new Promise<void>((resolve) => server.close(() => resolve()));
}
