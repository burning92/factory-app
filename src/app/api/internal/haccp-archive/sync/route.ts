import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createArchiveRunnerFromEnv } from "@/features/haccpArchive/env";
import { withFileLock } from "@/features/haccpArchive/runner";
import { getErrorMessage } from "@/lib/getErrorMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.HACCP_ARCHIVE_SYNC_SECRET ?? "";
  if (secret.length < 32) return false;
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** EC2 cron 이 127.0.0.1 로 호출한다. Supabase 는 읽기만 하고, 쓰기는 Google Drive·Sheets 에만 한다. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.HACCP_ARCHIVE_ENABLED !== "1") {
    return NextResponse.json({ ok: false, error: "HACCP_ARCHIVE_ENABLED=1 이 아니어서 실행하지 않았습니다" }, { status: 409 });
  }
  try {
    const runner = await createArchiveRunnerFromEnv();
    const result = await withFileLock("haccp-archive-sync.lock", () => runner.run());
    if (result === "locked") return NextResponse.json({ ok: false, error: "이미 동기화가 실행 중입니다" }, { status: 409 });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, route: "haccp-archive-sync", enabled: process.env.HACCP_ARCHIVE_ENABLED === "1" });
}
