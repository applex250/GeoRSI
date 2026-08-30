/**
 * Model/provider wiring for GeoRSI on the pi harness.
 *
 * The lab talks to OpenAI-compatible gateways (config.json `base_url` plus the
 * temporary emooo.cc route). The set of usable models is FIXED
 * (SUPPORTED_MODELS in config.ts, verified 2026-08-28): the historical
 * zen/openrouter/local set plus `mimo-v2.5-pro` on emooo. Instead of patching
 * pi we use what pi itself supports for custom endpoints: a private random
 * temporary models.json (provider + models + apiKey) handed to
 * ModelRuntime.create({ modelsPath }). The directory is outside the repository
 * and removed immediately after composition on both success and failure.
 * Per-model `api` selects the pi-ai implementation
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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { SUPPORTED_MODELS, assertSupportedModel, modelSpec, configuredModelIds, type Config, type ModelSpec } from "./config.js";
import { getProfile } from "./models.js";
import { TOKENS } from "./budget.js";

export { TOKENS };

/**
 * Boot-time diagnostics sink. Defaults to stderr; the TUI replaces it so
 * messages don't corrupt the alt screen.
 */
export let bootNotifier: (m: string) => void = (m) => process.stderr.write(m + "\n");
export function setBootNotifier(fn: (m: string) => void): void {
	bootNotifier = fn;
}

export function loadApiKey(root: string): string {
	const key = loadOptionalApiKey(root);
	if (key) return key;
	throw new Error("no API key: set RSILAB_API_KEY or write api_key.txt");
}

