import { fetch, ProxyAgent } from "undici";
import type { ResearchModelConfig } from "../config.js";
import { backoffWaitMs, createIdleWatchdog, isNonRetryable, isTransientStatus, nonRetryable, retryAfterHintMs, retryPolicyFrom, sleep, STREAM_HARD_CAP_MS } from "./model-resilience.js";

export interface ModelReply { output?: Array<Record<string, unknown>>; usage?: { input_tokens?: number; output_tokens?: number }; status?: string; model?: string; error?: unknown }
export type ResearchModelCall = (input: unknown[], tools: unknown[], signal?: AbortSignal) => Promise<ModelReply>;

export interface WorkspaceModelHooks { onRetry?: (attempt: number, retries: number, waitMs: number, lastError: string) => void }
/** Uses the same authoritative gateway policy as the research engine. */
export function workspaceModel(policy: ResearchModelConfig, hooks: WorkspaceModelHooks = {}): ResearchModelCall {
  const key = process.env[policy.credential_env];
  if (!key) throw new Error("Research API credential is not configured");
  // Cache affinity: node tool loops resend an identical conversation prefix; the
  // Responses API prompt_cache_key pins routing so providers that implement
  // prefix caching can actually hit it instead of re-prefilling ~60k tokens.
  const promptCacheKey = `georsi-workspace-${process.pid}`;
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  // Same resilience contract as the research engine (model-resilience.ts): the
  // gateway registry carries session_retries/backoff knobs, transient statuses and
  // network errors retry with capped exponential backoff instead of failing a node.
  const retry = retryPolicyFrom(policy.resilience, { retries: 5 });
  return async (input, tools, signal) => {
    let lastError: unknown;
    let retryAfterMs = 0;
    for (let attempt = 0; attempt <= retry.retries; attempt += 1) {
      if (attempt > 0) {
        // Gateway Retry-After and our exponential backoff merge into ONE wait.
        const wait = backoffWaitMs(attempt, retry, retryAfterMs);
        retryAfterMs = 0;
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        console.log(`[research] gateway retry ${attempt}/${retry.retries} after ${wait}ms (last: ${message})`);
        hooks.onRetry?.(attempt, retry.retries, wait, message);
        await sleep(wait, signal);
      }
      // Streaming timeout policy lives in model-resilience.ts: generous first-byte
      // window, then per-chunk idle, plus a hard ceiling.
      const idle = createIdleWatchdog();
      const signals: AbortSignal[] = [idle.signal, AbortSignal.timeout(STREAM_HARD_CAP_MS)];
      if (signal) signals.unshift(signal);
      try {
        idle.touch();
        const response = await fetch(policy.base_url.replace(/\/$/, "") + "/responses", {
          method: "POST", dispatcher,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ model: policy.model, reasoning: { effort: policy.thinking_level }, input, tools, max_output_tokens: Math.min(policy.max_output, 16000), store: false, prompt_cache_key: promptCacheKey, stream: true }),
          signal: AbortSignal.any(signals),
        });
        if (response.ok) {
          const reply = await readStreamedResponse(response, idle.touch);
          if (reply.status === "failed") throw new Error(`Research gateway response failed: ${JSON.stringify(reply.error ?? {}).slice(0, 150)}`);
          if (reply.model && reply.model !== policy.model) {
            // Deterministic misconfiguration — retrying 10 times is pure waste.
            throw nonRetryable(new Error("Gateway returned an unexpected model"));
          }
          return reply;
        }
        const hint = retryAfterHintMs(response.headers.get("retry-after"));
        await response.body?.cancel();
        lastError = new Error(`Research gateway HTTP ${response.status}`);
        if (!isTransientStatus(response.status) || attempt === retry.retries) throw lastError;
        retryAfterMs = hint;
        continue;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
        if (isNonRetryable(error) || attempt === retry.retries) throw error;
      } finally {
        // Non-ok and throw paths previously leaked the armed timer: it kept the
        // process alive up to 120s after the run finished.
        idle.clear();
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
