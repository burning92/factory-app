import type { SupabaseClient } from "@supabase/supabase-js";

/** 기준재고 재설정 시: 활성 movement 전부 void (이력은 유지, 합산만 0부터) */
export async function voidAllActiveLabMovements(
  supabase: SupabaseClient,
  voidedBy: string | null,
  voidReason: string
): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("material_stock_movements")
    .update({
      voided_at: nowIso,
      voided_by: voidedBy,
      void_reason: voidReason.slice(0, 2000),
    })
    .is("voided_at", null)
    .select("id");

  if (error) return 0;
  return data?.length ?? 0;
}
