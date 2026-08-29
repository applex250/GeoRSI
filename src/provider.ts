/**
 * Model/provider wiring for GeoRSI on the pi harness.
 *
 * The lab talks to OpenAI-compatible gateways (config.json `base_url` plus the
 * temporary emooo.cc route). The set of usable models is FIXED
 * (SUPPORTED_MODELS in config.ts, verified 2026-08-28): the historical
 * zen/openrouter/local set plus `mimo-v2.5-pro` on emooo. Instead of patching
 * pi we use what pi itself supports for custom endpoints: a project-local
 * models.json (provider + models + apiKey) whose
 * path is handed to ModelRuntime.create({ modelsPath }). The file is
 * regenerated at boot from env/api_key.txt so secrets never sit in a
 * checked-in file. Per-model `api` selects the pi-ai implementation
 * (chat/completions vs responses) — pi dispatches per model.
 *
 * Proxy: when a selected model has route "proxy", enableEnvProxy() installs
 * an undici EnvHttpProxyAgent on the shared global-dispatcher symbol. This is
 * the one reliable route: NODE_USE_ENV_PROXY is defeated because importing
 * pi-coding-agent replaces globalThis.fetch with its bundled undici's fetch,
 * which ignores the dispatcher Node configured at startup.
 *
 * Token accounting: pi reports per-session usage via session stats; we
 * additionally keep a global meter the loop consults for budget stops.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { SUPPORTED_MODELS, modelSpec, type Config, type ModelSpec } from "./config.js";
import { getProfile } from "./models.js";

export const TOKENS = { total: 0, calls: 0, failed: 0 };

/**
 * Boot-time diagnostics sink. Defaults to stderr; the TUI replaces it so
 * messages don't corrupt the alt screen.
 */
export let bootNotifier: (m: string) => void = (m) => process.stderr.write(m + "\n");
export function setBootNotifier(fn: (m: string) => void): void {
	bootNotifier = fn;
}

export function loadApiKey(root: string): string {
	const env = (process.env.RSILAB_API_KEY ?? "").trim();
	if (env) return env;
	const p = join(root, "api_key.txt");
	if (existsSync(p)) return readFileSync(p, "utf8").trim();
	throw new Error("no API key: set RSILAB_API_KEY or write api_key.txt");
}

/** Key for the campus-local server (empty string when not configured). */
export function loadLocalApiKey(root: string): string {
	const env = (process.env.RSILAB_LOCAL_API_KEY ?? "").trim();
	if (env) return env;
	const p = join(root, "api_key_local.txt");
	if (existsSync(p)) return readFileSync(p, "utf8").trim();
	return "";
}

/** OpenRouter key (empty string when not configured). */
export function loadOpenRouterApiKey(root: string): string {
	const env = (process.env.RSILAB_OR_KEY ?? "").trim();
	if (env) return env;
	const p = join(root, "api_key_or.txt");
	if (existsSync(p)) return readFileSync(p, "utf-8").trim();
	return "";
}

/** Temporary emooo.cc key; deliberately environment-only (never read from a repo file). */
export function loadEmoooApiKey(): string {
	return (process.env.RSILAB_EMOOO_API_KEY ?? process.env.GEORSI_EMOOO_API_KEY ?? "").trim();
}

/** Host:port of the local server, for proxy bypass. */
export function localEndpointHost(cfg: Config): string {
	try {
		return new URL(cfg.local_base_url).host;
	} catch {
		return "";
	}
}

/**
 * Install an env-honoring proxy dispatcher for all pi LLM traffic. The local
 * server host is always appended to noProxy so a proxy-routed muse can
 * coexist with the campus model in one process.
 */
export async function enableEnvProxy(noProxyExtra: string[] = []): Promise<boolean> {
	const proxy = (process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy ?? "").trim();
	if (!proxy) {
		throw new Error(
			"proxy-routed model selected but no HTTPS_PROXY/HTTP_PROXY env is set " +
				"(expected e.g. http://127.0.0.1:7897)",
		);
	}
	const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
	const noProxy = [
		process.env.NO_PROXY ?? process.env.no_proxy,
		...noProxyExtra.filter(Boolean),
	]
		.filter(Boolean)
		.join(",");
	// undici's global dispatcher lives on a shared Symbol.for registry, so this
	// also governs the fetch pi-coding-agent installed over globalThis.fetch
	setGlobalDispatcher(
		new EnvHttpProxyAgent({
			httpProxy: process.env.HTTP_PROXY ?? process.env.http_proxy,
			httpsProxy: process.env.HTTPS_PROXY ?? process.env.https_proxy,
			noProxy,
		}),
	);
	return true;
}

