/**
 * pi session harness: one place that knows how to run a pi agent session
 * safely for unattended long runs.
 *
 * Watchdog discipline (each backed by a real failure mode observed in
 * OpenRSI_self's multi-day runs):
 *  - wall-clock cap per prompt: between-turns checks alone let a single
 *    hung turn eat hours.
 *  - stall detection: some gateways stream nothing and never error; if no
 *    session event arrives for `stallMs` we abort.
 *  - every exit path disposes the session so sockets/child procs never leak.
 *
 * Structured output uses the "tool capture" pattern: the model must call a
 * typebox-validated tool; parameters land in a closure object. After an
 * abort, whatever was captured before the hang is still usable.
 */
import { AgentSession, createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";
import { TOKENS, currentModelRuntime } from "./provider.js";
import { getProfile, resolveThinking, type ThinkingLevel } from "./models.js";
import { createExchangeToolDefinitions } from "./workspace-tools.js";

export interface HarnessOpts {
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	cwd: string;
	systemPrompt: string;
	customTools: ToolDefinition[];
	/** wall-clock cap per prompt() call */
	promptTimeoutMs: number;
	/** abort if no session event for this long */
	stallMs: number;
	/** explicitly attach the guarded exchange filesystem tools; default is true for inner sessions */
	exchangeTools?: boolean;
	/** optional guard run immediately before each trusted host file-tool operation */
	exchangeToolGuard?: () => void | Promise<void>;
	/** built-in tools to enable; agent file IO but no shell (cross-platform) */
	builtinTools?: string[];
	onText?: (delta: string) => void;
	/** live streaming of the model's reasoning/narration (for /research display) */
	onAgentDelta?: (kind: "thinking" | "text", delta: string) => void;
	/** tool call lifecycle for live display: start(args summary) / end(result tail) */
	onToolEvent?: (ev: { phase: "start" | "end"; tool: string; detail: string; isError?: boolean }) => void;
}

function argsSummary(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const a = args as Record<string, unknown>;
	const parts: string[] = [];
	for (const [k, v] of Object.entries(a).slice(0, 3)) {
		const s = typeof v === "string" ? v : JSON.stringify(v);
		parts.push(`${k}=${String(s).slice(0, 80)}`);
	}
	return parts.join(", ");
}

function resultTail(result: unknown): string {
	const r = result as { content?: { type?: string; text?: string }[] } | undefined;
	const text = (r?.content ?? [])
		.filter((c) => c.type === "text" && c.text)
		.map((c) => c.text)
		.join("\n");
	return text.replace(/\r?\n/g, " ⏎ ").slice(-240);
}

interface MessageLike {
	role?: unknown;
	content?: unknown;
	stopReason?: unknown;
	rawStopReason?: unknown;
	errorMessage?: unknown;
	usage?: unknown;
	provider?: unknown;
	model?: unknown;
}

function messageParts(message: MessageLike | undefined): Record<string, unknown>[] {
	return Array.isArray(message?.content)
		? (message.content.filter((part): part is Record<string, unknown> => !!part && typeof part === "object") as Record<string, unknown>[])
		: [];
}

function assistantMessageSummary(message: unknown): Record<string, unknown> {
	const m = (message && typeof message === "object" ? message : {}) as MessageLike;
	const parts = messageParts(m);
	const contentTypes = parts.map((p) => String(p.type ?? "unknown"));
	const textChars = parts.reduce((n, p) => {
		const text = typeof p.text === "string" ? p.text : "";
		return n + text.length;
	}, 0);
	const toolNames = parts
		.filter((p) => p.type === "toolCall")
		.map((p) => String(p.name ?? "?"));
	return {
		role: m.role,
		contentTypes,
		textChars,
		toolNames,
		stopReason: m.stopReason,
		rawStopReason: m.rawStopReason,
		errorMessage: typeof m.errorMessage === "string" ? m.errorMessage.slice(0, 300) : undefined,
		usage: m.usage,
		provider: m.provider,
		model: m.model,
	};
}

function lastAssistantMessage(messages: readonly unknown[]): MessageLike | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message && typeof message === "object" && (message as MessageLike).role === "assistant") {
			return message as MessageLike;
		}
	}
	return undefined;
}

