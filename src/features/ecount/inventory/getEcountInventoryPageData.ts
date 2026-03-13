import { getSupabaseAdmin } from "@/lib/supabaseServer";
import type { EcountInventoryPageData, InventoryTab } from "./types";

const SYNC_NAME = "ecount_inventory";

export async function getEcountInventoryPageData(
  tab: InventoryTab,
  searchQ?: string
): Promise<EcountInventoryPageData> {
  const supabase = getSupabaseAdmin();

  const [syncRes, invRes] = await Promise.all([
    supabase
      .from("ecount_sync_status")
      .select("last_synced_at")
      .eq("sync_name", SYNC_NAME)
      .maybeSingle(),
    supabase
      .from("ecount_inventory_current")
      .select("item_code, display_item_name, lot_no, qty, category, box_weight_g, unit_weight_g")
      .eq("inventory_type", tab)
      .order("display_item_name", { ascending: true })
      .order("lot_no", { ascending: true }),
  ]);

  const lastSyncedAt =
    syncRes.data?.last_synced_at ?? null;
  let rows = (invRes.data ?? []) as {
    item_code: string;
    display_item_name: string | null;
    lot_no: string;
    qty: number;
    category: string | null;
    box_weight_g: number;
    unit_weight_g: number;
  }[];

  const q = (searchQ ?? "").trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (r) =>
        (r.item_code ?? "").toLowerCase().includes(q) ||
        (r.display_item_name ?? "").toLowerCase().includes(q) ||
        (r.lot_no ?? "").toLowerCase().includes(q)
    );
  }

  const viewRows = rows.map((r) => ({
    item_code: r.item_code ?? "",
    display_item_name: r.display_item_name ?? "",
    lot_no: r.lot_no ?? "",
    qty: Number(r.qty) || 0,
    category: r.category ?? null,
    box_weight_g: Number(r.box_weight_g) || 0,
    unit_weight_g: Number(r.unit_weight_g) || 0,
  }));

  return {
    lastSyncedAt,
    totalCount: viewRows.length,
    tab,
    rows: viewRows,
  };
}
