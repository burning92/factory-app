import type { RawProcessedPlanRow } from "./processedPlanTypes";

export type NormalizedProcessedPlanRow = {
  plan_date: string;
  product_name: string;
  qty: number | null;
  manpower: number | null;
  plan_year: number;
  plan_month: number;
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

function toManpower(v: unknown): number | null {
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

export function normalizeProcessedPlanRows(rawRows: RawProcessedPlanRow[]): {
  rows: NormalizedProcessedPlanRow[];
  filtered: number;
} {
  let filtered = 0;
  const rows: NormalizedProcessedPlanRow[] = [];
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
      manpower: toManpower(raw.manpower),
      plan_year,
      plan_month,
      source_sheet_name:
        raw.source_sheet_name != null && String(raw.source_sheet_name).trim()
          ? String(raw.source_sheet_name).trim()
          : null,
      sort_order: index,
    });
  });
  return { rows, filtered };
}
