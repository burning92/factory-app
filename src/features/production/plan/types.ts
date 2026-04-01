/** Apps Script → POST /api/internal/production-plan/sync 본문 행 (원시) */

export type RawProductionPlanRow = {
  plan_date?: string | null;
  product_name?: string | null;
  qty?: string | number | null;
  category?: string | null;
  note?: string | null;
  plan_year?: string | number | null;
  plan_month?: string | number | null;
  /** master | draft | end */
  plan_version?: string | null;
  source_sheet_name?: string | null;
  [key: string]: unknown;
};

export type ProductionPlanSyncPayload = {
  rows: RawProductionPlanRow[];
  /** RAW 시트 마지막 갱신 시각 (ISO). 선택. */
  sourceRefreshedAt?: string | null;
};

/** DB production_plan_rows / UI 공통 (정규화 후) */
export type ProductionPlanRow = {
  id: number;
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
  updated_at: string;
};

export type ProductionPlanSyncStatusInfo = {
  last_synced_at: string | null;
  last_status: string | null;
  source_refreshed_at: string | null;
  row_count: number;
};

export type ProductionPlanPageData = {
  rows: ProductionPlanRow[];
  sync: ProductionPlanSyncStatusInfo | null;
};