function hasUsableAssistantContent(message: MessageLike | undefined): boolean {
	const parts = messageParts(message);
	return parts.some((p) => {
		if (p.type === "toolCall") return true;
		if (p.type === "text" || p.type === "thinking") return typeof p.text === "string" && p.text.length > 0;
		return false;
	});
}

export interface PromptOutcome {
	aborted: boolean;
	timedOut: boolean;
	stalled: boolean;
	error: string | null;
	tokens: number;
	secs: number;
}

/** Uniform tool result: text back to the model, no structured details. */
export function toolOutput(text: string): { content: { type: "text"; text: string }[]; details: undefined } {
	return { content: [{ type: "text", text }], details: undefined };
}

export function shouldAttachExchangeTools(builtinTools: string[] | undefined, explicit?: boolean): boolean {
	return explicit ?? builtinTools === undefined;
}

export function resolveHarnessThinking(model: Model<any>, requested: ThinkingLevel): Exclude<ThinkingLevel, "none"> {
	const modelId = (model as { id?: string }).id ?? "";
	try {
		const resolved = resolveThinking(modelId, requested);
		if (resolved.clamped || resolved.note) console.error(`[models] ${modelId}: ${resolved.note}`);
		const profile = getProfile(modelId);
		if (profile.reasoning.budget_param && resolved.extraBody[profile.reasoning.budget_param] !== undefined) {
			throw new Error(
				`${modelId}: ${profile.reasoning.budget_param} is required for ${resolved.level}, but the Pi TS harness cannot serialize that field; refusing a mislabeled reasoning request`,
			);
		}
		let level = resolved.level;
		if (level === "none") level = "low";
		if (level === "xhigh" || level === "max") {
			const mapped = model.thinkingLevelMap?.[level];
			if (mapped === undefined || mapped === null) level = "high";
		}
		return level as Exclude<ThinkingLevel, "none">;
	} catch (error) {
		throw new Error(`model thinking configuration failed for ${modelId || "unknown model"}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export class PiHarness {
	private session: AgentSession | null = null;
	readonly opts: HarnessOpts;
	private lastEventTs = Date.now();
	private disposed = false;
	/** session stats are cumulative; only the per-prompt delta is new usage */
	private lastSessionTokens = 0;
	/** env-gated raw event diagnostics (RSILAB_PROMPT_DIAG=1) */
	private _diagPath: string | null = null;

	constructor(opts: HarnessOpts) {
		this.opts = opts;
	}

	async init(): Promise<void> {
		mkdirSync(this.opts.cwd, { recursive: true });
		this._diagPath = process.env.RSILAB_PROMPT_DIAG ? join(this.opts.cwd, "prompt_diag.jsonl") : null;
		const thinkingLevel = resolveHarnessThinking(this.opts.model, this.opts.thinkingLevel);
		// Fully isolated resource loading: our system prompt only, no ambient
		// .pi context files, no skills discovery side effects.
		const agentDir = join(this.opts.cwd, ".pi-agent");
		mkdirSync(agentDir, { recursive: true });
		const loader = new DefaultResourceLoader({
			cwd: this.opts.cwd,
			agentDir,
			systemPromptOverride: () => this.opts.systemPrompt,
			appendSystemPromptOverride: () => [],
		});
		await loader.reload();
		const exchangeTools = shouldAttachExchangeTools(this.opts.builtinTools, this.opts.exchangeTools)
			? createExchangeToolDefinitions(this.opts.cwd, this.opts.exchangeToolGuard)
			: [];
		const customTools = [...exchangeTools, ...this.opts.customTools];
		const { session } = await createAgentSession({
			model: this.opts.model,
			// without an explicit modelRuntime pi builds a default one that does
			// not know our gateway provider -> "No API key found"
			modelRuntime: currentModelRuntime(),
			thinkingLevel: thinkingLevel as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
			// the gateway throws bursty transient "finish_reason: network_error";
			// pi's default 3 retries can be exhausted inside one bad minute
			settingsManager: SettingsManager.inMemory({
				retry: { enabled: true, maxRetries: 6, baseDelayMs: 2000 },
			}),
			// NOTE: an explicit `tools` allowlist filters customTools too — the
			// custom tool names must be included or they silently vanish
			tools: [
				...(this.opts.builtinTools ?? ["read", "write", "edit", "ls", "grep"]),
				...customTools.map((t) => t.name),
			],
			customTools,
			cwd: this.opts.cwd,
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(this.opts.cwd),
		});
		this.session = session;
		session.subscribe((event) => {
			this.lastEventTs = Date.now();
			if (this._diagPath) {
				try {
					const e = event as {
						type?: string;
						message?: unknown;
						messages?: unknown[];
						error?: unknown;
					};
					appendFileSync(
						this._diagPath,
						JSON.stringify({
							ts: Date.now(),
							type: e.type,
							eventKeys: Object.keys(e),
							err: e.error ? String(e.error).slice(0, 300) : undefined,
							message: e.message ? assistantMessageSummary(e.message) : undefined,
							messageCount: Array.isArray(e.messages) ? e.messages.length : undefined,
						}) + "\n",
					);
				} catch {
					/* diagnostics must never break the stream */
				}
			}
			if (event.type === "message_update") {
				const ev = (event as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
				if (!ev) return;
				if (ev.type === "text_delta") {
					if (this.opts.onText) this.opts.onText(ev.delta ?? "");
					if (this.opts.onAgentDelta) this.opts.onAgentDelta("text", ev.delta ?? "");
				} else if (ev.type === "thinking_delta") {
					if (this.opts.onAgentDelta) this.opts.onAgentDelta("thinking", ev.delta ?? "");
				}
				return;
			}
			if (this.opts.onToolEvent) {
				const e = event as {
					type: string;
					toolName?: string;
					args?: unknown;
					result?: unknown;
					isError?: boolean;
				};
				if (e.type === "tool_execution_start") {
					this.opts.onToolEvent({ phase: "start", tool: e.toolName ?? "?", detail: argsSummary(e.args) });
				} else if (e.type === "tool_execution_end") {
					this.opts.onToolEvent({
						phase: "end",
						tool: e.toolName ?? "?",
						detail: resultTail(e.result),
						isError: e.isError === true,
					});
				}
			}
		});
	}

	/** Run one prompt under both watchdogs. Never throws; outcome carries status. */
	async prompt(text: string, timeoutOverrideMs?: number): Promise<PromptOutcome> {
		if (!this.session) throw new Error("harness not initialized");
		const t0 = Date.now();
		this.lastEventTs = Date.now();
		let timedOut = false;
		let stalled = false;

		const timeoutMs = Math.max(1, Math.min(this.opts.promptTimeoutMs, timeoutOverrideMs ?? this.opts.promptTimeoutMs));
		const wall = setTimeout(() => {
			timedOut = true;
			void this.session?.abort();
		}, timeoutMs);

		const stall = setInterval(() => {
			if (Date.now() - this.lastEventTs > this.opts.stallMs) {
				stalled = true;
				void this.session?.abort();
			}
		}, Math.max(5000, Math.floor(this.opts.stallMs / 4)));

		let error: string | null = null;
		try {
			await this.session.prompt(text);
		} catch (e) {
			error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e).slice(0, 300);
		} finally {
			clearTimeout(wall);
			clearInterval(stall);
		}

		const assistant = lastAssistantMessage(this.session.messages);
		if (!error && !timedOut && !stalled && !hasUsableAssistantContent(assistant)) {
			const detail = typeof assistant?.errorMessage === "string"
				? assistant.errorMessage.slice(0, 300)
				: typeof assistant?.stopReason === "string"
					? `stopReason=${assistant.stopReason}`
					: "no text or tool call";
			error = `empty assistant response: ${detail}`;
		}

		let tokens = 0;
		try {
			const stats = this.session.getSessionStats();
			const total = stats?.tokens?.total ?? 0;
			tokens = Math.max(0, total - this.lastSessionTokens);
			this.lastSessionTokens = total;
		} catch {
			/* stats are best-effort */
		}
		TOKENS.total += tokens;
		TOKENS.calls += 1;
		if (timedOut || stalled || error) TOKENS.failed += 1;

		return {
			aborted: timedOut || stalled,
			timedOut,
			stalled,
			error,
			tokens,
			secs: (Date.now() - t0) / 1000,
		};
	}

	dispose(): void {
		if (this.disposed || !this.session) return;
		this.disposed = true;
		try {
			this.session.dispose();
		} catch {
			/* dispose must never take the loop down */
		}
		this.session = null;
	}
}
