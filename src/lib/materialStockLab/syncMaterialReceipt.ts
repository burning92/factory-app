import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeInventoryItemCode } from "@/lib/inventoryItemCodeNormalize";
import { resolveMaterialByName } from "@/lib/materialStockLab/labMaterialResolve";

export type ReceiptLineInput = {
  line_index: number;
  item_name: string;
  total_weight_g: number;
  conformity: "O" | "X" | string;
};

export type SyncMaterialReceiptResult = {
  ok: boolean;
  skipped?: string;
  synced?: number;
  voided?: number;
};

function receiptIdempotencyKey(logId: string, lineIndex: number): string {
  return `receipt:inspection:${logId}:${lineIndex}`;
}

export async function voidMaterialReceiptLabMovements(
  supabase: SupabaseClient,
  inspectionLogId: string,
  voidedBy: string | null,
  voidReason: string
): Promise<number> {
  const logId = String(inspectionLogId ?? "").trim();
  if (!logId) return 0;

  const { data: rows, error: findErr } = await supabase
    .from("material_stock_movements")
    .select("id")
    .eq("source_table", "daily_material_receiving_inspection_logs")
    .eq("source_id", logId)
    .eq("movement_type", "receipt")
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

export async function syncMaterialReceiptLabMovements(
  supabase: SupabaseClient,
  params: {
    inspectionLogId: string;
    receivedAt: string;
    lines: ReceiptLineInput[];
    createdBy?: string | null;
  }
): Promise<SyncMaterialReceiptResult> {
  const logId = String(params.inspectionLogId ?? "").trim();
  if (!logId) return { ok: false, skipped: "missing_inspection_log_id" };

  const receivedAt = String(params.receivedAt ?? "").trim();
  const effectiveAt = /^\d{4}-\d{2}-\d{2}/.test(receivedAt)
    ? `${receivedAt.slice(0, 10)}T12:00:00.000Z`
    : new Date().toISOString();

  const desired = new Map<
    number,
    { inventoryItemCode: string; materialId: string; qtyG: number; materialName: string }
  >();

  for (const line of params.lines) {
    if (line.conformity !== "O") continue;
    const qtyG = Math.round(Number(line.total_weight_g) || 0);
    if (qtyG <= 0) continue;
    const materialName = String(line.item_name ?? "").trim();
    if (!materialName) continue;
    const material = await resolveMaterialByName(supabase, materialName);
    if (!material) continue;
    desired.set(line.line_index, {
      inventoryItemCode: material.inventory_item_code,
      materialId: material.id,
      qtyG,
      materialName,
    });
  }

  const voided = await voidMaterialReceiptLabMovements(
    supabase,
    logId,
    params.createdBy ?? null,
    "입고 검수 저장(수정)"
  );

  let synced = 0;
  for (const [lineIndex, entry] of Array.from(desired.entries())) {
    const memo = `입고 검수 · ${entry.materialName}`;
    const { error: insErr } = await supabase.from("material_stock_movements").insert({
      inventory_item_code: entry.inventoryItemCode,
      material_id: entry.materialId,
      movement_type: "receipt",
      qty_g: entry.qtyG,
      effective_at: effectiveAt,
      source_table: "daily_material_receiving_inspection_logs",
      source_id: logId,
      source_version: String(entry.qtyG),
      idempotency_key: receiptIdempotencyKey(logId, lineIndex),
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
