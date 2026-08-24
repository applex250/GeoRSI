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
import { mkdirSync } from "node:fs";
import { TOKENS, currentModelRuntime } from "./provider.js";

export interface HarnessOpts {
	model: Model<any>;
	thinkingLevel: "off" | "low" | "medium" | "high";
	cwd: string;
	systemPrompt: string;
	customTools: ToolDefinition[];
	/** wall-clock cap per prompt() call */
	promptTimeoutMs: number;
	/** abort if no session event for this long */
	stallMs: number;
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

export class PiHarness {
	private session: AgentSession | null = null;
	readonly opts: HarnessOpts;
	private lastEventTs = Date.now();
	private disposed = false;

	constructor(opts: HarnessOpts) {
		this.opts = opts;
	}

	async init(): Promise<void> {
		mkdirSync(this.opts.cwd, { recursive: true });
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
		const { session } = await createAgentSession({
			model: this.opts.model,
			// without an explicit modelRuntime pi builds a default one that does
			// not know our gateway provider -> "No API key found"
			modelRuntime: currentModelRuntime(),
			thinkingLevel: this.opts.thinkingLevel,
			// the gateway throws bursty transient "finish_reason: network_error";
			// pi's default 3 retries can be exhausted inside one bad minute
			settingsManager: SettingsManager.inMemory({
				retry: { enabled: true, maxRetries: 6, baseDelayMs: 2000 },
			}),
			// NOTE: an explicit `tools` allowlist filters customTools too — the
			// custom tool names must be included or they silently vanish
			tools: [
				...(this.opts.builtinTools ?? ["read", "write", "edit", "ls", "grep"]),
				...this.opts.customTools.map((t) => t.name),
			],
			customTools: this.opts.customTools,
			cwd: this.opts.cwd,
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(this.opts.cwd),
		});
		this.session = session;
		session.subscribe((event) => {
			this.lastEventTs = Date.now();
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
	async prompt(text: string): Promise<PromptOutcome> {
		if (!this.session) throw new Error("harness not initialized");
		const t0 = Date.now();
		this.lastEventTs = Date.now();
		let timedOut = false;
		let stalled = false;

		const wall = setTimeout(() => {
			timedOut = true;
			void this.session?.abort();
		}, this.opts.promptTimeoutMs);

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

		let tokens = 0;
		try {
			const stats = this.session.getSessionStats();
			tokens = stats?.tokens?.total ?? 0;
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
