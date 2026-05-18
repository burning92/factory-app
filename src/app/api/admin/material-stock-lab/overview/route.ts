import { NextRequest, NextResponse } from "next/server";
import { normalizeInventoryItemCode } from "@/lib/inventoryItemCodeNormalize";
import { requireAdminMaterialStockLab } from "../_requireAdmin";

export type MaterialStockLabOverviewRow = {
  inventory_item_code: string;
  material_names: string[];
  material_candidates: { id: string; material_name: string }[];
  mapping_count: number;
  ecount_stock_g: number;
  ecount_last_synced_at: string | null;
  lab_baseline_qty_g: number;
  lab_baseline_at: string | null;
  lab_movement_sum_g: number;
  lab_reserved_stock_g: number;
  lab_current_stock_g: number;
  lab_available_stock_g: number;
  diff_g: number;
};

export async function GET(req: NextRequest) {
  const auth = await requireAdminMaterialStockLab(req);
  if (!auth.ok) return auth.response;

  const { supabase } = auth;
  const onlyDiff = req.nextUrl.searchParams.get("onlyDiff") === "1";
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();

  const [invRes, matsRes, viewRes, syncRes] = await Promise.all([
    supabase.from("ecount_inventory_current").select("item_code, qty, synced_at"),
    supabase.from("materials").select("id, material_name, inventory_item_code").not("inventory_item_code", "is", null),
    supabase.from("material_stock_current_v").select("*"),
    supabase.from("ecount_sync_status").select("last_synced_at, source_refreshed_at").eq("sync_name", "ecount_inventory").maybeSingle(),
  ]);

  if (invRes.error) {
    return NextResponse.json({ error: "ecount_load_failed", message: invRes.error.message }, { status: 500 });
  }
  if (matsRes.error) {
    return NextResponse.json({ error: "materials_load_failed", message: matsRes.error.message }, { status: 500 });
  }
  if (viewRes.error) {
    return NextResponse.json({ error: "lab_view_failed", message: viewRes.error.message }, { status: 500 });
  }

  const ecountByCode = new Map<string, { qty: number; lastSynced: string | null }>();
  for (const row of invRes.data ?? []) {
    const code = normalizeInventoryItemCode((row as { item_code?: string }).item_code);
    if (!code) continue;
    const qty = Number((row as { qty?: unknown }).qty) || 0;
    const syncedAt = (row as { synced_at?: string | null }).synced_at ?? null;
    const cur = ecountByCode.get(code);
    if (!cur) {
      ecountByCode.set(code, { qty, lastSynced: syncedAt });
    } else {
      cur.qty += qty;
      if (syncedAt && (!cur.lastSynced || syncedAt > cur.lastSynced)) cur.lastSynced = syncedAt;
    }
  }

  const namesByCode = new Map<string, string[]>();
  const candidatesByCode = new Map<string, { id: string; material_name: string }[]>();
  for (const row of matsRes.data ?? []) {
    const r = row as { id?: string; material_name?: string; inventory_item_code?: string };
    const code = normalizeInventoryItemCode(r.inventory_item_code);
    if (!code) continue;
    const name = String(r.material_name ?? "").trim();
    const id = String(r.id ?? "");
    const list = namesByCode.get(code) ?? [];
    if (name && !list.includes(name)) list.push(name);
    namesByCode.set(code, list);

    const cList = candidatesByCode.get(code) ?? [];
    if (id && name) cList.push({ id, material_name: name });
    candidatesByCode.set(code, cList);
  }

  const viewByCode = new Map<string, Record<string, unknown>>();
  for (const row of viewRes.data ?? []) {
    const r = row as Record<string, unknown>;
    const code = String(r.inventory_item_code ?? "");
    if (code) viewByCode.set(code, r);
  }

  const globalEcountSyncAt =
    syncRes.error || !syncRes.data
      ? null
      : (syncRes.data as { last_synced_at?: string | null; source_refreshed_at?: string | null }).last_synced_at ??
        (syncRes.data as { last_synced_at?: string | null; source_refreshed_at?: string | null }).source_refreshed_at ??
        null;

  const allCodes = new Set<string>();
  for (const k of Array.from(ecountByCode.keys())) allCodes.add(k);
  for (const k of Array.from(viewByCode.keys())) allCodes.add(k);
  for (const k of Array.from(namesByCode.keys())) allCodes.add(k);

  const rows: MaterialStockLabOverviewRow[] = [];
  for (const code of Array.from(allCodes).sort((a, b) => a.localeCompare(b))) {
    const e = ecountByCode.get(code);
    const ecount_stock_g = e?.qty ?? 0;
    const ecount_last_synced_at = e?.lastSynced ?? globalEcountSyncAt;

    const v = viewByCode.get(code);
    const lab_baseline_qty_g = v != null ? Number(v.baseline_qty_g) || 0 : 0;
    const lab_baseline_at = v != null && v.baseline_at != null ? String(v.baseline_at) : null;
    const lab_movement_sum_g = v != null ? Number(v.movement_sum_g) || 0 : 0;
    const lab_reserved_stock_g = v != null ? Number(v.reserved_stock_g) || 0 : 0;
    const lab_current_stock_g = v != null ? Number(v.current_stock_g) || 0 : lab_baseline_qty_g + lab_movement_sum_g;
    const lab_available_stock_g = v != null ? Number(v.available_stock_g) || 0 : lab_current_stock_g - lab_reserved_stock_g;

    const material_names = namesByCode.get(code) ?? [];
    const material_candidates = candidatesByCode.get(code) ?? [];
    const mapping_count = material_candidates.length;

    const diff_g = Number((ecount_stock_g - lab_current_stock_g).toFixed(4));

    if (onlyDiff && Math.abs(diff_g) < 1e-6) continue;

    if (q) {
      const hay = `${code} ${material_names.join(" ")}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    rows.push({
      inventory_item_code: code,
      material_names,
      material_candidates,
      mapping_count,
      ecount_stock_g,
      ecount_last_synced_at: ecount_last_synced_at ?? globalEcountSyncAt,
      lab_baseline_qty_g,
      lab_baseline_at,
      lab_movement_sum_g,
      lab_reserved_stock_g,
      lab_current_stock_g,
      lab_available_stock_g,
      diff_g,
    });
  }

  return NextResponse.json({
    ok: true,
    global_ecount_last_synced_at: globalEcountSyncAt,
    rows,
  });
}
