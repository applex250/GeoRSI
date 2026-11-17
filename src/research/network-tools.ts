/** Typed network research tools; transport is injected so strict runs use a boxed port. */
import type { ContentAddressedEvidenceStore } from "./evidence-store.js";
import type { ScientificTool } from "./tool-registry.js";
import type { ScholarlySourceRecord } from "./verifiers/literature.js";
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
	fetch(request: NetworkFetchRequest, signal?: AbortSignal): Promise<NetworkFetchResponse>;
	/** Release the port's resources (the host port keeps a pinned dispatcher). Optional for captive test ports. */
	close?(): Promise<void>;
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
			if (context.signal?.aborted) throw new Error(`web-fetch aborted before launch for node ${context.nodeId}`);
			const method = input.method ?? "GET";
			const response = await port.fetch({ url: input.url, method, timeoutMs: input.timeoutMs ?? Math.min(30_000, context.remainingWallMs), maxBytes: input.maxBytes ?? 5_000_000 }, context.signal);
			if (context.signal?.aborted) throw new Error(`web-fetch aborted after completion for node ${context.nodeId}; response discarded`);
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
				evidenceRefs: evidence ? [evidence] : [],
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

export type LiteratureCatalogue = "crossref" | "openalex";

export interface LiteratureSearchInput { query: string; rows?: number; source?: LiteratureCatalogue }
export interface LiteratureSearchOutput {
	source: LiteratureCatalogue;
	query: string;
	url: string;
	/** CAS id of the raw catalogue response; every returned record's contentHash is its sha256. */
	evidenceId: string;
	count: number;
	sources: ScholarlySourceRecord[];
}

function text(value: unknown): string {
	if (Array.isArray(value)) return text(value[0]);
	return typeof value === "string" ? value.trim() : "";
}

/** Map a Crossref `message.items[]` entry or an OpenAlex `results[]` entry onto the
 * literature-v1 source record. Records the verifier would reject (no title, no author, no
 * year, neither DOI nor URL) are dropped rather than passed on as junk. */
export function scholarlyRecordsFrom(source: LiteratureCatalogue, payload: unknown, retrievedAt: string, contentHash: string): ScholarlySourceRecord[] {
	const root = payload as Record<string, unknown> | undefined;
	const items = source === "crossref"
		? ((root?.message as Record<string, unknown> | undefined)?.items as unknown[] | undefined) ?? []
		: (root?.results as unknown[] | undefined) ?? [];
	const records: ScholarlySourceRecord[] = [];
	for (const raw of items) {
		const item = raw as Record<string, unknown>;
		let doi = text(item.DOI ?? item.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
		if (!/^10\.\d{4,9}\/\S+$/i.test(doi)) doi = "";
		const title = text(item.title ?? item.display_name);
		const authors = source === "crossref"
			? ((item.author as Array<Record<string, unknown>> | undefined) ?? []).map((author) => [text(author.given), text(author.family)].filter(Boolean).join(" ") || text(author.name)).filter(Boolean)
			: ((item.authorships as Array<Record<string, unknown>> | undefined) ?? []).map((entry) => text((entry.author as Record<string, unknown> | undefined)?.display_name)).filter(Boolean);
		const year = source === "crossref"
			? Number((((item.issued as Record<string, unknown> | undefined)?.["date-parts"] as unknown[][] | undefined)?.[0]?.[0]) ?? NaN)
			: Number(item.publication_year ?? NaN);
		const url = text(item.URL) || text((item.primary_location as Record<string, unknown> | undefined)?.landing_page_url) || (doi ? `https://doi.org/${doi}` : "");
		if (!title || authors.length === 0 || !Number.isSafeInteger(year) || (!doi && !url)) continue;
		records.push({ id: doi || url, title: title.slice(0, 300), authors: authors.slice(0, 12), year, ...(doi ? { doi } : {}), ...(url ? { url } : {}), retrievedAt, contentHash, primary: false, supportsClaimIds: [], contradictsClaimIds: [] });
	}
	return records;
}

/** Scholarly catalogue search (Crossref default, OpenAlex optional). The raw response is
 * registered as `source` evidence so the records it yields carry a real content hash — the
 * shape literature-v1 demands, which a node otherwise had to hand-build from web-fetch. */
export function createLiteratureSearchTool(
	port: NetworkFetchPort,
	evidenceStore: ContentAddressedEvidenceStore,
	now: () => Date = () => new Date(),
	options: { mailto?: string } = {},
): ScientificTool<LiteratureSearchInput, LiteratureSearchOutput> {
	return {
		id: "search-literature",
		version: "1",
		capability: "network",
		validate: (input) => {
			const value = input as { query?: unknown; rows?: unknown; source?: unknown };
			const issues: string[] = [];
			if (typeof value.query !== "string" || !value.query.trim() || value.query.length > 500) issues.push("query must be 1..500 characters");
			if (value.rows !== undefined && (!Number.isInteger(value.rows) || Number(value.rows) < 1 || Number(value.rows) > 25)) issues.push("rows must be an integer within 1..25");
			if (value.source !== undefined && value.source !== "crossref" && value.source !== "openalex") issues.push("source must be crossref or openalex");
			return issues;
		},
		execute: async (context, input) => {
			if (context.signal?.aborted) throw new Error(`search-literature aborted before launch for node ${context.nodeId}`);
			const source = input.source ?? "crossref";
			const rows = input.rows ?? 8;
			let url = source === "crossref" ? crossrefWorksUrl(input.query, rows) : openAlexWorksUrl(input.query, rows);
			// Crossref's polite pool: a contact address gets a dedicated, faster rate limit.
			if (options.mailto) url += `&mailto=${encodeURIComponent(options.mailto)}`;
			const response = await port.fetch({ url, method: "GET", timeoutMs: Math.min(30_000, context.remainingWallMs), maxBytes: 4_000_000 }, context.signal);
			if (context.signal?.aborted) throw new Error(`search-literature aborted after completion for node ${context.nodeId}; response discarded`);
			if (response.status < 200 || response.status >= 300) throw new Error(`literature catalogue HTTP ${response.status}`);
			let payload: unknown;
			try { payload = JSON.parse(response.body.toString("utf8")); } catch { throw new Error("literature catalogue returned invalid JSON"); }
			const retrievedAt = response.retrievedAt || now().toISOString();
			const safeUrl = sanitizeResearchUrl(response.finalUrl);
			const evidence = evidenceStore.putBuffer(response.body, { kind: "source", logicalName: `${source}-search.json`, producerNodeId: context.nodeId, mediaType: "application/json", sourceUrl: safeUrl, retrievedAt, license: source === "crossref" ? "Crossref metadata (CC0)" : "OpenAlex (CC0)" });
			const sources = scholarlyRecordsFrom(source, payload, retrievedAt, evidence.sha256);
			return { output: { source, query: input.query, url: safeUrl, evidenceId: evidence.id, count: sources.length, sources }, artifactIds: [evidence.id], evidenceRefs: [evidence] };
		},
	};
}
