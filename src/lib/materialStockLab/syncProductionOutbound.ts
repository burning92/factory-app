import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeInventoryItemCode } from "@/lib/inventoryItemCodeNormalize";

export type SyncProductionOutboundResult = {
  ok: boolean;
  skipped?: string;
  movement_id?: string;
  voided?: number;
};

function effectiveAtFromProductionDate(productionDate: string): string {
  const d = String(productionDate ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d}T12:00:00.000Z`;
  return new Date().toISOString();
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

/** Active production_outbound movements for a production_logs row. */
export async function voidProductionOutboundLabMovements(
  supabase: SupabaseClient,
  productionLogId: string,
  voidedBy: string | null,
  voidReason: string
): Promise<number> {
  const { data: rows, error: findErr } = await supabase
    .from("material_stock_movements")
    .select("id")
    .eq("source_table", "production_logs")
    .eq("source_id", productionLogId)
    .eq("movement_type", "production_outbound")
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
 * production_logs 출고량 → Lab movement (음수 qty).
 * 기존 활성 movement가 있으면 수량 변경 시 void 후 재생성.
 */
export async function syncProductionOutboundLabMovement(
  supabase: SupabaseClient,
  params: {
    productionLogId: string;
    productionDate: string;
    materialName: string;
    outboundG: number;
    productName?: string | null;
    createdBy?: string | null;
  }
): Promise<SyncProductionOutboundResult> {
  const logId = String(params.productionLogId ?? "").trim();
  if (!logId) return { ok: false, skipped: "missing_log_id" };

  const outboundG = Number(params.outboundG);
  if (!Number.isFinite(outboundG) || outboundG <= 0) {
    const voided = await voidProductionOutboundLabMovements(
      supabase,
      logId,
      params.createdBy ?? null,
      "production_logs outbound cleared"
    );
    return { ok: true, skipped: "zero_outbound", voided };
  }

  const material = await resolveMaterialByName(supabase, params.materialName);
  if (!material) {
    return { ok: true, skipped: "unmapped_material" };
  }

  const qty_g = -Math.abs(outboundG);
  const source_version = String(outboundG);

  const { data: existing, error: existErr } = await supabase
    .from("material_stock_movements")
    .select("id, qty_g, source_version")
    .eq("source_table", "production_logs")
    .eq("source_id", logId)
    .eq("movement_type", "production_outbound")
    .is("voided_at", null)
    .maybeSingle();

  if (existErr) {
    return { ok: false, skipped: existErr.message };
  }

  if (existing) {
    const ex = existing as { qty_g?: number; source_version?: string | null };
    if (Number(ex.qty_g) === qty_g && String(ex.source_version ?? "") === source_version) {
      return { ok: true, movement_id: String((existing as { id: string }).id), skipped: "unchanged" };
    }
    await voidProductionOutboundLabMovements(
      supabase,
      logId,
      params.createdBy ?? null,
      "production_logs outbound updated"
    );
  }

  const productLabel = String(params.productName ?? "").trim();
  const memo = productLabel
    ? `생산출고 연동 · ${params.materialName} · ${productLabel}`
    : `생산출고 연동 · ${params.materialName}`;

  const { data: inserted, error: insErr } = await supabase
    .from("material_stock_movements")
    .insert({
      inventory_item_code: material.inventory_item_code,
      material_id: material.id,
      movement_type: "production_outbound",
      qty_g,
      effective_at: effectiveAtFromProductionDate(params.productionDate),
      source_table: "production_logs",
      source_id: logId,
      source_version,
      idempotency_key: `production_outbound:${logId}`,
      memo: memo.slice(0, 2000),
      created_by: params.createdBy ?? null,
    })
    .select("id")
    .single();

  if (insErr) {
    if (insErr.code === "23505") {
      return { ok: true, skipped: "idempotency_conflict" };
    }
    return { ok: false, skipped: insErr.message };
  }

  return { ok: true, movement_id: String((inserted as { id?: string })?.id ?? "") };
}
