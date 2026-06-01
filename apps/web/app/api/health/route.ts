import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const healthUrl = process.env.SERVER_HEALTH_URL ?? "http://127.0.0.1:4000/health";
  try {
    const response = await fetch(healthUrl, { cache: "no-store" });
    const body = await response.json().catch(() => ({ status: response.ok ? "ok" : "error" }));
    return NextResponse.json(body, {
      status: response.status,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "health proxy failed";
    return NextResponse.json({ status: "error", checks: { api: { status: "error", detail: message } } }, { status: 502 });
  }
}
