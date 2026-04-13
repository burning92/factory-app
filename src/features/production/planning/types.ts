export type PlanningVersionType = "master" | "draft" | "end";

export type PlanningRangeMode = "day" | "from_selected" | "from_today" | "custom";

export interface PlanningMonthRow {
  id: string;
  plan_year: number;
  plan_month: number;
  version_type: PlanningVersionType;
  title: string | null;
  status: "open" | "closed";
  source_note: string | null;
  baseline_headcount: number;
  created_at: string;
  updated_at: string;
}

export interface PlanningEntryRow {
  id: number;
  month_id: string;
  plan_date: string;
  product_name_snapshot: string;
  qty: number;
  sort_order: number;
}

export interface PlanningNoteRow {
  id: number;
  month_id: string;
  plan_date: string;
  note_text: string;
  note_order: number;
}

export interface PlanningManpowerRow {
  id: number;
  month_id: string;
  plan_date: string;
  annual_leave_count: number;
  half_day_count: number;
  other_count: number;
  actual_manpower: number | null;
}

export interface PlanningLeaveRow {
  id: number;
  month_id: string;
  plan_date: string;
  leave_type: "annual" | "half";
  person_name: string;
  profile_id: string | null;
}

export interface PlanningDayEntryInput {
  product_name_snapshot: string;
  qty: number;
  sort_order: number;
}

export interface PlanningDayPayload {
  month_id: string;
  plan_date: string;
  entries: PlanningDayEntryInput[];
  notes: string[];
  leaves: { leave_type: "annual" | "half"; person_name: string }[];
  annual_leave_count: number;
  half_day_count: number;
  other_count: number;
  baseline_headcount: number;
}

export interface PlanningInventoryRow {
  item_code: string;
  qty: number;
  box_weight_g: number;
  unit_weight_g: number;
}

export interface PlanningMaterialRow {
  material_name: string;
  inventory_item_code: string | null;
}

export interface PlanningBomRow {
  product_name: string;
  material_name: string;
  bom_g_per_ea: number;
}

export interface MaterialRequirementRow {
  material_name: string;
  required_g: number;
  stock_g: number;
  shortage_g: number;
  order_required_g: number;
}

export interface PlanningMonthData {
  month: PlanningMonthRow;
  entries: PlanningEntryRow[];
  notes: PlanningNoteRow[];
  manpower: PlanningManpowerRow[];
  leaves: PlanningLeaveRow[];
  products: string[];
  people: { id: string; name: string }[];
  versions: PlanningVersionType[];
  materialRows: PlanningMaterialRow[];
  bomRows: PlanningBomRow[];
  inventoryRows: PlanningInventoryRow[];
  totalMembers: number;
}

export interface PlanningProcessedRow {
  plan_date: string;
  product_name: string;
  qty: number;
  manpower: number;
  note: string;
}
