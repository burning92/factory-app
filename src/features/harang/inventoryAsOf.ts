import { supabase } from "@/lib/supabase";

/** 오늘 날짜 YYYY-MM-DD (로컬) */
export function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 기준일 포함 당시 LOT별 재고 (원장 역산). 빈 문자열이면 null 반환 → 현재고 사용 */
export async function fetchLotStockAsOfMap(asOfDate: string): Promise<Map<string, number> | null> {
  const cut = asOfDate.slice(0, 10);
  if (!cut) return null;

  const { data, error } = await supabase.rpc("harang_inventory_stock_as_of_lot", {
    p_as_of_date: cut,
  });
  if (error) throw error;

  const out = new Map<string, number>();
  for (const row of data ?? []) {
    out.set(String(row.lot_id), Number(row.stock_qty ?? 0));
  }
  return out;
}

export function isOnOrBeforeAsOf(asOfDate: string, txDate: string): boolean {
  const cut = asOfDate.slice(0, 10);
  if (!cut) return true;
  return txDate.slice(0, 10) <= cut;
}
