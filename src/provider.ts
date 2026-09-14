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
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { RESEARCH_RESILIENCE_DEFAULTS, SUPPORTED_MODELS, assertSupportedModel, modelSpec, modelSpecForConfig, researchModelSpec, configuredModelIds, type Config, type ModelSpec, type ResearchModelConfig } from "./config.js";
import { backoffWaitMs, isTransientStatus, retryAfterHintMs, sleep, type RetryPolicy } from "./research/model-resilience.js";

/** Cloudflare-fronted gateways (geiliapi) reject non-browser user agents with
 * 403 error 1010; match the UA already proven by problems/_shared clients. */
const GATEWAY_BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
import { getProfile } from "./models.js";
import { TOKENS } from "./budget.js";

export { TOKENS };

interface ProbeResilience { probe_attempts: number; probe_backoff_ms: number; probe_backoff_cap_ms: number; probe_timeout_ms: number }

/**
 * Capability-probe request under the shared gateway resilience policy
 * (model-resilience.ts) — the same transient-status set, capped exponential
 * backoff and Retry-After merge the workspace client uses, instead of a private
 * linear-backoff copy that had drifted from it.
 */
async function probeWithRetry(label: string, probeUrl: string, apiKey: string, probeBody: Record<string, unknown>, resilience: ProbeResilience): Promise<Response> {
	const retry: RetryPolicy = { retries: Math.max(0, resilience.probe_attempts - 1), backoffMs: resilience.probe_backoff_ms, backoffCapMs: resilience.probe_backoff_cap_ms };
	let lastProbeError: unknown;
	let retryAfterMs = 0;
	for (let attempt = 0; attempt <= retry.retries; attempt += 1) {
		if (attempt > 0) { await sleep(backoffWaitMs(attempt, retry, retryAfterMs)); retryAfterMs = 0; }
		try {
			const response = await fetch(probeUrl, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "User-Agent": GATEWAY_BROWSER_UA }, body: JSON.stringify(probeBody), signal: AbortSignal.timeout(resilience.probe_timeout_ms) });
			if (isTransientStatus(response.status) && attempt < retry.retries) {
				retryAfterMs = retryAfterHintMs(response.headers.get("retry-after"));
				await response.body?.cancel();
				continue;
			}
			return response;
		} catch (error) {
			lastProbeError = error;
		}
	}
	throw new Error(`${label} failed: ${lastProbeError instanceof Error ? lastProbeError.message : String(lastProbeError)}`);
}

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

/** Research provider credential; the env name is controlled by research_model. */
export function loadResearchApiKey(policy: ResearchModelConfig): string {
	return (process.env[policy.credential_env] ?? "").trim();
}

/** Backward-compatible alias for legacy tests; research config uses GEILIAPI_API_KEY. */
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

export interface ResearchCapabilityProbeResult {
	version: 1;
	provider: string;
	model: string;
	api: "openai-completions" | "openai-responses";
	endpoint: string;
	requestedThinking: "xhigh";
	effectiveThinking: "xhigh";
	toolCallObserved: boolean;
	usage: { inputTokens: number; outputTokens: number; totalTokens: number };
	fingerprint: string;
}

/** @deprecated retained as a type alias while old package readers migrate. */
export type AiPixelCapabilityProbeResult = ResearchCapabilityProbeResult;

function aiPixelResponseThinking(payload: Record<string, unknown>): string | undefined {
	const candidates: unknown[] = [
		payload.effective_reasoning_effort,
		payload.reasoning_effort,
		(payload.reasoning as Record<string, unknown> | undefined)?.effort,
		(payload.metadata as Record<string, unknown> | undefined)?.effective_reasoning_effort,
		(payload.metadata as Record<string, unknown> | undefined)?.reasoning_effort,
	];
	return candidates.find((value): value is string => typeof value === "string")?.toLowerCase();
}

