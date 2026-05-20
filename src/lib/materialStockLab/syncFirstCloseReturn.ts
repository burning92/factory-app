import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeInventoryItemCode } from "@/lib/inventoryItemCodeNormalize";
import {
  computeFirstCloseReturnGByMaterialFromSnapshot,
  type MaterialWeightMeta,
} from "@/lib/materialStockLab/computeFirstCloseReturns";

export type SyncFirstCloseReturnResult = {
  ok: boolean;
  skipped?: string;
  synced?: number;
  voided?: number;
};

function effectiveAtFromProductionDate(productionDate: string): string {
  const d = String(productionDate ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d}T12:00:00.000Z`;
  return new Date().toISOString();
}

function idempotencyKey(dateKey: string, inventoryItemCode: string): string {
  return `return_unused:first_close:${dateKey}:${inventoryItemCode}`;
}

async function loadMaterialsMeta(supabase: SupabaseClient): Promise<MaterialWeightMeta[]> {
  const { data, error } = await supabase
    .from("materials")
    .select("material_name, unit_weight_g, box_weight_g");
  if (error || !data) return [];
  return data.map((row) => ({
    materialName: String((row as { material_name?: string }).material_name ?? ""),
    unitWeightG: Number((row as { unit_weight_g?: number }).unit_weight_g) || 0,
    boxWeightG: Number((row as { box_weight_g?: number }).box_weight_g) || 0,
  }));
}

async function resolveMaterialByName(
  supabase: SupabaseClient,
  materialName: string
): Promise<{ id: string; inventory_item_code: string } | null> {
  const name = String(materialName ?? "").trim();
  if (!name) return null;
  const { data, error } = await supabase
    .from("materials")
    .select("id, inventory_item_code")
    .eq("material_name", name)
    .maybeSingle();
  if (error || !data) return null;
  const code = normalizeInventoryItemCode((data as { inventory_item_code?: string }).inventory_item_code);
  if (!code) return null;
  return { id: String((data as { id: string }).id), inventory_item_code: code };
}

/** 해당 생산일 1차 마감 return_unused movement 전부 void */
export async function voidFirstCloseReturnLabMovements(
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
    .eq("movement_type", "return_unused")
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

/**
 * 마감 스냅샷(1차 재고 입력) → return_unused(+) movement.
 * UI는 2차 마감 저장 시에만 호출(1차만 저장 시 Lab 노이즈 방지).
 */
export async function syncFirstCloseReturnLabMovements(
  supabase: SupabaseClient,
  params: {
    productionDate: string;
    stateSnapshot: unknown;
    createdBy?: string | null;
  }
): Promise<SyncFirstCloseReturnResult> {
  const dateKey = String(params.productionDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return { ok: false, skipped: "invalid_production_date" };
  }

  const materialsMeta = await loadMaterialsMeta(supabase);
  const returnByMaterial = computeFirstCloseReturnGByMaterialFromSnapshot(
    params.stateSnapshot,
    materialsMeta
  );

  const desired = new Map<
    string,
    { inventoryItemCode: string; materialId: string; returnG: number; materialName: string }
  >();

  for (const [materialName, returnG] of Array.from(returnByMaterial.entries())) {
    const material = await resolveMaterialByName(supabase, materialName);
    if (!material) continue;
    desired.set(material.inventory_item_code, {
      inventoryItemCode: material.inventory_item_code,
      materialId: material.id,
      returnG,
      materialName,
    });
  }

  const { data: existingRows, error: existErr } = await supabase
    .from("material_stock_movements")
    .select("id, inventory_item_code, qty_g, source_version")
    .eq("source_table", "production_history_date_state")
    .eq("source_id", dateKey)
    .eq("movement_type", "return_unused")
    .is("voided_at", null);

  if (existErr) {
    return { ok: false, skipped: existErr.message };
  }

  let voided = 0;
  let synced = 0;
  const nowReasonUpdate = "마감 잔량 반영(수정)";
  const effectiveAt = effectiveAtFromProductionDate(dateKey);

  for (const row of existingRows ?? []) {
    const code = normalizeInventoryItemCode((row as { inventory_item_code?: string }).inventory_item_code);
    const want = code ? desired.get(code) : undefined;
    const qty_g = want ? Math.abs(want.returnG) : 0;
    const source_version = want ? String(want.returnG) : "";
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
        void_reason: nowReasonUpdate,
      })
      .eq("id", id)
      .is("voided_at", null);
    if (!voidErr) voided += 1;
  }

  for (const entry of Array.from(desired.values())) {
    const qty_g = Math.abs(entry.returnG);
    const source_version = String(entry.returnG);
    const memo = `마감 잔량 반납(2차 완료) · ${entry.materialName}`;

    const { error: insErr } = await supabase.from("material_stock_movements").insert({
      inventory_item_code: entry.inventoryItemCode,
      material_id: entry.materialId,
      movement_type: "return_unused",
      qty_g,
      effective_at: effectiveAt,
      source_table: "production_history_date_state",
      source_id: dateKey,
      source_version,
      idempotency_key: idempotencyKey(dateKey, entry.inventoryItemCode),
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
