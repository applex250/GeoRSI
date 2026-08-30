/**
 * GeoRSI configuration loading + validation.
 *
 * config.json is the single place for models, budgets, and the problem suite.
 * Everything has a default so a minimal file works.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Scaffold } from "./scaffold.js";

export interface ProblemSpec {
	id: string;
	/** explicit task-family/scope key */
	genre?: string;
	/** statement.md relative to the problem dir */
	statement?: string;
	/** relative weight in suite fitness (default 1) */
	weight?: number;
	/** exclude from training suite; used only for held-out final exam */
	heldout?: boolean;
}

/**
 * Fixed model support list (verified 2026-08-28):
 *
 * GATEWAY (opencode.ai/zen/go/v1):
 *   hy3                       direct  chat/completions  ctx 256k / max-out 128k
 *   mimo-v2.5                 direct  chat/completions  ctx 1m   / max-out 128k
 *   muse-spark-1.2-contributor proxy  RESPONSES api     region-locked direct (403);
 *                                   works via local proxy + /v1/responses; chat endpoint
 *                                   unsupported (500); must NOT request reasoning params
 *                                   (gateway 400 reasoning.effort) -> reasoning:false.
 *   ox-alpha-free and stealth/ox-alpha are retained as retired historical ids.
 *
 * TEMPORARY EMOOO (api.emooo.cc/v1, key only from RSILAB_EMOOO_API_KEY):
 *   mimo-v2.5-pro             direct  chat/completions  ctx 1m   / max-out 128k
 *                             thinking/zai format; minimal/low/medium/high/xhigh verified 2026-08-28
 *
 * LOCAL (campus server, config `local_base_url`):
 *   dsv4f                     direct  chat/completions  ctx 256k / max-out 64k
 *                                   The server is turned off regularly — that is
 *                                   EXPECTED. provider.ts preflights it when selected
 *                                   and fails fast with a switch-model hint.
 *
 * OPENROUTER:
 *   z-ai/glm-5.3-flash       chat/completions ctx 1m / max-out 128k
 *   minimax/minimax-m3:free  chat/completions ctx 1m / max-out 128k
 *
 * Proxy routing: node's NODE_USE_ENV_PROXY is defeated because importing
 * pi-coding-agent swaps globalThis.fetch; instead provider.ts installs an
 * undici EnvHttpProxyAgent (shared global-dispatcher symbol) which honors
 * HTTP(S)_PROXY/NO_PROXY env — see enableEnvProxy(). The local server host is
 * always appended to noProxy so muse + dsv4f can coexist in one process.
 */
export interface ModelCompatSpec {
	/** OpenAI-compatible request-shape overrides for custom gateways. */
	supportsDeveloperRole?: boolean;
	supportsReasoningEffort?: boolean;
	supportsUsageInStreaming?: boolean;
	supportsFinishReason?: boolean;
	supportsStrictMode?: boolean;
	maxTokensField?: "max_tokens" | "max_completion_tokens";
	thinkingFormat?: "openai" | "openrouter" | "deepseek" | "together" | "baseten" | "zai" | "qwen" | "chat-template" | "qwen-chat-template" | "string-thinking" | "ant-ling";
}

export interface ModelSpec {
	id: string;
	/** pi-ai provider values for extended reasoning levels; null disables a level */
	thinkingLevelMap?: Partial<Record<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max", string | null>>;
	/** pi-ai API implementation selector */
	api: "openai-completions" | "openai-responses";
	/** how requests to this model must leave the machine */
	route: "direct" | "proxy";
	/** which endpoint serves this model */
	endpoint: "zen" | "local" | "openrouter" | "emooo";
	/** true context window, tokens (drives pi compaction decisions) */
	contextWindow: number;
	/** provider-advertised max output, tokens (informational; we cap lower) */
	maxOutput: number;
	/** provider no longer serves this id; retained only for historical reports */
	retired?: boolean;
	note: string;
	compat?: ModelCompatSpec;
}

