import type { NextRequest } from "next/server";

// Same-origin, read-only adapter. The engine remains the source of truth.
export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === "..")) {
    return Response.json({ error: { message: "Invalid resource" } }, { status: 400 });
  }
  const origin = process.env.GEORSI_API_URL ?? "http://127.0.0.1:8792";
  const prefix = path[0] === "healthz" ? "/" : "/api/v1/";
  try {
    const response = await fetch(`${origin}${prefix}${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`, {
      cache: "no-store", signal: AbortSignal.timeout(12000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: { message: "研究服务暂时无法连接，请稍后重试。" } }, { status: 503 });
  }
}
