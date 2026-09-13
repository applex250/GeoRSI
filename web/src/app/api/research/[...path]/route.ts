import type { NextRequest } from "next/server";

// Stream uploads directly to the engine; never buffer large files in Next.js.
export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route = path.join("/");
  // Structural gate ONLY. The enumerated allowlist that used to live here drifted
  // three times (start, gateways/select, …): every new engine action broke the
  // proxy with "Unsupported action". The ENGINE is the authority on which
  // sub-actions exist (it 404s unknown tails itself) — this gate merely rejects
  // malformed shapes before forwarding.
  const segments = route.split("/");
  const shapeOk = route === "uploads" || route === "research-requests" || route === "gateways/select"
    || route === "research-runs"
    || (route.startsWith("research-runs/") && segments.length === 3 && /^[A-Za-z0-9_-]+$/.test(segments[1] ?? ""));
  if (!shapeOk) return Response.json({ error: { message: "Unsupported action" } }, { status: 404 });
  const origin = process.env.GEORSI_API_URL ?? "http://127.0.0.1:8792";
  try {
    const response = await fetch(`${origin}/api/v1/${route}${request.nextUrl.search}`, {
      method: "POST", headers: { "Content-Type": request.headers.get("content-type") ?? "application/octet-stream" },
      body: request.body, duplex: "half", cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(180000)]),
    } as RequestInit & { duplex: "half" });
    return new Response(response.body, { status: response.status, headers: { "Content-Type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: { message: "请求未能确认完成，请先检查研究记录再重试。" } }, { status: 503 }); }
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const route_ = path.join("/");
  if (path.some((part) => !/^[a-zA-Z0-9_.:-]+$/.test(part) || part === "..")) {
    return Response.json({ error: { message: "Invalid resource" } }, { status: 400 });
  }
  const origin = process.env.GEORSI_API_URL ?? "http://127.0.0.1:8792";
  const prefix = path[0] === "healthz" ? "/" : "/api/v1/";
  // SSE streams (…/events) live for the whole run; a fixed timeout would cut them
  // every few seconds. Everything else stays on a short timeout.
  const isEventStream = route_ === "events" || path[path.length - 1] === "events";
  const signal = isEventStream ? request.signal : AbortSignal.any([request.signal, AbortSignal.timeout(12000)]);
  try {
    const response = await fetch(`${origin}${prefix}${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`, {
      cache: "no-store", signal,
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: { message: "研究服务暂时无法连接，请稍后重试。" } }, { status: 503 });
  }
}