/** Fail fast when a selected local model's server is down (downtime is normal). */
export async function preflightLocal(cfg: Config, modelId: string): Promise<void> {
	const url = cfg.local_base_url.replace(/\/+$/, "") + "/models";
	try {
		const r = await fetch(url, {
			headers: { Authorization: `Bearer ${loadLocalApiKey(process.cwd())}` },
			signal: AbortSignal.timeout(8000),
		});
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		const d = (await r.json()) as { data?: { id?: string }[] };
		const ids = (d.data ?? []).map((m) => m.id);
		if (!ids.includes(modelId)) {
			throw new Error(`server is up but does not serve "${modelId}" (serves: ${ids.join(", ") || "nothing"})`);
		}
	} catch (e) {
		throw new Error(
			`local model "${modelId}" is unreachable at ${cfg.local_base_url} (${(e as Error).message}). ` +
				`The campus server is turned off regularly — this is expected. ` +
				`Switch inner_model/outer_model in config.json to a gateway model ` +
				`(hy3 / mimo-v2.5 / mimo-v2.5-pro / z-ai/glm-5.3-flash) and retry.`,
		);
	}
}

/** Fail fast when the temporary emooo.cc model or key is unavailable. */
export async function preflightEmooo(cfg: Config, modelId: string, apiKey: string): Promise<void> {
	if (!apiKey) throw new Error(`temporary emooo model "${modelId}" selected but RSILAB_EMOOO_API_KEY is not set`);
	const url = (cfg.emooo_base_url ?? "https://api.emooo.cc/v1").replace(/\/+$/, "") + "/models";
	let lastError = "unknown error";
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const r = await fetch(url, {
				headers: { Authorization: `Bearer ${apiKey}` },
				signal: AbortSignal.timeout(12_000),
			});
			if (!r.ok) {
				lastError = `HTTP ${r.status}`;
				if (r.status === 401 || r.status === 403) break;
			} else {
				const d = (await r.json()) as { data?: { id?: string }[] };
				const ids = (d.data ?? []).map((m) => m.id);
				if (!ids.includes(modelId)) {
					throw new Error(`server is up but does not serve "${modelId}" (serves: ${ids.join(", ") || "nothing"})`);
				}
				return;
			}
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
	}
	throw new Error(`temporary emooo model "${modelId}" is unavailable at ${url}: ${lastError}`);
}

/**
 * Protective per-request output cap (well under every model's advertised max).
 * Env override for slow reasoning kernels whose one full quiz first-pass turn
 * (reasoning + code + answer sheet) legitimately exceeds the default: seen as
 * `stopReason=length` -> "empty assistant response" on mimo-v2.5, 2026-08-27.
 */
const REQUEST_MAX_TOKENS = Number.parseInt(process.env.RSILAB_REQUEST_MAX_TOKENS ?? "", 10) || 16384;

/** Whether this model tolerates reasoning parameters (profile-driven). */
function reasoningParamSupported(id: string): boolean {
	try {
		return getProfile(id).reasoning.style !== "none";
	} catch {
		return true;
	}
}

/** Build the provider/models description pi consumes (models.json schema). */
function buildModelsJson(cfg: Config, apiKey: string, localApiKey: string, orApiKey: string, emoooApiKey: string): object {
	const mk = (m: (typeof SUPPORTED_MODELS)[number]) => ({
		id: m.id,
		name: m.id,
		api: m.api,
		contextWindow: m.contextWindow,
		// cap per-request output so a verbose model cannot burn a whole turn
		// on one giant dump (lesson from OpenRSI_self's laguna incident);
		// true ceilings live in ModelSpec.maxOutput
		maxTokens: REQUEST_MAX_TOKENS,
		// per-model capability from the probed profile registry (muse rejects
		// any reasoning parameter with a 400; unknown ids keep legacy behavior)
		reasoning: reasoningParamSupported(m.id),
		thinkingLevelMap: m.thinkingLevelMap,
		compat: m.compat,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	});
	const providers: Record<string, unknown> = {
		zen: {
			name: "zen gateway",
			baseUrl: cfg.base_url,
			apiKey: apiKey,
			// provider-level default; per-model `api` above still wins
			api: "openai-completions",
			models: SUPPORTED_MODELS.filter((m) => m.endpoint === "zen" && !m.retired).map(mk),
		},
	};
	if (orApiKey) {
		providers.openrouter = {
			name: "openrouter",
			baseUrl: cfg.openrouter_base_url ?? "https://openrouter.ai/api/v1",
			apiKey: orApiKey,
			api: "openai-completions",
			models: SUPPORTED_MODELS.filter((m) => m.endpoint === "openrouter" && !m.retired).map(mk),
		};
	}
	if (localApiKey) {
		providers.local = {
			name: "campus local server",
			baseUrl: cfg.local_base_url,
			apiKey: localApiKey,
			api: "openai-completions",
			models: SUPPORTED_MODELS.filter((m) => m.endpoint === "local" && !m.retired).map(mk),
		};
	}
	if (emoooApiKey) {
		providers.emooo = {
			name: "emooo temporary gateway",
			baseUrl: cfg.emooo_base_url ?? "https://api.emooo.cc/v1",
			apiKey: emoooApiKey,
			api: "openai-completions",
			models: SUPPORTED_MODELS.filter((m) => m.endpoint === "emooo" && !m.retired).map(mk),
		};
	}
	return { providers };
}