export const SUPPORTED_MODELS: ModelSpec[] = [
	{ id: "hy3", api: "openai-completions", route: "direct", endpoint: "zen", contextWindow: 262144, maxOutput: 131072, thinkingLevelMap: { xhigh: "xhigh", max: null }, note: "fast, strong proposer (outer, default)" },
	{ id: "ox-alpha-free", api: "openai-completions", route: "direct", endpoint: "zen", contextWindow: 1048576, maxOutput: 131072, retired: true, note: "DEPRECATED 2026-08-27: gateway removed the model (401 ModelError on every call)" },
	{ id: "mimo-v2.5", api: "openai-completions", route: "direct", endpoint: "zen", contextWindow: 1048576, maxOutput: 131072, note: "heavy reasoner (inner, default); slow but thorough" },
	{ id: "mimo-v2.5-pro", api: "openai-completions", route: "direct", endpoint: "emooo", contextWindow: 1048576, maxOutput: 131072, thinkingLevelMap: { xhigh: "xhigh", max: null }, compat: { thinkingFormat: "zai", supportsReasoningEffort: true, supportsDeveloperRole: false, supportsUsageInStreaming: true, supportsFinishReason: true, supportsStrictMode: false, maxTokensField: "max_tokens" }, note: "temporary emooo.cc route; chat/completions selected over Responses after live probe; thinking enabled/disabled with minimal/low/medium/high/xhigh" },
	{ id: "muse-spark-1.2-contributor", api: "openai-responses", route: "proxy", endpoint: "zen", contextWindow: 131072, maxOutput: 131072, note: "region-locked; proxy + Responses API only" },
	{ id: "dsv4f", api: "openai-completions", route: "direct", endpoint: "local", contextWindow: 262144, maxOutput: 65536, note: "campus-local deepseek; server downtime is normal" },
	{ id: "stealth/ox-alpha", api: "openai-completions", route: "direct", endpoint: "openrouter", contextWindow: 1048576, maxOutput: 131072, retired: true, note: "DEPRECATED 2026-08-27: OpenRouter testing alias returned 404 and points to z-ai/glm-5.3-flash" },
	{ id: "minimax/minimax-m3:free", api: "openai-completions", route: "direct", endpoint: "openrouter", contextWindow: 1048576, maxOutput: 131072, note: "OpenRouter free; reasoning model (params optional); fast (~2.5s); vision VERIFIED 4/4 on standard scene; cleanest free-tier stability (6/6)" },
	{ id: "z-ai/glm-5.3-flash", api: "openai-completions", route: "direct", endpoint: "openrouter", contextWindow: 1048576, maxOutput: 131072, thinkingLevelMap: { max: "max", xhigh: null }, note: "OpenRouter live replacement for stealth/ox-alpha; mandatory reasoning; multimodal; verified 2026-08-27" },
];

export function modelSpec(id: string): ModelSpec | undefined {
	return SUPPORTED_MODELS.find((m) => m.id === id);
}

export type ConfigThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const CONFIG_THINKING_LEVELS = new Set<ConfigThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function optionalThinkingLevel(value: unknown, label: string): ConfigThinkingLevel | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value === "string" && CONFIG_THINKING_LEVELS.has(value as ConfigThinkingLevel)) {
		return value as ConfigThinkingLevel;
	}
	throw new Error(`${label} must be one of: ${[...CONFIG_THINKING_LEVELS].join(", ")}`);
}

export function assertSupportedModel(label: string, id: string): ModelSpec {
	const spec = modelSpec(id);
	if (!spec) {
		throw new Error(
			`config.json: ${label} "${id}" is not in the supported gateway list: ` +
				SUPPORTED_MODELS.map((model) => `${model.id} (${model.route}, ${model.api})`).join(", "),
		);
	}
	if (spec.retired) {
		throw new Error(
			`config.json: ${label} "${id}" is retired by the provider; choose a live profile`,
		);
	}
	return spec;
}

