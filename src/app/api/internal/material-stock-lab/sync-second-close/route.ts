import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { syncFirstCloseReturnLabMovements } from "@/lib/materialStockLab/syncFirstCloseReturn";
import { syncSecondCloseWasteLabMovements } from "@/lib/materialStockLab/syncSecondCloseWaste";
import { voidProductionDateCloseLabMovements } from "@/lib/materialStockLab/voidProductionDateCloseLab";

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
    production_date?: string;
    state_snapshot?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const productionDate = String(body.production_date ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(productionDate)) {
    return NextResponse.json({ error: "production_date_required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const action = String(body.action ?? "upsert").trim();

  if (action === "void") {
    const voided = await voidProductionDateCloseLabMovements(
      supabase,
      productionDate,
      auth.userId,
      "마감 초기화"
    );
    return NextResponse.json({ ok: true, voided });
  }

  if (action !== "upsert") {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const returnResult = await syncFirstCloseReturnLabMovements(supabase, {
    productionDate,
    stateSnapshot: body.state_snapshot ?? {},
    createdBy: auth.userId,
  });

  const wasteResult = await syncSecondCloseWasteLabMovements(supabase, {
    productionDate,
    stateSnapshot: body.state_snapshot ?? {},
    createdBy: auth.userId,
  });

  if (!returnResult.ok || !wasteResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: returnResult.skipped ?? wasteResult.skipped ?? "sync_failed",
        return: returnResult,
        waste: wasteResult,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    return: returnResult,
    waste: wasteResult,
  });
}
