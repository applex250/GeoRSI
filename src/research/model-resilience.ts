/**
 * Gateway resilience policy shared by every model client.
 *
 * Two clients talk to the research gateway — the pi-harness path (`provider.ts`
 * capability probes, pi sessions) and the workspace agent's direct Responses
 * client (`workspace-model.ts`). Each used to carry its own copy of "which HTTP
 * statuses are transient", "how long to back off", "how to honour Retry-After"
 * and "when a silent stream is dead"; the copies drifted (linear vs exponential
 * backoff, `>= 500` vs an explicit set, Retry-After honoured on one side only).
 * This module is the single definition. It is pure: no I/O, no provider imports,
 * so the architecture gate keeps it importable from anywhere.
 */

/** Statuses worth another attempt. 501/505 and every 4xx other than 429 are deterministic. */
export const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

/** Retry-After values above this are treated as "the provider is down", not a wait. */
export const RETRY_AFTER_MAX_SECONDS = 60;

/**
 * Streaming idle policy. A long generation is fine as long as BYTES KEEP FLOWING:
 * the first byte gets a generous window (relays buffer whole responses), after
 * that a silent stream means the provider hiccuped. The hard ceiling bounds a
 * stream that keeps trickling forever. A flat total cap killed legitimate 4+
 * minute high-effort generations mid-stream.
 */
export const STREAM_FIRST_BYTE_IDLE_MS = 300_000;
export const STREAM_CHUNK_IDLE_MS = 120_000;
export const STREAM_HARD_CAP_MS = 900_000;

export interface RetryPolicy {
	/** Additional attempts after the first one. */
	retries: number;
	/** First backoff wait; doubles per attempt. */
	backoffMs: number;
	/** Ceiling for the doubled wait. */
	backoffCapMs: number;
}

export interface ResilienceKnobs {
	session_retries?: number;
	probe_attempts?: number;
	probe_backoff_ms?: number;
	probe_backoff_cap_ms?: number;
}

/** Derive the retry policy from a gateway's `resilience` block, clamped to sane bounds. */
export function retryPolicyFrom(knobs: ResilienceKnobs | undefined, fallback: { retries: number; backoffMs?: number; backoffCapMs?: number }): RetryPolicy {
	const backoffMs = Math.max(250, knobs?.probe_backoff_ms ?? fallback.backoffMs ?? 3_000);
	const backoffCapMs = Math.max(backoffMs, knobs?.probe_backoff_cap_ms ?? fallback.backoffCapMs ?? 20_000);
	const retries = Math.max(0, Math.min(10, knobs?.session_retries ?? fallback.retries));
	return { retries, backoffMs, backoffCapMs };
}

export function isTransientStatus(status: number): boolean {
	return TRANSIENT_HTTP_STATUSES.has(status);
}

/** Parse a Retry-After header into a wait in ms; 0 when absent, malformed, or beyond the ceiling. */
export function retryAfterHintMs(header: string | null | undefined, maxSeconds = RETRY_AFTER_MAX_SECONDS): number {
	if (!header) return 0;
	const seconds = Number(header);
	if (Number.isFinite(seconds)) return seconds > 0 && seconds <= maxSeconds ? Math.round(seconds * 1000) : 0;
	const at = Date.parse(header);
	if (!Number.isFinite(at)) return 0;
	const wait = at - Date.now();
	return wait > 0 && wait <= maxSeconds * 1000 ? wait : 0;
}

/**
 * Wait before `attempt` (1-based: the wait taken before the first retry is
 * attempt 1). Exponential, capped, and merged with the provider's Retry-After
 * into ONE wait — never the two added together.
 */
export function backoffWaitMs(attempt: number, policy: RetryPolicy, retryAfterMs = 0): number {
	const exponential = Math.min(policy.backoffMs * 2 ** Math.max(0, attempt - 1), policy.backoffCapMs);
	return Math.max(exponential, Math.max(0, retryAfterMs));
}

/** Mark an error as deterministic so retry loops stop spending money on it. */
export function nonRetryable<T extends Error>(error: T): T {
	return Object.assign(error, { nonRetryable: true as const });
}

export function isNonRetryable(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as { nonRetryable?: unknown }).nonRetryable === true;
}

/** Abortable sleep: a stop request must not wait out a 20 s backoff. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
		const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
		const onAbort = (): void => { clearTimeout(timer); reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted")); };
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export interface IdleWatchdog {
	/** Abort signal that fires when the stream goes silent for too long. */
	signal: AbortSignal;
	/** Call on every received chunk (and once before the request) to re-arm the timer. */
	touch(): void;
	/** Disarm; must run on every exit path or the timer keeps the process alive. */
	clear(): void;
}

/** Idle-based stream watchdog: first-byte window, then per-chunk window. */
export function createIdleWatchdog(firstByteMs = STREAM_FIRST_BYTE_IDLE_MS, chunkMs = STREAM_CHUNK_IDLE_MS): IdleWatchdog {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | null = null;
	let firstByte = true;
	const touch = (): void => {
		if (timer) clearTimeout(timer);
		const window = firstByte ? firstByteMs : chunkMs;
		timer = setTimeout(() => controller.abort(new Error(`Research gateway stream idle for ${Math.round(window / 1000)}s`)), window);
		firstByte = false;
	};
	const clear = (): void => { if (timer) { clearTimeout(timer); timer = null; } };
	return { signal: controller.signal, touch, clear };
}
