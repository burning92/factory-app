import type { RawProductionPlanRow } from "./types";

export type NormalizedPlanRow = {
  plan_date: string;
  product_name: string;
  qty: number | null;
  category: string | null;
  note: string | null;
  sort_order: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDateStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, 10);
  if (!DATE_RE.test(s)) return null;
  return s;
}

function toQty(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * 시트/API에서 넘어온 행을 DB 저장용으로 정규화. 잘못된 행은 제외하고 filtered 카운트.
 */
export function normalizePlanRows(rawRows: RawProductionPlanRow[]): {
  rows: NormalizedPlanRow[];
  filtered: number;
} {
  let filtered = 0;
  const rows: NormalizedPlanRow[] = [];
  rawRows.forEach((raw, index) => {
    const plan_date = toDateStr(raw.plan_date);
    const product_name = (raw.product_name != null ? String(raw.product_name) : "").trim();
    if (!plan_date || !product_name) {
      filtered += 1;
      return;
    }
    rows.push({
      plan_date,
      product_name,
      qty: toQty(raw.qty),
      category:
        raw.category != null && String(raw.category).trim()
          ? String(raw.category).trim()
          : null,
      note: raw.note != null && String(raw.note).trim() ? String(raw.note).trim() : null,
      sort_order: index,
    });
  });
  return { rows, filtered };
}