function aiPixelResponseUsage(payload: Record<string, unknown>): { inputTokens: number; outputTokens: number; totalTokens: number } | null {
	const usage = payload.usage;
	if (!usage || typeof usage !== "object") return null;
	const u = usage as Record<string, unknown>;
	const inputTokens = u.input_tokens;
	const outputTokens = u.output_tokens;
	const totalTokens = u.total_tokens;
	if (![inputTokens, outputTokens, totalTokens].every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) return null;
	if ((outputTokens as number) <= 0 || (totalTokens as number) < (outputTokens as number)) return null;
	return { inputTokens: inputTokens as number, outputTokens: outputTokens as number, totalTokens: totalTokens as number };
}

function researchProbeFingerprint(result: Omit<ResearchCapabilityProbeResult, "fingerprint">): string {
	return createHash("sha256").update(JSON.stringify(result)).digest("hex");
}

/**
 * Authenticate and require a bounded, provider-observed capability probe.
 * Exact model identity, reasoning effort echo, function calling, and usage
 * must all be proven before a runtime can be composed.
 */
export async function preflightResearchModel(policy: ResearchModelConfig, apiKey: string): Promise<ResearchCapabilityProbeResult> {
	if (!apiKey) throw new Error(`research model "${policy.model}" selected but ${policy.credential_env} is not set`);
	const baseUrl = policy.base_url.replace(/\/+$/, "");
	const modelsUrl = `${baseUrl}/models`;
	let modelsResponse: Response;
	try {
		modelsResponse = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": GATEWAY_BROWSER_UA }, signal: AbortSignal.timeout(12_000) });
	} catch (error) {
		throw new Error(`research provider preflight failed at ${modelsUrl}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (modelsResponse.ok) {
		let payload: unknown;
		try { payload = await modelsResponse.json(); } catch { throw new Error("research provider /models returned invalid JSON"); }
		const ids = payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
			? ((payload as { data: unknown[] }).data).map((item) => item && typeof item === "object" ? (item as { id?: unknown }).id : undefined).filter((id): id is string => typeof id === "string")
			: [];
		if (!ids.includes(policy.model)) throw new Error(`research provider is reachable but does not list exact model "${policy.model}"`);
	} else {
		throw new Error(`research provider preflight failed at ${modelsUrl}: HTTP ${modelsResponse.status}`);
	}
	if (policy.api === "openai-responses") return preflightResponsesResearch(policy, apiKey, baseUrl);
	return preflightCompletionsResearch(policy, apiKey, baseUrl);
}

/** Responses-style probe: the only transport observed to echo
 * reasoning.effort back, so the provider-observed xhigh echo is required. */
async function preflightResponsesResearch(policy: ResearchModelConfig, apiKey: string, baseUrl: string): Promise<ResearchCapabilityProbeResult> {
	const modelId = policy.model;
	const probeUrl = `${baseUrl}/responses`;
	const probeBody: Record<string, unknown> = {
		model: modelId,
		input: "Call georsi_capability_probe with answer=1.",
		reasoning: { effort: policy.thinking_level },
		max_output_tokens: 256,
		tools: [{ type: "function", name: "georsi_capability_probe", description: "Record the capability probe answer.", parameters: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false }, strict: true }],
		tool_choice: { type: "function", name: "georsi_capability_probe" },
	};
	// Probe resilience comes from the unified gateway routing layer (research_gateways.*.resilience).
	const resilience = { ...RESEARCH_RESILIENCE_DEFAULTS, ...(policy.resilience ?? {}) };
	const response = await probeWithRetry("research Responses capability probe", probeUrl, apiKey, probeBody, resilience);
	let payload: Record<string, unknown>;
	try {
		const text = (await response.text()).slice(0, 128_000);
		payload = JSON.parse(text) as Record<string, unknown>;
	} catch {
		throw new Error(`research capability probe returned invalid JSON (HTTP ${response.status})`);
	}
	if (!response.ok) throw new Error(`research capability probe failed: HTTP ${response.status}`);
	if (payload.model !== modelId) throw new Error(`research capability probe returned model ${String(payload.model)} instead of ${modelId}`);
	if (payload.status !== undefined && payload.status !== "completed") throw new Error(`research capability probe did not complete: ${String(payload.status)}`);
	const reasoning = payload.reasoning && typeof payload.reasoning === "object" ? payload.reasoning as Record<string, unknown> : undefined;
	if (reasoning?.effort !== policy.thinking_level) throw new Error(`research capability probe did not echo provider-observed reasoning.effort=${policy.thinking_level} (got ${String(reasoning?.effort)})`);
	const rawUsage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
	const usage = {
		inputTokens: Number(rawUsage.input_tokens ?? rawUsage.prompt_tokens ?? 0),
		outputTokens: Number(rawUsage.output_tokens ?? rawUsage.completion_tokens ?? 0),
		totalTokens: Number(rawUsage.total_tokens ?? 0),
	};
	if (![usage.inputTokens, usage.outputTokens, usage.totalTokens].every((value) => Number.isSafeInteger(value) && value >= 0) || usage.outputTokens <= 0 || usage.totalTokens < usage.outputTokens) throw new Error("research capability probe did not return valid usage");
	const output = Array.isArray(payload.output) ? payload.output : [];
	const toolCallObserved = output.some((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "function_call" && (item as { name?: unknown }).name === "georsi_capability_probe");
	if (!toolCallObserved) throw new Error("research capability probe did not produce the required function call");
	const unsigned: Omit<ResearchCapabilityProbeResult, "fingerprint"> = { version: 1, provider: policy.provider, model: modelId, api: policy.api, endpoint: probeUrl, requestedThinking: "xhigh", effectiveThinking: "xhigh", toolCallObserved, usage };
	return { ...unsigned, fingerprint: researchProbeFingerprint(unsigned) };
}

async function preflightCompletionsResearch(policy: ResearchModelConfig, apiKey: string, baseUrl: string): Promise<ResearchCapabilityProbeResult> {
	const modelId = policy.model;
	if (policy.api !== "openai-completions") throw new Error("completions probe requires openai-completions");
	const probeUrl = `${baseUrl}/chat/completions`;
	const probeBody: Record<string, unknown> = {
		model: modelId,
		messages: [{ role: "user", content: "Call georsi_capability_probe with answer=1." }],
		reasoning_effort: policy.thinking_level,
		[policy.max_tokens_field]: 256,
		stream: false,
		tools: [{ type: "function", function: { name: "georsi_capability_probe", description: "Record the capability probe answer.", parameters: { type: "object", properties: { answer: { type: "integer" } }, required: ["answer"], additionalProperties: false }, strict: true } }],
		tool_choice: { type: "function", function: { name: "georsi_capability_probe" } },
	};
	// Probe resilience comes from the unified gateway routing layer (research_gateways.*.resilience).
	const completionsResilience = { ...RESEARCH_RESILIENCE_DEFAULTS, ...(policy.resilience ?? {}) };
	const response = await probeWithRetry("research OpenAI Completions capability probe", probeUrl, apiKey, probeBody, completionsResilience);
	let payload: Record<string, unknown>;
	try {
		const text = (await response.text()).slice(0, 128_000);
		payload = JSON.parse(text) as Record<string, unknown>;
	} catch {
		throw new Error(`research capability probe returned invalid JSON (HTTP ${response.status})`);
	}
	if (!response.ok) throw new Error(`research capability probe failed: HTTP ${response.status}`);
	if (payload.model !== modelId) throw new Error(`research capability probe returned model ${String(payload.model)} instead of ${modelId}`);
	const effectiveThinking = aiPixelResponseThinking(payload);
	if (effectiveThinking !== "xhigh") throw new Error("research capability probe did not return provider-observed effective xhigh metadata");
	const rawUsage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
	const usage = {
		inputTokens: Number(rawUsage.prompt_tokens ?? rawUsage.input_tokens ?? 0),
		outputTokens: Number(rawUsage.completion_tokens ?? rawUsage.output_tokens ?? 0),
		totalTokens: Number(rawUsage.total_tokens ?? 0),
	};
	if (![usage.inputTokens, usage.outputTokens, usage.totalTokens].every((value) => Number.isSafeInteger(value) && value >= 0) || usage.outputTokens <= 0 || usage.totalTokens < usage.outputTokens) throw new Error("research capability probe did not return valid usage");
	const choices = Array.isArray(payload.choices) ? payload.choices : [];
	const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>).message : undefined;
	const toolCalls = message && typeof message === "object" && Array.isArray((message as Record<string, unknown>).tool_calls) ? (message as Record<string, unknown>).tool_calls as unknown[] : [];
	const toolCallObserved = toolCalls.some((item) => item && typeof item === "object" && ((item as Record<string, unknown>).function as Record<string, unknown> | undefined)?.name === "georsi_capability_probe");
	if (!toolCallObserved) throw new Error("research capability probe did not produce the required function call");
	const unsigned: Omit<ResearchCapabilityProbeResult, "fingerprint"> = { version: 1, provider: policy.provider, model: modelId, api: policy.api, endpoint: probeUrl, requestedThinking: "xhigh", effectiveThinking: "xhigh", toolCallObserved, usage };
	return { ...unsigned, fingerprint: researchProbeFingerprint(unsigned) };
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
	credentials: { zen: string; local: string; openrouter: string; emooo: string; research?: string; aiPixel?: string },
	selectedModels: readonly string[],
): object {
	const selected = new Set(selectedModels);
	const mk = (m: ModelSpec) => ({
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
	const researchSpec = cfg.research_model ? researchModelSpec(cfg.research_model) : undefined;
	const researchModels = [
		...SUPPORTED_MODELS.filter((model) => selected.has(model.id) && (model.endpoint === "geiliapi" || model.endpoint === "alsl") && !model.retired),
		...(researchSpec && selected.has(researchSpec.id) ? [researchSpec] : []),
	];
	if (credentials.research && researchModels.length > 0) {
		const providerId = cfg.research_model?.provider ?? "geiliapi";
		providers[providerId] = {
			name: providerId,
			baseUrl: cfg.research_model?.base_url ?? cfg.geiliapi_base_url ?? "https://sub.geiliapi.com/v1",
			apiKey: credentials.research,
			api: cfg.research_model?.api ?? "openai-completions",
			headers: { "User-Agent": GATEWAY_BROWSER_UA },
			models: researchModels.map(mk),
		};
	}
	return { providers };
}

function providerIdForModel(cfg: Config, id: string, spec: ModelSpec): string {
	if (spec.endpoint === "research") return cfg.research_model?.provider ?? "research";
	if (spec.endpoint === "local") return "local";
	if (spec.endpoint === "openrouter") return "openrouter";
	if (spec.endpoint === "emooo") return "emooo";
	if (spec.endpoint === "alsl") return cfg.research_model?.provider ?? "alsl";
	if (spec.endpoint === "geiliapi") return cfg.research_model?.provider ?? "geiliapi";
	return "zen";
}

export interface PiRuntime {
	modelRuntime: ModelRuntime;
	inner: Model<any>;
	outer: Model<any>;
	researchProvider?: string;
	/** Provider capability evidence for the configured research model. */
	researchProbe?: AiPixelCapabilityProbeResult;
	/** @deprecated use researchProbe */
	aiPixelProbe?: AiPixelCapabilityProbeResult;
}

let cached: PiRuntime | null = null;
let cachedRuntimeKey: string | null = null;

function runtimeCacheKey(cfg: Config, root: string, selected: readonly string[], credentials: readonly string[]): string {
	return createHash("sha256").update(JSON.stringify({ cfg, root, selected })).update("\0").update(credentials.join("\0")).digest("hex");
}
/** The composed ModelRuntime; throws if getPiRuntime has not run yet. */
export function currentModelRuntime(): ModelRuntime {
	if (!cached) throw new Error("pi runtime not initialized: call getPiRuntime() first");
	return cached.modelRuntime;
}

/** Resolve any whitelisted model on the cached runtime (task-to-model routing). */
export function resolveModel(id: string): Model<any> {
	if (!cached) throw new Error("pi runtime not initialized: call getPiRuntime() first");
	const spec = modelSpec(id);
	if (!spec) throw new Error(`model "${id}" not in SUPPORTED_MODELS`);
	const provider = cached.researchProvider ? cached.researchProvider : providerIdForModel({} as Config, id, spec);
	const m = cached.modelRuntime.getModel(provider, id);
	if (!m) throw new Error(`model "${id}" not found on provider "${provider}"`);
	return m;
}

export async function getPiRuntime(cfg: Config, root: string): Promise<PiRuntime> {
	const selected = configuredModelIds(cfg, root);
	const specOf = (id: string): ModelSpec => {
		const spec = modelSpecForConfig(cfg, id);
		if (spec?.endpoint === "research") return spec;
		return assertSupportedModel("selected model", id);
	};
	const endpoints = new Set(selected.map((id) => specOf(id).endpoint));
	// Do not read unrelated credential files in a single-provider campaign.
	const apiKey = endpoints.has("zen") ? loadOptionalApiKey(root) : "";
	const localApiKey = endpoints.has("local") ? loadLocalApiKey(root) : "";
	const orApiKey = endpoints.has("openrouter") ? loadOpenRouterApiKey(root) : "";
	const emoooApiKey = endpoints.has("emooo") ? loadEmoooApiKey() : "";
	const researchPolicy = cfg.research_model;
	const researchApiKey = researchPolicy ? loadResearchApiKey(researchPolicy) : "";

	const cacheKey = runtimeCacheKey(cfg, root, selected, [apiKey, localApiKey, orApiKey, emoooApiKey, researchApiKey]);

	let researchProbe: AiPixelCapabilityProbeResult | undefined;
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
		if (spec.endpoint === "research") {
			if (!researchPolicy) throw new Error("research model route is missing research_model configuration");
			if (!researchApiKey) throw new Error(`research model "${researchPolicy.model}" selected but ${researchPolicy.credential_env} is not set`);
			researchProbe = await preflightResearchModel(researchPolicy, researchApiKey);
		}
	}

	if (cached && cachedRuntimeKey === cacheKey) return cached;

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
			research: researchApiKey,
			aiPixel: "",
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
		const provider = specOf(id).endpoint === "research" ? researchPolicy?.provider ?? "research" : providerIdForModel(cfg, id, specOf(id));
		const m = modelRuntime.getModel(provider, id);
		if (!m) {
			throw new Error(
				`model "${id}" not found on provider "${provider}" after composing pi-models.json` +
					(!localApiKey && specOf(id).endpoint === "local" ? " (local provider omitted: no key)" : !orApiKey && specOf(id).endpoint === "openrouter" ? " (openrouter provider omitted: no api_key_or.txt)" : !emoooApiKey && specOf(id).endpoint === "emooo" ? " (emooo provider omitted: set RSILAB_EMOOO_API_KEY)" : !researchApiKey && specOf(id).endpoint === "research" ? ` (research provider omitted: set ${researchPolicy?.credential_env ?? "research_model.credential_env"})` : ""),
			);
		}
		return m;
	};
	const inner = resolve(cfg.inner_model);
	const outer = resolve(cfg.outer_model);

	cached = { modelRuntime, inner, outer, researchProvider: researchPolicy?.provider, researchProbe, aiPixelProbe: researchProbe };
	cachedRuntimeKey = cacheKey;
	return cached;
}