export interface Config {
	base_url: string;
	/** campus-local OpenAI-compatible server (may be down at any time) */
	local_base_url: string;
	/** OpenRouter gateway (optional; key in api_key_or.txt) */
	openrouter_base_url?: string;
	/** optional OpenAI-compatible temporary emooo.cc endpoint */
	emooo_base_url?: string;
	inner_model: string;
	/** optional model reasoning level; profile clamps it to the provider's verified levels */
	inner_thinking_level?: ConfigThinkingLevel;
	/** default inner for quiz-type problems when set (task-to-model routing) */
	quiz_inner_model?: string;
	/** enable deterministic authored RAG retrieval at episode start */
	rag_enabled?: boolean;
	/** max chars of retrieved material per episode */
	rag_budget_chars?: number;
	outer_model: string;
	/** optional reasoning level for goal/proposal/critique calls */
	outer_thinking_level?: ConfigThinkingLevel;
	generations: number;
	proposals: number;
	critics: number;
	survivors: number;
	max_turns: number;
	/** hard wall-clock cap per inner episode, seconds */
	episode_timeout_s: number;
	/** foreground python script cap per run_python call, seconds */
	script_timeout_s: number;
	/** hard cap for a background job (start_job), seconds */
	job_timeout_s: number;
	/** how often the episode driver polls running background jobs, seconds */
	job_poll_s: number;
	/** max public submissions per episode */
	eval_cap: number;
	/** stop inner loop after N submissions without public-score improvement */
	patience: number;
	stagnation_limit: number;
	cost_cap_tokens: number;
	/** seconds between watchdog stall checks */
	stall_s: number;
	problems: ProblemSpec[];
	/** number of independent episodes averaged per problem in suite eval */
	episodes_per_problem: number;
	python_cmd: string;
	/**
	 * Python execution backend. On Windows the default is Sandboxie-Plus;
	 * `host-audit` is an explicit compatibility mode and is not isolation.
	 */
	execution_backend?: "sandboxie" | "host-audit";
	/** optional absolute/installed Sandboxie paths for deterministic CI */
	sandboxie_start_path?: string;
	sandboxie_ini_path?: string;
	/** exchange root; strict episodes are placed outside the repository */
	sandboxie_exchange_root?: string;
	/** Sandboxie virtual root for ephemeral boxes */
	sandboxie_root?: string;
	/**
	 * Python execution policy. "audit" preserves the current research workflow
	 * and records known escape-hatch usage; "restricted" blocks common
	 * subprocess/network imports before launch. Neither is an OS sandbox.
	 */
	execution_policy?: "audit" | "restricted";
	/** paths relative to lab root */
	private_truth_dir: string;
	seed_scaffold?: Scaffold;
}

export const ROOT = process.cwd();

function loadJson(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (e) {
		throw new Error(`cannot parse ${path}: ${e}`);
	}
}

export interface ProblemRuntimeOverride {
	execution_backend?: Config["execution_backend"];
	execution_policy?: Config["execution_policy"];
	python_cmd?: string;
	max_turns?: number;
	eval_cap?: number;
	episode_timeout_s?: number;
	patience?: number;
	script_timeout_s?: number;
	job_timeout_s?: number;
}

export function applyProblemRuntimeOverride(base: Config, override: ProblemRuntimeOverride): Config {
	return {
		...base,
		execution_backend: override.execution_backend ?? base.execution_backend,
		execution_policy: override.execution_policy ?? base.execution_policy,
		python_cmd: override.python_cmd ?? base.python_cmd,
		max_turns: override.max_turns ?? base.max_turns,
		eval_cap: override.eval_cap ?? base.eval_cap,
		episode_timeout_s: override.episode_timeout_s ?? base.episode_timeout_s,
		patience: override.patience ?? base.patience,
		script_timeout_s: override.script_timeout_s ?? base.script_timeout_s,
		job_timeout_s: override.job_timeout_s ?? base.job_timeout_s,
	};
}

export function configuredModelIds(cfg: Config, root = ROOT): string[] {
	const ids = [cfg.inner_model, cfg.outer_model, cfg.quiz_inner_model].filter((id): id is string => !!id);
	for (const problem of cfg.problems) {
		const path = join(root, "problems", problem.id, "problem.json");
		if (!existsSync(path)) continue;
		try {
			const raw = JSON.parse(readFileSync(path, "utf8")) as { inner_model?: unknown };
			if (typeof raw.inner_model === "string" && raw.inner_model.trim()) ids.push(raw.inner_model.trim());
		} catch {
			// Provider discovery does not invent routes from malformed metadata;
			// loadProblems reports the task metadata failure when it is evaluated.
		}
	}
	return [...new Set(ids)];
}


function num(v: unknown, dflt: number): number {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : dflt;
}

