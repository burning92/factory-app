import type { SupabaseClient } from "@supabase/supabase-js";

const CLOSE_MOVEMENT_TYPES = ["return_unused", "waste"] as const;

/** 생산일 2차 마감 연동 movement (잔량 반납·폐기) 전부 void */
export async function voidProductionDateCloseLabMovements(
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
    .in("movement_type", [...CLOSE_MOVEMENT_TYPES])
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
