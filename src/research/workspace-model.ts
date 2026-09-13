import { fetch, ProxyAgent } from "undici";
import type { ResearchModelConfig } from "../config.js";

export interface ModelReply { output?: Array<Record<string, unknown>>; usage?: { input_tokens?: number; output_tokens?: number }; status?: string; model?: string }
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
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) {
        const wait = Math.min(backoffMs * 2 ** (attempt - 1), backoffCap);
        console.log(`[research] gateway retry ${attempt}/${retries} after ${wait}ms (last: ${lastError instanceof Error ? lastError.message : String(lastError)})`);
hooks.onRetry?.(attempt, retries, wait, lastError instanceof Error ? lastError.message : String(lastError));
        await sleep(wait, signal);
      }
      try {
        const response = await fetch(policy.base_url.replace(/\/$/, "") + "/responses", {
          method: "POST", dispatcher,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: policy.model, reasoning: { effort: policy.thinking_level }, input, tools, max_output_tokens: Math.min(policy.max_output, 10000), store: false, prompt_cache_key: promptCacheKey }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(240000)]) : AbortSignal.timeout(240000),
        });
        if (response.ok) {
          const reply = await response.json() as ModelReply;
          if (reply.model && reply.model !== policy.model) throw new Error("Gateway returned an unexpected model");
          return reply;
        }
        const retryAfter = Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        lastError = new Error(`Research gateway HTTP ${response.status}`);
        const transient = [429, 500, 502, 503, 504].includes(response.status);
        if (!transient || attempt === retries) throw lastError;
        if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 60) {
          // Honor the gateway's own retry hint for this attempt.
          await sleep(retryAfter * 1000, signal).catch(() => {});
        }
        continue;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
        if (attempt === retries) throw error;
      }
    }
    throw lastError;
  };
}
export function replyText(reply: ModelReply): string {
  return (reply.output ?? []).filter((item) => item.type === "message").flatMap((item) => (item.content ?? []) as Array<{ type: string; text?: string }>).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n");
}
export function parseModelJson(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}
