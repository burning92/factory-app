import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import {
  syncMaterialReceiptLabMovements,
  voidMaterialReceiptLabMovements,
  type ReceiptLineInput,
} from "@/lib/materialStockLab/syncMaterialReceipt";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function authenticateRequest(
  req: Request
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  try {
    getSupabaseAdmin();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "server_config_error" }, { status: 500 }) };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const refreshToken = (req.headers.get("x-refresh-token") ?? "").trim();
  if (!accessToken) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const anon = createClient(url, anonKey);
  const {
    data: { user: userFromAccess },
    error: userErr,
  } = await anon.auth.getUser(accessToken);
  let user = userFromAccess ?? null;
  if (!user && refreshToken) {
    const {
      data: { user: userFromSession },
      error: sessionError,
    } = await anon.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (!sessionError) user = userFromSession ?? null;
  }
  if (userErr || !user) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  return { ok: true, userId: user.id };
}

export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth.ok) return auth.response;

  let body: {
    action?: string;
    inspection_log_id?: string;
    received_at?: string;
    lines?: ReceiptLineInput[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const inspectionLogId = String(body.inspection_log_id ?? "").trim();
  if (!inspectionLogId) {
    return NextResponse.json({ error: "inspection_log_id_required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const action = String(body.action ?? "upsert").trim();

  if (action === "void") {
    const voided = await voidMaterialReceiptLabMovements(
      supabase,
      inspectionLogId,
      auth.userId,
      "입고 검수 삭제·취소"
    );
    return NextResponse.json({ ok: true, voided });
  }

  if (action !== "upsert") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const result = await syncMaterialReceiptLabMovements(supabase, {
    inspectionLogId,
    receivedAt: String(body.received_at ?? ""),
    lines: Array.isArray(body.lines) ? body.lines : [],
    createdBy: auth.userId,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.skipped ?? "sync_failed" }, { status: 500 });
  }

  return NextResponse.json(result);
}