/** Optional Zen key; selection validation decides whether absence is fatal. */
export function loadOptionalApiKey(root: string): string {
	const env = (process.env.RSILAB_API_KEY ?? "").trim();
	if (env) return env;
	const p = join(root, "api_key.txt");
	return existsSync(p) ? readFileSync(p, "utf8").trim() : "";
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

/** ai-pixel key; environment-only because repository credential files are forbidden. */
export function loadAiPixelApiKey(): string {
	return (process.env.AI_PIXEL_API_KEY ?? "").trim();
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
export async function preflightLocal(cfg: Config, modelId: string, apiKey = loadLocalApiKey(process.cwd())): Promise<void> {
	const url = cfg.local_base_url.replace(/\/+$/, "") + "/models";
	try {
		const r = await fetch(url, {
			headers: { Authorization: `Bearer ${apiKey}` },
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

/** Authenticate and confirm the ai-pixel catalog when it exposes /models. */
export async function preflightAiPixel(cfg: Config, modelId: string, apiKey: string): Promise<void> {
	if (!apiKey) throw new Error(`ai-pixel model "${modelId}" selected but AI_PIXEL_API_KEY is not set`);
	const url = (cfg.ai_pixel_base_url ?? "https://api.ai-pixel.online/v1").replace(/\/+$/, "") + "/models";
	let response: Response;
	try {
		response = await fetch(url, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(12_000),
		});
	} catch (error) {
		throw new Error(`ai-pixel preflight failed at ${url}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (response.status === 404 || response.status === 405) {
		bootNotifier("[provider] ai-pixel does not expose /models; Responses capability probe remains required");
		return;
	}
	if (!response.ok) throw new Error(`ai-pixel preflight failed at ${url}: HTTP ${response.status}`);
	const payload = (await response.json()) as { data?: { id?: string }[] };
	const ids = (payload.data ?? []).map((model) => model.id).filter((id): id is string => !!id);
	if (ids.length > 0 && !ids.includes(modelId)) {
		throw new Error(`ai-pixel is reachable but does not list "${modelId}"`);
	}
}

/**
 * Protective per-request output cap (well under every model's advertised max).
 * Env override for slow reasoning kernels whose one full quiz first-pass turn
 * (reasoning + code + answer sheet) legitimately exceeds the default: seen as
 * `stopReason=length` -> "empty assistant response" on mimo-v2.5, 2026-08-27.
 */
const DEFAULT_REQUEST_MAX_TOKENS = 16_384;

/** Parse the optional cap fail-safely; non-positive/non-integer values use the default. */
export function resolveRequestMaxTokens(raw = process.env.RSILAB_REQUEST_MAX_TOKENS): number {
	if (raw === undefined || raw.trim() === "") return DEFAULT_REQUEST_MAX_TOKENS;
	const parsed = Number(raw);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_REQUEST_MAX_TOKENS;
}

const REQUEST_MAX_TOKENS = resolveRequestMaxTokens();

/** Whether this model tolerates reasoning parameters (profile-driven). */
function reasoningParamSupported(id: string): boolean {
	try {
		return getProfile(id).reasoning.style !== "none";
	} catch {
		return true;
	}
}

/** Build the provider/models description pi consumes (models.json schema). */
export function buildModelsJson(
	cfg: Config,
	credentials: { zen: string; local: string; openrouter: string; emooo: string; aiPixel: string },
	selectedModels: readonly string[],
): object {
	const selected = new Set(selectedModels);
	const mk = (m: (typeof SUPPORTED_MODELS)[number]) => ({
		id: m.id,
		name: m.id,
		api: m.api,
		contextWindow: m.contextWindow,
		// cap per-request output so a verbose model cannot burn a whole turn
		// on one giant dump (lesson from OpenRSI_self's laguna incident);
		// true ceilings live in ModelSpec.maxOutput
		maxTokens: Math.min(REQUEST_MAX_TOKENS, m.maxOutput),
		// per-model capability from the probed profile registry (muse rejects
		// any reasoning parameter with a 400; unknown ids keep legacy behavior)
		reasoning: reasoningParamSupported(m.id),
		thinkingLevelMap: m.thinkingLevelMap,
		compat: m.compat,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	});
	const providers: Record<string, unknown> = {};
	if (credentials.zen && SUPPORTED_MODELS.some((model) => selected.has(model.id) && model.endpoint === "zen")) providers.zen = {
			name: "zen gateway",
			baseUrl: cfg.base_url,
			apiKey: credentials.zen,
			// provider-level default; per-model `api` above still wins
			api: "openai-completions",
			models: SUPPORTED_MODELS.filter((m) => selected.has(m.id) && m.endpoint === "zen" && !m.retired).map(mk),
		};
	if (credentials.openrouter && SUPPORTED_MODELS.some((model) => selected.has(model.id) && model.endpoint === "openrouter")) {
		providers.openrouter = {
			name: "openrouter",
			baseUrl: cfg.openrouter_base_url ?? "https://openrouter.ai/api/v1",
			apiKey: credentials.openrouter,
			api: "openai-completions",
			models: SUPPORTED_MODELS.filter((m) => selected.has(m.id) && m.endpoint === "openrouter" && !m.retired).map(mk),
		};
	}
	if (credentials.local && SUPPORTED_MODELS.some((model) => selected.has(model.id) && model.endpoint === "local")) {
		providers.local = {
			name: "campus local server",
			baseUrl: cfg.local_base_url,
			apiKey: credentials.local,
			api: "openai-completions",
			models: SUPPORTED_MODELS.filter((m) => selected.has(m.id) && m.endpoint === "local" && !m.retired).map(mk),
		};
	}
	if (credentials.emooo && SUPPORTED_MODELS.some((model) => selected.has(model.id) && model.endpoint === "emooo")) {
		providers.emooo = {
			name: "emooo temporary gateway",
			baseUrl: cfg.emooo_base_url ?? "https://api.emooo.cc/v1",
			apiKey: credentials.emooo,
			api: "openai-completions",
			models: SUPPORTED_MODELS.filter((m) => selected.has(m.id) && m.endpoint === "emooo" && !m.retired).map(mk),
		};
	}
	if (credentials.aiPixel && SUPPORTED_MODELS.some((model) => selected.has(model.id) && model.endpoint === "ai-pixel")) {
		providers["ai-pixel"] = {
			name: "ai-pixel Responses gateway",
			baseUrl: cfg.ai_pixel_base_url ?? "https://api.ai-pixel.online/v1",
			apiKey: credentials.aiPixel,
			api: "openai-responses",
			compat: { supportsReasoningEffort: true },
			models: SUPPORTED_MODELS.filter((m) => selected.has(m.id) && m.endpoint === "ai-pixel" && !m.retired).map(mk),
		};
	}
	return { providers };
}

function providerIdForEndpoint(endpoint: ModelSpec["endpoint"]): string {
	if (endpoint === "local") return "local";
	if (endpoint === "openrouter") return "openrouter";
	if (endpoint === "emooo") return "emooo";
	if (endpoint === "ai-pixel") return "ai-pixel";
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
	const selected = configuredModelIds(cfg, root);
	const specOf = (id: string): ModelSpec => assertSupportedModel("selected model", id);
	const endpoints = new Set(selected.map((id) => specOf(id).endpoint));
	// Do not read unrelated credential files in a single-provider campaign.
	const apiKey = endpoints.has("zen") ? loadOptionalApiKey(root) : "";
	const localApiKey = endpoints.has("local") ? loadLocalApiKey(root) : "";
	const orApiKey = endpoints.has("openrouter") ? loadOpenRouterApiKey(root) : "";
	const emoooApiKey = endpoints.has("emooo") ? loadEmoooApiKey() : "";
	const aiPixelApiKey = endpoints.has("ai-pixel") ? loadAiPixelApiKey() : "";

	for (const id of selected) {
		const spec = specOf(id);
		if (spec.endpoint === "zen" && !apiKey) {
			throw new Error(`Zen model "${id}" selected but no key configured: set RSILAB_API_KEY or write api_key.txt`);
		}
		if (spec.endpoint === "openrouter" && !orApiKey) {
			throw new Error(`OpenRouter model "${id}" selected but no key configured: set RSILAB_OR_KEY or write api_key_or.txt`);
		}
		if (spec.endpoint === "local") {
			if (!localApiKey) {
				throw new Error(`local model "${id}" selected but no key configured: set RSILAB_LOCAL_API_KEY or write api_key_local.txt`);
			}
			await preflightLocal(cfg, id, localApiKey);
		}
		if (spec.endpoint === "emooo") await preflightEmooo(cfg, id, emoooApiKey);
		if (spec.endpoint === "ai-pixel") await preflightAiPixel(cfg, id, aiPixelApiKey);
	}

	// Any selected/routed model needing the proxy flips the whole process's LLM
	// traffic onto it. The local campus server remains excluded via noProxy.
	if (selected.some((id) => specOf(id).route === "proxy")) {
		await enableEnvProxy([localEndpointHost(cfg)]);
		bootNotifier("[provider] proxy-routed model selected -> gateway traffic via env proxy (local server direct)");
	}

	// Provider configuration contains credentials, so it must never persist in
	// the repository. ModelRuntime reads it during create(); delete the private
	// random temp directory on both success and failure.
	const legacyModelsPath = join(root, "config", "pi-models.json");
	rmSync(legacyModelsPath, { force: true });
	const runtimeDir = mkdtempSync(join(tmpdir(), "georsi-models-"));
	const modelsPath = join(runtimeDir, "models.json");
	let modelRuntime: ModelRuntime;
	try {
		const modelsJson = buildModelsJson(cfg, {
			zen: apiKey,
			local: localApiKey,
			openrouter: orApiKey,
			emooo: emoooApiKey,
			aiPixel: aiPixelApiKey,
		}, selected) as { providers?: Record<string, unknown> };
		if (!modelsJson.providers || Object.keys(modelsJson.providers).length === 0) {
			throw new Error("no provider credentials are configured for the selected GeoRSI models");
		}
		writeFileSync(modelsPath, JSON.stringify(modelsJson, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
		modelRuntime = await ModelRuntime.create({
			modelsPath,
			refreshOnCreate: false,
			allowModelNetwork: false,
		});
	} finally {
		rmSync(runtimeDir, { recursive: true, force: true });
	}

	const resolve = (id: string): Model<any> => {
		const provider = providerIdForEndpoint(specOf(id).endpoint);
		const m = modelRuntime.getModel(provider, id);
		if (!m) {
			throw new Error(
				`model "${id}" not found on provider "${provider}" after composing pi-models.json` +
					(!localApiKey && specOf(id).endpoint === "local" ? " (local provider omitted: no key)" : !orApiKey && specOf(id).endpoint === "openrouter" ? " (openrouter provider omitted: no api_key_or.txt)" : !emoooApiKey && specOf(id).endpoint === "emooo" ? " (emooo provider omitted: set RSILAB_EMOOO_API_KEY)" : !aiPixelApiKey && specOf(id).endpoint === "ai-pixel" ? " (ai-pixel provider omitted: set AI_PIXEL_API_KEY)" : ""),
			);
		}
		return m;
	};
	const inner = resolve(cfg.inner_model);
	const outer = resolve(cfg.outer_model);

	cached = { modelRuntime, inner, outer };
	return cached;
}
