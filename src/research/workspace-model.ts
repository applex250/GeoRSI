import { fetch, ProxyAgent } from "undici";
import type { ResearchModelConfig } from "../config.js";

export interface ModelReply { output?: Array<Record<string, unknown>>; usage?: { input_tokens?: number; output_tokens?: number }; status?: string; model?: string }
export type ResearchModelCall = (input: unknown[], tools: unknown[], signal?: AbortSignal) => Promise<ModelReply>;
/** Uses the same authoritative gateway policy as the research engine. */
export function workspaceModel(policy: ResearchModelConfig): ResearchModelCall {
  const key = process.env[policy.credential_env];
  if (!key) throw new Error("Research API credential is not configured");
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  return async (input, tools, signal) => {
    const response = await fetch(policy.base_url.replace(/\/$/, "") + "/responses", {
      method: "POST", dispatcher,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: policy.model, reasoning: { effort: policy.thinking_level }, input, tools, max_output_tokens: Math.min(policy.max_output, 10000), store: false }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Research gateway HTTP ${response.status}`); }
    const reply = await response.json() as ModelReply;
    if (reply.model && reply.model !== policy.model) throw new Error("Gateway returned an unexpected model");
    return reply;
  };
}
export function replyText(reply: ModelReply): string {
  return (reply.output ?? []).filter((item) => item.type === "message").flatMap((item) => (item.content ?? []) as Array<{ type: string; text?: string }>).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("\n");
}
export function parseModelJson(text: string): unknown {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}
