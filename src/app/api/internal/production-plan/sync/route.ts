import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import type { ProductionPlanSyncPayload } from "@/features/production/plan/types";
import { normalizePlanRows } from "@/features/production/plan/normalizePlanRows";

const SYNC_NAME = "production_plan";

function getSyncToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return req.headers.get("x-sync-token");
}

function isAuthorized(req: NextRequest): boolean {
  const token = getSyncToken(req);
  const secret = process.env.ECCOUNT_SYNC_SECRET;
  return !!token && !!secret && token === secret;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ProductionPlanSyncPayload;
  try {
    body = (await req.json()) as ProductionPlanSyncPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  const sourceRefreshedAt =
    typeof body.sourceRefreshedAt === "string" && body.sourceRefreshedAt.trim()
      ? body.sourceRefreshedAt.trim()
      : null;

  const { rows: normalized, filtered } = normalizePlanRows(rawRows);

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  try {
    const { error: deleteErr } = await supabase
      .from("production_plan_rows")
      .delete()
      .neq("id", 0);
    if (deleteErr) throw deleteErr;

    let inserted = 0;
    if (normalized.length > 0) {
      const payload = normalized.map((r) => ({
        plan_date: r.plan_date,
        product_name: r.product_name,
        qty: r.qty,
        category: r.category,
        note: r.note,
        plan_year: r.plan_year,
        plan_month: r.plan_month,
        plan_version: r.plan_version,
        source_sheet_name: r.source_sheet_name,
        sort_order: r.sort_order,
        updated_at: now,
      }));
      const { data: ins, error: insertErr } = await supabase
        .from("production_plan_rows")
        .insert(payload)
        .select("id");
      if (insertErr) throw insertErr;
      inserted = ins?.length ?? 0;
    }

    await supabase.from("production_plan_sync_status").upsert(
      {
        sync_name: SYNC_NAME,
        last_synced_at: now,
        last_status: "success",
        row_count: inserted,
        message: null,
        source_refreshed_at: sourceRefreshedAt,
        updated_at: now,
      },
      { onConflict: "sync_name" }
    );

    return NextResponse.json({
      ok: true,
      inserted,
      filtered,
      replaced: normalized.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("production_plan_sync_status")
      .upsert(
        {
          sync_name: SYNC_NAME,
          last_synced_at: now,
          last_status: "failure",
          row_count: 0,
          message,
          source_refreshed_at: sourceRefreshedAt,
          updated_at: now,
        },
        { onConflict: "sync_name" }
      )
      .then(() => {});

    return NextResponse.json(
      { error: "Sync failed", message },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "production-plan-sync" });
}
