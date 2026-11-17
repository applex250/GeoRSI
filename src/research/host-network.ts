/**
 * Host-side network transport for research tools.
 *
 * The competition path fetches through the compute port (a Python urllib script inside
 * the box or on the host) so the box's WFP rules bound egress. The interactive workspace
 * tier runs on the host anyway, so it needs a HOST fence instead: every URL is validated,
 * resolved ONCE, checked against the private-range BlockList, and then connected through
 * an undici Agent pinned to the checked addresses — a second resolution at connect time is
 * exactly the DNS-rebinding window. Redirects re-run the whole check per hop.
 *
 * Behind an egress proxy the proxy resolves names itself; the BlockList still runs on our
 * resolution, but the connection cannot be pinned through the tunnel.
 */
import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";
import { Agent, ProxyAgent, fetch, type Dispatcher } from "undici";
import type { NetworkFetchPort, NetworkFetchRequest, NetworkFetchResponse } from "./network-tools.js";
import { retryAfterHintMs, sleep } from "./model-resilience.js";

const blocked = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["100.64.0.0", 10], ["224.0.0.0", 4]] as const) blocked.addSubnet(address, prefix);
blocked.addAddress("::1", "ipv6"); blocked.addSubnet("fc00::", 7, "ipv6"); blocked.addSubnet("fe80::", 10, "ipv6");

export interface ResolvedPublicUrl { url: URL; addresses: Array<{ address: string; family: number }> }

/** Validate a research source URL and resolve it once; callers connect to exactly these
 * addresses (see pinnedDispatcher). */
export async function resolvePublicUrl(raw: string): Promise<ResolvedPublicUrl> {
	const url = new URL(raw);
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || /(^localhost$|\.(local|internal)$)/i.test(url.hostname)) throw new Error("Only public HTTP research sources are allowed");
	const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
	if (!addresses.length || addresses.some((a) => blocked.check(a.address, a.family === 6 ? "ipv6" : "ipv4"))) throw new Error("Private network sources are not allowed");
	return { url, addresses: addresses.map((a) => ({ address: a.address, family: a.family })) };
}

export async function publicUrl(raw: string): Promise<URL> {
	return (await resolvePublicUrl(raw)).url;
}

/** Dispatcher whose socket connects only to the already-checked addresses. TLS still
 * verifies the certificate against the URL hostname (SNI is unchanged). */
export function pinnedDispatcher(addresses: ResolvedPublicUrl["addresses"]): Agent {
	const lookupPinned = ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void): void => {
		if (options.all) callback(null, addresses);
		else callback(null, addresses[0]!.address, addresses[0]!.family);
	}) as unknown as NonNullable<import("node:net").TcpNetConnectOpts["lookup"]>;
	return new Agent({ connect: { lookup: lookupPinned } });
}

export interface HostNetworkFetchOptions {
	/** Egress proxy URL (HTTPS_PROXY); when set the proxy resolves names and pinning is off. */
	proxy?: string;
	userAgent?: string;
	/** Attempts for transient statuses (429/502/503/504) within the request timeout. */
	transientRetries?: number;
	maxRedirects?: number;
	onEvent?: (type: string, payload: unknown) => void;
}

const TRANSIENT = new Set([429, 502, 503, 504]);

export class HostNetworkFetchPort implements NetworkFetchPort {
	private readonly proxyDispatcher: ProxyAgent | undefined;
	constructor(private readonly options: HostNetworkFetchOptions = {}) {
		this.proxyDispatcher = options.proxy ? new ProxyAgent(options.proxy) : undefined;
	}

	async fetch(request: NetworkFetchRequest, signal?: AbortSignal): Promise<NetworkFetchResponse> {
		const deadline = Date.now() + request.timeoutMs;
		const remaining = (): number => Math.max(1, deadline - Date.now());
		let source = await resolvePublicUrl(request.url);
		const maxRedirects = this.options.maxRedirects ?? 5;
		const retries = this.options.transientRetries ?? 3;
		let redirects = 0;
		let attempt = 0;
		for (;;) {
			const pinned: Dispatcher | undefined = this.proxyDispatcher ? undefined : pinnedDispatcher(source.addresses);
			const signals: AbortSignal[] = [AbortSignal.timeout(remaining())];
			if (signal) signals.unshift(signal);
			try {
				const response = await fetch(source.url, {
					method: request.method,
					dispatcher: this.proxyDispatcher ?? pinned,
					redirect: "manual",
					signal: AbortSignal.any(signals),
					headers: { "User-Agent": this.options.userAgent ?? "GeoRSI/1.0 scientific research", Accept: "*/*" },
				});
				const location = response.headers.get("location");
				if (response.status >= 300 && response.status < 400 && location) {
					await response.body?.cancel();
					if (++redirects > maxRedirects) throw new Error("Too many source redirects");
					source = await resolvePublicUrl(new URL(location, source.url).href);
					continue;
				}
				if (TRANSIENT.has(response.status) && attempt < retries) {
					const wait = Math.min(retryAfterHintMs(response.headers.get("retry-after"), 20) || 2000, remaining());
					await response.body?.cancel();
					attempt += 1;
					this.options.onEvent?.("source-backoff", { status: response.status, waitMs: wait, url: source.url.href });
					await sleep(wait, signal);
					continue;
				}
				const headers: Record<string, string> = {};
				response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
				let body = Buffer.alloc(0);
				if (request.method !== "HEAD" && response.body) {
					const chunks: Buffer[] = [];
					let size = 0;
					for await (const chunk of response.body) {
						size += chunk.length;
						if (size > request.maxBytes) throw new Error(`Source exceeds ${request.maxBytes} bytes; narrow the request`);
						chunks.push(Buffer.from(chunk));
					}
					body = Buffer.concat(chunks);
				} else {
					await response.body?.cancel();
				}
				return { finalUrl: source.url.href, status: response.status, headers, body, retrievedAt: new Date().toISOString() };
			} finally {
				// One pinned agent per hop; closing it releases the socket pool.
				if (pinned) await (pinned as Agent).close().catch(() => undefined);
			}
		}
	}

	async close(): Promise<void> {
		await this.proxyDispatcher?.close();
	}
}
