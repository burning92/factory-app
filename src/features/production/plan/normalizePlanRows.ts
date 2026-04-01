import type { RawProductionPlanRow } from "./types";

export type NormalizedPlanRow = {
  plan_date: string;
  product_name: string;
  qty: number | null;
  category: string | null;
  note: string | null;
  plan_year: number;
  plan_month: number;
  plan_version: "master" | "draft" | "end";
  source_sheet_name: string | null;
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

function toInt(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toVersion(v: unknown): "master" | "draft" | "end" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "draft") return "draft";
  if (s === "end") return "end";
  return "master";
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
    const ymd = plan_date.split("-");
    const dateYear = Number(ymd[0]);
    const dateMonth = Number(ymd[1]);
    const plan_year = toInt(raw.plan_year) ?? dateYear;
    const plan_month = toInt(raw.plan_month) ?? dateMonth;
    if (plan_year < 2000 || plan_year > 2100 || plan_month < 1 || plan_month > 12) {
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
      plan_year,
      plan_month,
      plan_version: toVersion(raw.plan_version),
      source_sheet_name:
        raw.source_sheet_name != null && String(raw.source_sheet_name).trim()
          ? String(raw.source_sheet_name).trim()
          : null,
      sort_order: index,
    });
  });
  return { rows, filtered };
}
