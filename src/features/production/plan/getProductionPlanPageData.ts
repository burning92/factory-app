import { getSupabaseAdmin } from "@/lib/supabaseServer";
import type { ProductionPlanPageData, ProductionPlanRow } from "./types";

const SYNC_NAME = "production_plan";

export async function getProductionPlanPageData(): Promise<ProductionPlanPageData> {
  const supabase = getSupabaseAdmin();

  const [rowsRes, syncRes] = await Promise.all([
    supabase
      .from("production_plan_rows")
      .select("id, plan_date, product_name, qty, category, note, plan_year, plan_month, plan_version, source_sheet_name, sort_order, updated_at")
      .order("plan_year", { ascending: false })
      .order("plan_month", { ascending: false })
      .order("plan_version", { ascending: false })
      .order("plan_date", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("production_plan_sync_status")
      .select("last_synced_at, last_status, source_refreshed_at, row_count")
      .eq("sync_name", SYNC_NAME)
      .maybeSingle(),
  ]);

  if (rowsRes.error) throw rowsRes.error;

  const rowsRaw: ProductionPlanRow[] = (rowsRes.data ?? []).map((r) => ({
    id: Number(r.id),
    plan_date: String(r.plan_date).slice(0, 10),
    product_name: String(r.product_name ?? ""),
    qty: r.qty != null && Number.isFinite(Number(r.qty)) ? Number(r.qty) : null,
    category: r.category != null ? String(r.category) : null,
    note: r.note != null ? String(r.note) : null,
    plan_year: Number.isFinite(Number(r.plan_year)) ? Number(r.plan_year) : Number(String(r.plan_date).slice(0, 4)),
    plan_month:
      Number.isFinite(Number(r.plan_month)) ? Number(r.plan_month) : Number(String(r.plan_date).slice(5, 7)),
    plan_version:
      String(r.plan_version ?? "master").toLowerCase() === "draft"
        ? "draft"
        : String(r.plan_version ?? "master").toLowerCase() === "end"
          ? "end"
          : "master",
    source_sheet_name: r.source_sheet_name != null ? String(r.source_sheet_name) : null,
    sort_order: Number(r.sort_order) || 0,
    updated_at: r.updated_at ? String(r.updated_at) : "",
  }));
  // 날짜별 우선순위:
  // - planning_board 행이 1건이라도 있으면 그 날짜는 planning_board만 표시
  // - 없으면 기존 sync 행을 그대로 표시
  const planningDates = new Set(
    rowsRaw.filter((r) => (r.source_sheet_name ?? "") === "planning_board").map((r) => r.plan_date)
  );
  const rows = rowsRaw.filter((r) => {
    if (!planningDates.has(r.plan_date)) return true;
    return (r.source_sheet_name ?? "") === "planning_board";
  });

  const s = syncRes.data;
  const sync =
    s && !syncRes.error
      ? {
          last_synced_at: s.last_synced_at ? String(s.last_synced_at) : null,
          last_status: s.last_status != null ? String(s.last_status) : null,
          source_refreshed_at: s.source_refreshed_at ? String(s.source_refreshed_at) : null,
          row_count: typeof s.row_count === "number" ? s.row_count : 0,
        }
      : null;

  return { rows, sync };
}
