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
	/** statement.md relative to the problem dir */
	statement?: string;
	/** relative weight in suite fitness (default 1) */
	weight?: number;
	/** exclude from training suite; used only for held-out final exam */
	heldout?: boolean;
}

/**
 * Fixed model support list (verified 2026-08-24):
 *
 * GATEWAY (opencode.ai/zen/go/v1):
 *   hy3                       direct  chat/completions  ctx 256k / max-out 128k
 *   ox-alpha-free             direct  chat/completions  ctx 1m   / max-out 128k
 *   mimo-v2.5                 direct  chat/completions  ctx 1m   / max-out 128k
 *   muse-spark-1.2-contributor proxy  RESPONSES api     region-locked direct (403);
 *                                   works via local proxy + /v1/responses; chat endpoint
 *                                   unsupported (500); must NOT request reasoning params
 *                                   (gateway 400 reasoning.effort) -> reasoning:false.
 *
 * LOCAL (campus server, config `local_base_url`):
 *   dsv4f                     direct  chat/completions  ctx 256k / max-out 64k
 *                                   The server is turned off regularly — that is
 *                                   EXPECTED. provider.ts preflights it when selected
 *                                   and fails fast with a switch-model hint.
 *
 * Proxy routing: node's NODE_USE_ENV_PROXY is defeated because importing
 * pi-coding-agent swaps globalThis.fetch; instead provider.ts installs an
 * undici EnvHttpProxyAgent (shared global-dispatcher symbol) which honors
 * HTTP(S)_PROXY/NO_PROXY env — see enableEnvProxy(). The local server host is
 * always appended to noProxy so muse + dsv4f can coexist in one process.
 */
export interface ModelSpec {
	id: string;
	/** pi-ai API implementation selector */
	api: "openai-completions" | "openai-responses";
	/** how requests to this model must leave the machine */
	route: "direct" | "proxy";
	/** which endpoint serves this model */
	endpoint: "zen" | "local" | "openrouter";
	/** true context window, tokens (drives pi compaction decisions) */
	contextWindow: number;
	/** provider-advertised max output, tokens (informational; we cap lower) */
	maxOutput: number;
	note: string;
}

export const SUPPORTED_MODELS: ModelSpec[] = [
	{ id: "hy3", api: "openai-completions", route: "direct", endpoint: "zen", contextWindow: 262144, maxOutput: 131072, note: "fast, strong proposer (outer, default)" },
	{ id: "ox-alpha-free", api: "openai-completions", route: "direct", endpoint: "zen", contextWindow: 1048576, maxOutput: 131072, note: "fastest tool-caller; cheap inner alternative" },
	{ id: "mimo-v2.5", api: "openai-completions", route: "direct", endpoint: "zen", contextWindow: 1048576, maxOutput: 131072, note: "heavy reasoner (inner, default); slow but thorough" },
	{ id: "muse-spark-1.2-contributor", api: "openai-responses", route: "proxy", endpoint: "zen", contextWindow: 131072, maxOutput: 131072, note: "region-locked; proxy + Responses API only" },
	{ id: "dsv4f", api: "openai-completions", route: "direct", endpoint: "local", contextWindow: 262144, maxOutput: 65536, note: "campus-local deepseek; server downtime is normal" },
	{ id: "stealth/ox-alpha", api: "openai-completions", route: "direct", endpoint: "openrouter", contextWindow: 1048576, maxOutput: 131072, note: "OpenRouter free tier (429 under burst); reasoning mandatory; text+image+video input; quality flaky above medium effort" },
	{ id: "minimax/minimax-m3:free", api: "openai-completions", route: "direct", endpoint: "openrouter", contextWindow: 1048576, maxOutput: 131072, note: "OpenRouter free; reasoning model (params optional); fast (~2.5s); advertises image+video input but vision FAILED our red-square probe; cleanest free-tier stability (6/6)" },
];

export function modelSpec(id: string): ModelSpec | undefined {
	return SUPPORTED_MODELS.find((m) => m.id === id);
}

export interface Config {
	base_url: string;
	/** campus-local OpenAI-compatible server (may be down at any time) */
	local_base_url: string;
	/** OpenRouter gateway (optional; key in api_key_or.txt) */
	openrouter_base_url?: string;
	inner_model: string;
	outer_model: string;
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
		? (raw.problems as ProblemSpec[]).filter((p) => p && typeof p.id === "string")
		: [];
	if (problems.length === 0) {
		throw new Error("config.json: `problems` must list at least one problem id (directory under problems/)");
	}
	const inner = String(raw.inner_model ?? "mimo-v2.5");
	const outer = String(raw.outer_model ?? "hy3");
	for (const [role, id] of [["inner_model", inner], ["outer_model", outer]] as const) {
		if (!modelSpec(id)) {
			throw new Error(
				`config.json: ${role} "${id}" is not in the supported gateway list: ` +
					SUPPORTED_MODELS.map((m) => `${m.id} (${m.route}, ${m.api})`).join(", "),
			);
		}
	}
	return {
		base_url: String(raw.base_url ?? "https://opencode.ai/zen/go/v1"),
		local_base_url: String(raw.local_base_url ?? "http://172.27.116.56:8080/v1"),
		openrouter_base_url: String(raw.openrouter_base_url ?? "https://openrouter.ai/api/v1"),
		inner_model: inner,
		outer_model: outer,
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
		private_truth_dir: String(raw.private_truth_dir ?? "../rsi-lab-private"),
		problems,
		seed_scaffold: raw.seed_scaffold as Scaffold | undefined,
	};
}
