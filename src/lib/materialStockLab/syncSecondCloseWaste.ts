import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeInventoryItemCode } from "@/lib/inventoryItemCodeNormalize";
import { computeSecondCloseWasteGByMaterial } from "@/lib/materialStockLab/computeSecondCloseWaste";
import {
  effectiveAtFromDateKey,
  loadBomRefs,
  loadMaterialsMeta,
  resolveMaterialByName,
} from "@/lib/materialStockLab/labMaterialResolve";

export type SyncSecondCloseWasteResult = {
  ok: boolean;
  skipped?: string;
  synced?: number;
  voided?: number;
};

function wasteIdempotencyKey(dateKey: string, inventoryItemCode: string): string {
  return `waste:second_close:${dateKey}:${inventoryItemCode}`;
}

export async function voidSecondCloseWasteLabMovements(
  supabase: SupabaseClient,
  productionDate: string,
  voidedBy: string | null,
  voidReason: string
): Promise<number> {
  const dateKey = String(productionDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return 0;

  const { data: rows, error: findErr } = await supabase
    .from("material_stock_movements")
    .select("id")
    .eq("source_table", "production_history_date_state")
    .eq("source_id", dateKey)
    .eq("movement_type", "waste")
    .is("voided_at", null);
  if (findErr || !rows?.length) return 0;

  const nowIso = new Date().toISOString();
  let voided = 0;
  for (const row of rows) {
    const id = String((row as { id?: string }).id ?? "");
    if (!id) continue;
    const { error: updErr } = await supabase
      .from("material_stock_movements")
      .update({
        voided_at: nowIso,
        voided_by: voidedBy,
        void_reason: voidReason.slice(0, 2000),
      })
      .eq("id", id)
      .is("voided_at", null);
    if (!updErr) voided += 1;
  }
  return voided;
}

export async function syncSecondCloseWasteLabMovements(
  supabase: SupabaseClient,
  params: {
    productionDate: string;
    stateSnapshot: unknown;
    createdBy?: string | null;
  }
): Promise<SyncSecondCloseWasteResult> {
  const dateKey = String(params.productionDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return { ok: false, skipped: "invalid_production_date" };
  }

  const [materialsMeta, bomList] = await Promise.all([
    loadMaterialsMeta(supabase),
    loadBomRefs(supabase),
  ]);
  const wasteByMaterial = computeSecondCloseWasteGByMaterial(
    params.stateSnapshot,
    bomList,
    materialsMeta
  );

  const desired = new Map<
    string,
    { inventoryItemCode: string; materialId: string; wasteG: number; materialName: string }
  >();

  for (const [materialName, wasteG] of Array.from(wasteByMaterial.entries())) {
    const material = await resolveMaterialByName(supabase, materialName);
    if (!material) continue;
    desired.set(material.inventory_item_code, {
      inventoryItemCode: material.inventory_item_code,
      materialId: material.id,
      wasteG,
      materialName,
    });
  }

  const { data: existingRows, error: existErr } = await supabase
    .from("material_stock_movements")
    .select("id, inventory_item_code, qty_g, source_version")
    .eq("source_table", "production_history_date_state")
    .eq("source_id", dateKey)
    .eq("movement_type", "waste")
    .is("voided_at", null);

  if (existErr) {
    return { ok: false, skipped: existErr.message };
  }

  let voided = 0;
  let synced = 0;
  const voidReasonUpdate = "2차 마감 폐기 반영(수정)";
  const effectiveAt = effectiveAtFromDateKey(dateKey);

  for (const row of existingRows ?? []) {
    const code = normalizeInventoryItemCode((row as { inventory_item_code?: string }).inventory_item_code);
    const want = code ? desired.get(code) : undefined;
    const qty_g = want ? -Math.abs(want.wasteG) : 0;
    const source_version = want ? String(want.wasteG) : "";
    const ex = row as { qty_g?: number; source_version?: string | null; id?: string };

    if (want && Number(ex.qty_g) === qty_g && String(ex.source_version ?? "") === source_version) {
      desired.delete(code);
      continue;
    }

    const id = String(ex.id ?? "");
    if (!id) continue;
    const { error: voidErr } = await supabase
      .from("material_stock_movements")
      .update({
        voided_at: new Date().toISOString(),
        voided_by: params.createdBy ?? null,
        void_reason: voidReasonUpdate,
      })
      .eq("id", id)
      .is("voided_at", null);
    if (!voidErr) voided += 1;
  }

  for (const entry of Array.from(desired.values())) {
    const qty_g = -Math.abs(entry.wasteG);
    const source_version = String(entry.wasteG);
    const memo = `2차 마감 폐기 · ${entry.materialName}`;

    const { error: insErr } = await supabase.from("material_stock_movements").insert({
      inventory_item_code: entry.inventoryItemCode,
      material_id: entry.materialId,
      movement_type: "waste",
      qty_g,
      effective_at: effectiveAt,
      source_table: "production_history_date_state",
      source_id: dateKey,
      source_version,
      idempotency_key: wasteIdempotencyKey(dateKey, entry.inventoryItemCode),
      memo: memo.slice(0, 2000),
      created_by: params.createdBy ?? null,
    });

    if (insErr) {
      if (insErr.code === "23505") continue;
      return { ok: false, skipped: insErr.message, voided, synced };
    }
    synced += 1;
  }

  return { ok: true, voided, synced };
}
