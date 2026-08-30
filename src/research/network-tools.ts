/** Typed network research tools; transport is injected so strict runs use a boxed port. */
import type { ContentAddressedEvidenceStore } from "./evidence-store.js";
import type { ScientificTool } from "./tool-registry.js";
import { sanitizeResearchHeaders, sanitizeResearchUrl } from "./event-ledger.js";

export interface NetworkFetchRequest {
	url: string;
	method: "GET" | "HEAD";
	timeoutMs: number;
	maxBytes: number;
}

export interface NetworkFetchResponse {
	finalUrl: string;
	status: number;
	headers: Record<string, string>;
	body: Buffer;
	retrievedAt: string;
}

export interface NetworkFetchPort {
	fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse>;
}

function validateHttpUrl(value: unknown): string[] {
	if (typeof value !== "string") return ["url must be a string"];
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:" ? [] : ["url must use http or https"];
	} catch {
		return ["url is invalid"];
	}
}

export function createWebFetchTool(
	port: NetworkFetchPort,
	evidenceStore: ContentAddressedEvidenceStore,
	now: () => Date = () => new Date(),
): ScientificTool<{ url: string; method?: "GET" | "HEAD"; timeoutMs?: number; maxBytes?: number }, { status: number; finalUrl: string; headers: Record<string, string>; evidenceId?: string }> {
	return {
		id: "web-fetch",
		version: "1",
		capability: "network",
		validate: (input) => {
			const value = input as { url?: unknown; method?: unknown; timeoutMs?: unknown; maxBytes?: unknown };
			const issues = validateHttpUrl(value.url);
			if (value.method !== undefined && value.method !== "GET" && value.method !== "HEAD") issues.push("method must be GET or HEAD");
			if (value.timeoutMs !== undefined && (!Number.isFinite(value.timeoutMs) || Number(value.timeoutMs) <= 0 || Number(value.timeoutMs) > 120_000)) issues.push("timeoutMs must be within 1..120000");
			if (value.maxBytes !== undefined && (!Number.isFinite(value.maxBytes) || Number(value.maxBytes) <= 0 || Number(value.maxBytes) > 50_000_000)) issues.push("maxBytes must be within 1..50000000");
			return issues;
		},
		execute: async (context, input) => {
			const method = input.method ?? "GET";
			const response = await port.fetch({ url: input.url, method, timeoutMs: input.timeoutMs ?? Math.min(30_000, context.remainingWallMs), maxBytes: input.maxBytes ?? 5_000_000 });
			if (response.status < 200 || response.status >= 400) throw new Error(`web fetch HTTP ${response.status}`);
			if (response.body.byteLength > (input.maxBytes ?? 5_000_000)) throw new Error("web fetch exceeded maxBytes");
			const contentType = response.headers["content-type"] ?? "application/octet-stream";
			const safeFinalUrl = sanitizeResearchUrl(response.finalUrl);
			const safeHeaders = sanitizeResearchHeaders(response.headers);
			const evidence = method === "HEAD" ? undefined : evidenceStore.putBuffer(response.body, {
				kind: "source",
				logicalName: new URL(response.finalUrl).pathname.split("/").pop() || "download",
				producerNodeId: context.nodeId,
				mediaType: contentType,
				sourceUrl: safeFinalUrl,
				retrievedAt: response.retrievedAt || now().toISOString(),
				license: safeHeaders["license"],
			});
			return {
				output: { status: response.status, finalUrl: safeFinalUrl, headers: safeHeaders, evidenceId: evidence?.id },
				artifactIds: evidence ? [evidence.id] : [],
			};
		},
	};
}

export function crossrefWorksUrl(query: string, rows = 10): string {
	const boundedRows = Math.max(1, Math.min(50, Math.floor(rows)));
	return `https://api.crossref.org/works?query=${encodeURIComponent(query.slice(0, 500))}&rows=${boundedRows}`;
}

export function openAlexWorksUrl(query: string, perPage = 10): string {
	const boundedRows = Math.max(1, Math.min(50, Math.floor(perPage)));
	return `https://api.openalex.org/works?search=${encodeURIComponent(query.slice(0, 500))}&per-page=${boundedRows}`;
}
