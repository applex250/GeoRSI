import { fetch, ProxyAgent } from "undici";
import type { ResearchModelConfig } from "../config.js";

export interface ModelReply { output?: Array<Record<string, unknown>>; usage?: { input_tokens?: number; output_tokens?: number }; status?: string; model?: string; error?: unknown }
export type ResearchModelCall = (input: unknown[], tools: unknown[], signal?: AbortSignal) => Promise<ModelReply>;
/** Uses the same authoritative gateway policy as the research engine. */
const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error("aborted"));
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
});

export interface WorkspaceModelHooks { onRetry?: (attempt: number, retries: number, waitMs: number, lastError: string) => void }
export function workspaceModel(policy: ResearchModelConfig, hooks: WorkspaceModelHooks = {}): ResearchModelCall {
  const key = process.env[policy.credential_env];
  if (!key) throw new Error("Research API credential is not configured");
  // Cache affinity: node tool loops resend an identical conversation prefix; the
  // Responses API prompt_cache_key pins routing so providers that implement
  // prefix caching can actually hit it instead of re-prefilling ~60k tokens.
  const promptCacheKey = `georsi-workspace-${process.pid}`;
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  // Same resilience contract as the research engine: the gateway registry carries
  // session_retries/backoff knobs, transient statuses (429/5xx) and network errors
  // retry with capped exponential backoff instead of failing a whole research node.
  const retries = Math.max(0, Math.min(10, policy.resilience?.session_retries ?? 5));
  const backoffMs = Math.max(250, policy.resilience?.probe_backoff_ms ?? 3000);
  const backoffCap = Math.max(backoffMs, policy.resilience?.probe_backoff_cap_ms ?? 20000);
  return async (input, tools, signal) => {
    let lastError: unknown;
    let retryAfterHintMs = 0;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) {
        // Gateway Retry-After and our exponential backoff merge into ONE wait.
        const wait = Math.max(Math.min(backoffMs * 2 ** (attempt - 1), backoffCap), retryAfterHintMs);
        retryAfterHintMs = 0;
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        console.log(`[research] gateway retry ${attempt}/${retries} after ${wait}ms (last: ${message})`);
        hooks.onRetry?.(attempt, retries, wait, message);
        await sleep(wait, signal);
      }
      // Streaming timeout policy: a long generation is fine as long as BYTES KEEP
      // FLOWING. First byte gets a generous window (relays may buffer); after that,
      // 120s of stream silence means the provider hiccuped — abort and retry. Hard
      // ceiling 15 minutes. The old flat 240s cap killed legitimate 4+ minute
      // high-effort generations mid-stream.
      const idleController = new AbortController();
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let firstByte = true;
      const armIdle = (): void => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => idleController.abort(new Error(`Research gateway stream idle for ${firstByte ? 300 : 120}s`)), firstByte ? 300_000 : 120_000);
        firstByte = false;
      };
      const signals: AbortSignal[] = [idleController.signal, AbortSignal.timeout(900_000)];
      if (signal) signals.unshift(signal);
      try {
        armIdle();
        const response = await fetch(policy.base_url.replace(/\/$/, "") + "/responses", {
          method: "POST", dispatcher,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ model: policy.model, reasoning: { effort: policy.thinking_level }, input, tools, max_output_tokens: Math.min(policy.max_output, 16000), store: false, prompt_cache_key: promptCacheKey, stream: true }),
          signal: AbortSignal.any(signals),
        });
        if (response.ok) {
          const reply = await readStreamedResponse(response, armIdle);
          if (reply.status === "failed") throw new Error(`Research gateway response failed: ${JSON.stringify(reply.error ?? {}).slice(0, 150)}`);
          if (reply.model && reply.model !== policy.model) {
            // Deterministic misconfiguration — retrying 10 times is pure waste.
            throw Object.assign(new Error("Gateway returned an unexpected model"), { nonRetryable: true });
          }
          return reply;
        }
        const retryAfter = Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        lastError = new Error(`Research gateway HTTP ${response.status}`);
        const transient = [429, 500, 502, 503, 504].includes(response.status);
        if (!transient || attempt === retries) throw lastError;
        if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 60) retryAfterHintMs = retryAfter * 1000;
        continue;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
        if ((error as { nonRetryable?: boolean }).nonRetryable || attempt === retries) throw error;
      } finally {
        // Non-ok and throw paths previously leaked the armed timer: it kept the
        // process alive up to 120s after the run finished.
        if (idleTimer) clearTimeout(idleTimer);
      }
    }
    throw lastError;
  };
}
/** Read a Responses-API SSE stream until response.completed carries the full
 * response. Streaming is not an optimization here — sync-mode relays give up on
 * long generations (504) while the upstream keeps billing; with stream:true the
 * first bytes arrive early and the gateway never idle-times-out the request. */
export async function readStreamedResponse(response: Awaited<ReturnType<typeof fetch>>, touch: () => void = () => {}): Promise<ModelReply> {
  const body = response.body;
  if (!body) throw new Error("Research gateway returned no stream body");
  const decoder = new TextDecoder();
  let buffer = "";
  // Some relays emit response.completed with an EMPTY output array — assemble
  // items ourselves from the per-item done events (they carry full items).
  const items: Array<{ output_index: number; item: Record<string, unknown> }> = [];
  for await (const chunk of body) {
    touch();
    buffer += decoder.decode(chunk, { stream: true });
    let index: number;
		while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith("data:")) continue;
      const text = line.slice(5).trim();
      if (!text || text === "[DONE]") continue;
      let parsed: { type?: string; response?: ModelReply; item?: Record<string, unknown>; output_index?: number };
      try { parsed = JSON.parse(text); } catch { continue; }
      if (parsed.type === "response.output_item.done" && parsed.item) {
        const position = items.findIndex((entry) => entry.item.id === parsed.item!.id);
        const record = { output_index: parsed.output_index ?? items.length, item: parsed.item };
        if (position >= 0) items[position] = record; else items.push(record);
        continue;
      }
      if ((parsed.type === "response.completed" || parsed.type === "response.incomplete") && parsed.response) {
        if (!parsed.response.output?.length && items.length) parsed.response.output = items.sort((left, right) => left.output_index - right.output_index).map((entry) => entry.item) as ModelReply["output"];
        return parsed.response;
      }
      if (parsed.type === "response.failed" || parsed.type === "error") throw new Error(`Research gateway stream error: ${text.slice(0, 200)}`);
    }
  }
  throw new Error("Research gateway stream ended without completion");
}

export function replyText(reply: ModelReply): string {
  return (reply.output ?? []).filter((item) => item.type === "message").flatMap((item) => (item.content ?? []) as Array<{ type: string; text?: string }>).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n");
}
export function parseModelJson(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}