function providerIdForEndpoint(endpoint: ModelSpec["endpoint"]): string {
	if (endpoint === "local") return "local";
	if (endpoint === "openrouter") return "openrouter";
	if (endpoint === "emooo") return "emooo";
	return "zen";
}

export interface PiRuntime {
	modelRuntime: ModelRuntime;
	inner: Model<any>;
	outer: Model<any>;
}

let cached: PiRuntime | null = null;

/** The composed ModelRuntime; throws if getPiRuntime has not run yet. */
export function currentModelRuntime(): ModelRuntime {
	if (!cached) throw new Error("pi runtime not initialized: call getPiRuntime() first");
	return cached.modelRuntime;
}

/** Resolve any whitelisted model on the cached runtime (task-to-model routing). */
export function resolveModel(id: string): Model<any> {
	if (!cached) throw new Error("pi runtime not initialized: call getPiRuntime() first");
	if (!modelSpec(id)) throw new Error(`model "${id}" not in SUPPORTED_MODELS`);
	const provider = providerIdForEndpoint(modelSpec(id)!.endpoint);
	const m = cached.modelRuntime.getModel(provider, id);
	if (!m) throw new Error(`model "${id}" not found on provider "${provider}"`);
	return m;
}

export async function getPiRuntime(cfg: Config, root: string): Promise<PiRuntime> {
	if (cached) return cached;
	const apiKey = loadApiKey(root);
	const localApiKey = loadLocalApiKey(root);
	const orApiKey = loadOpenRouterApiKey(root);
	const emoooApiKey = loadEmoooApiKey();
	const dir = join(root, "config");
	mkdirSync(dir, { recursive: true });
	const modelsPath = join(dir, "pi-models.json");
	writeFileSync(modelsPath, JSON.stringify(buildModelsJson(cfg, apiKey, localApiKey, orApiKey, emoooApiKey), null, 2));

	const selected = [cfg.inner_model, cfg.outer_model].filter((v, i, a) => a.indexOf(v) === i);
	const specOf = (id: string) => modelSpec(id)!; // loadConfig already validated

	// A selected local model must have its key and its server up — fail fast
	// with a clear hint instead of mysterious mid-run call failures.
	for (const id of selected) {
		if (specOf(id).endpoint === "local") {
			if (!localApiKey) {
				throw new Error(
					`local model "${id}" selected but no key configured: set RSILAB_LOCAL_API_KEY or write api_key_local.txt`,
				);
			}
			await preflightLocal(cfg, id);
		}
		if (specOf(id).endpoint === "emooo") {
			await preflightEmooo(cfg, id, emoooApiKey);
		}
	}

	// Any selected model needing the proxy flips the whole process's LLM
	// traffic onto it — all supported models were verified working via proxy;
	// the local campus server is excluded via noProxy.
	if (selected.some((id) => specOf(id).route === "proxy")) {
		await enableEnvProxy([localEndpointHost(cfg)]);
		bootNotifier("[provider] proxy-routed model selected -> gateway traffic via env proxy (local server direct)");
	}

	const modelRuntime = await ModelRuntime.create({
		modelsPath,
		// no model-catalog network refresh: our provider is fully static
		refreshOnCreate: false,
		allowModelNetwork: false,
	});

	const resolve = (id: string): Model<any> => {
		const provider = providerIdForEndpoint(specOf(id).endpoint);
		const m = modelRuntime.getModel(provider, id);
		if (!m) {
			throw new Error(
				`model "${id}" not found on provider "${provider}" after composing pi-models.json` +
					(!localApiKey && specOf(id).endpoint === "local" ? " (local provider omitted: no key)" : !orApiKey && specOf(id).endpoint === "openrouter" ? " (openrouter provider omitted: no api_key_or.txt)" : !emoooApiKey && specOf(id).endpoint === "emooo" ? " (emooo provider omitted: set RSILAB_EMOOO_API_KEY)" : ""),
			);
		}
		return m;
	};
	const inner = resolve(cfg.inner_model);
	const outer = resolve(cfg.outer_model);

	cached = { modelRuntime, inner, outer };
	return cached;
}
