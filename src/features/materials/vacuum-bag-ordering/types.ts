import type { PlanningEntryRow } from "@/features/production/planning/types";

export type VacuumBagMovementType = "stock_set" | "receipt" | "usage";

export interface VacuumBagKindRow {
  kind_key: string;
  label: string;
  planning_material_name: string;
  sort_order: number;
}

export interface VacuumBagMovementRow {
  id: string;
  kind_key: string;
  movement_type: VacuumBagMovementType;
  qty: number;
  movement_date: string;
  memo: string | null;
  created_at: string;
}

export interface VacuumBagForecastRow {
  kind_key: string;
  label: string;
  planning_material_name: string;
  current_qty: number;
  required_qty: number;
  projected_qty: number;
  is_shortage: boolean;
  shortage_qty: number;
}

export interface VacuumBagSummaryData {
  today_iso: string;
  weeks: number;
  range_start: string;
  range_end: string;
  kinds: VacuumBagKindRow[];
  balances: Record<string, number>;
  forecast_rows: VacuumBagForecastRow[];
  recent_movements: VacuumBagMovementRow[];
  entries: PlanningEntryRow[];
  excluded_plan_qty: number;
}
