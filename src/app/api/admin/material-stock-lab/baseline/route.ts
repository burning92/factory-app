import { NextRequest, NextResponse } from "next/server";
import { normalizeInventoryItemCode } from "@/lib/inventoryItemCodeNormalize";
import { requireAdminMaterialStockLab } from "../_requireAdmin";

export async function POST(req: NextRequest) {
  const auth = await requireAdminMaterialStockLab(req);
  if (!auth.ok) return auth.response;

  const { supabase, userId } = auth;

  const { data: invRows, error: invErr } = await supabase.from("ecount_inventory_current").select("item_code, qty");
  if (invErr) {
    return NextResponse.json({ error: "ecount_load_failed", message: invErr.message }, { status: 500 });
  }

  const byCode = new Map<string, number>();
  for (const row of invRows ?? []) {
    const r = row as { item_code?: string; qty?: unknown };
    const code = normalizeInventoryItemCode(r.item_code);
    if (!code) continue;
    byCode.set(code, (byCode.get(code) ?? 0) + (Number(r.qty) || 0));
  }

  const { data: syncRow } = await supabase
    .from("ecount_sync_status")
    .select("last_synced_at, source_refreshed_at")
    .eq("sync_name", "ecount_inventory")
    .maybeSingle();

  const source_synced_at =
    (syncRow as { last_synced_at?: string | null } | null)?.last_synced_at ??
    (syncRow as { source_refreshed_at?: string | null } | null)?.source_refreshed_at ??
    null;

  const nowIso = new Date().toISOString();
  const inserts = Array.from(byCode.entries()).map(([inventory_item_code, baseline_qty_g]) => ({
    inventory_item_code,
    baseline_qty_g,
    baseline_at: nowIso,
    source_type: "ecount",
    source_sync_name: "ecount_inventory",
    source_synced_at,
    memo: null,
    material_id: null,
    captured_by: userId,
    created_by: userId,
  }));

  if (inserts.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, message: "no ecount rows to snapshot" });
  }

  const { error: insErr } = await supabase.from("material_stock_baselines").insert(inserts);
  if (insErr) {
    return NextResponse.json({ error: "baseline_insert_failed", message: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: inserts.length, baseline_at: nowIso, source_synced_at });
}