export function loadConfig(path?: string): Config {
	const raw = loadJson(path ?? join(ROOT, "config.json"));
	// suite mechanism: problems_file lists extra problems (quiz chunk batches)
	// so config.json stays clean when dozens of benchmark chunks are registered
	if (typeof raw.problems_file === "string" && existsSync(join(ROOT, raw.problems_file))) {
		const suite = JSON.parse(readFileSync(join(ROOT, raw.problems_file), "utf8")) as { problems?: ProblemSpec[] };
		const merged = [...(Array.isArray(raw.problems) ? raw.problems : []), ...(suite.problems ?? [])];
		// dedupe by id (first occurrence wins): config entries override suite ones
		const seen = new Set<string>();
		raw.problems = merged.filter((p) => {
			if (!p || typeof p.id !== "string") return true;
			if (seen.has(p.id)) return false;
			seen.add(p.id);
			return true;
		});
	}
	const problems = Array.isArray(raw.problems)
		? (raw.problems as ProblemSpec[]).filter((problem) => problem && typeof problem.id === "string" && problem.id.trim().length > 0)
		: [];
	if (problems.length === 0) {
		throw new Error("config.json: `problems` must list at least one problem id (directory under problems/)");
	}
	const duplicateProblem = problems.find((problem, index) => problems.findIndex((candidate) => candidate.id === problem.id) !== index);
	if (duplicateProblem) throw new Error(`config.json: duplicate problem id "${duplicateProblem.id}"`);
	for (const problem of problems) {
		if (problem.weight !== undefined && (!Number.isFinite(problem.weight) || problem.weight <= 0)) {
			throw new Error(`config.json: problem "${problem.id}" weight must be a positive finite number`);
		}
	}
	const inner = String(raw.inner_model ?? "mimo-v2.5");
	const outer = String(raw.outer_model ?? "hy3");
	const quizInner = typeof raw.quiz_inner_model === "string" ? String(raw.quiz_inner_model) : undefined;
	assertSupportedModel("inner_model", inner);
	assertSupportedModel("outer_model", outer);
	if (quizInner) assertSupportedModel("quiz_inner_model", quizInner);
	return {
		base_url: String(raw.base_url ?? "https://opencode.ai/zen/go/v1"),
		local_base_url: String(raw.local_base_url ?? "http://172.27.116.56:8080/v1"),
		openrouter_base_url: String(raw.openrouter_base_url ?? "https://openrouter.ai/api/v1"),
		emooo_base_url: String(raw.emooo_base_url ?? "https://api.emooo.cc/v1"),
		inner_model: inner,
		inner_thinking_level: optionalThinkingLevel(raw.inner_thinking_level, "config.json: inner_thinking_level"),
		quiz_inner_model: quizInner,
		rag_enabled: raw.rag_enabled === true,
		rag_budget_chars: num(raw.rag_budget_chars, 2400),
		outer_model: outer,
		outer_thinking_level: optionalThinkingLevel(raw.outer_thinking_level, "config.json: outer_thinking_level"),
		generations: num(raw.generations, 4),
		proposals: num(raw.proposals, 3),
		critics: num(raw.critics, 1),
		survivors: num(raw.survivors, 1),
		max_turns: num(raw.max_turns, 12),
		episode_timeout_s: num(raw.episode_timeout_s, 900),
		script_timeout_s: num(raw.script_timeout_s, 120),
		job_timeout_s: num(raw.job_timeout_s, 14_400),
		job_poll_s: num(raw.job_poll_s, 30),
		eval_cap: num(raw.eval_cap, 6),
		patience: num(raw.patience, 3),
		stagnation_limit: num(raw.stagnation_limit, 3),
		cost_cap_tokens: num(raw.cost_cap_tokens, 2_000_000),
		stall_s: num(raw.stall_s, 240),
		episodes_per_problem: num(raw.episodes_per_problem, 1),
		python_cmd: String(raw.python_cmd ?? "python"),
		execution_backend:
			raw.execution_backend === "host-audit" ? "host-audit" : raw.execution_backend === "sandboxie" ? "sandboxie" : undefined,
		sandboxie_start_path: typeof raw.sandboxie_start_path === "string" ? raw.sandboxie_start_path : undefined,
		sandboxie_ini_path: typeof raw.sandboxie_ini_path === "string" ? raw.sandboxie_ini_path : undefined,
		sandboxie_exchange_root: typeof raw.sandboxie_exchange_root === "string" ? raw.sandboxie_exchange_root : undefined,
		sandboxie_root: typeof raw.sandboxie_root === "string" ? raw.sandboxie_root : undefined,
		execution_policy:
			raw.execution_policy === "restricted" ? "restricted" : raw.execution_policy === "audit" ? "audit" : undefined,
		private_truth_dir: String(raw.private_truth_dir ?? "../rsi-lab-private"),
		problems,
		seed_scaffold: raw.seed_scaffold as Scaffold | undefined,
	};
}
