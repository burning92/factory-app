/** Apps Script → POST /api/internal/production-plan-processed/sync */

export type RawProcessedPlanRow = {
  plan_date?: string | null;
  product_name?: string | null;
  qty?: string | number | null;
  manpower?: string | number | null;
  plan_year?: string | number | null;
  plan_month?: string | number | null;
  source_sheet_name?: string | null;
  [key: string]: unknown;
};

export type ProcessedPlanSyncPayload = {
  rows: RawProcessedPlanRow[];
  sourceRefreshedAt?: string | null;
};
