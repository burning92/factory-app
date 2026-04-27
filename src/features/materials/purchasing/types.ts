import type { PlanningBomRow, PlanningEntryRow, PlanningInventoryRow, PlanningSubmaterialRow } from "@/features/production/planning/types";

export type PurchasingPeriodKey = "d7" | "d14" | "d30" | "month_end" | "month_next";
export type PurchasingOrderPolicy = "normal" | "on_demand";
export type PurchasingStatus = "urgent" | "warning" | "scheduled" | "safe";

export interface PurchasingMaterialMasterRow {
  material_name: string;
  inventory_item_code: string | null;
  material_type: "raw_material" | "submaterial";
}

export interface PurchasingVendorItemRow {
  id: string;
  vendor_id: string;
  vendor_name: string;
  material_code: string | null;
  material_name_snapshot: string;
  material_type: "raw_material" | "submaterial";
  order_spec_label: string | null;
  purchase_unit_weight_g: number;
  purchase_unit_name: string | null;
  lead_time_days: number;
  safety_stock_g: number;
  order_policy: PurchasingOrderPolicy;
  is_primary_vendor: boolean;
  note: string | null;
}

export interface PurchasingDatePoint {
  date: string;
  required_g: number;
  cumulative_required_g: number;
}

export interface PurchasingProductDriver {
  product_name_snapshot: string;
  required_g: number;
}

export interface PurchasingTableRow {
  material_name: string;
  material_type: "raw_material" | "submaterial" | "unknown";
  vendor_name: string;
  has_primary_vendor: boolean;
  stock_g: number;
  safety_stock_g: number;
  order_policy: PurchasingOrderPolicy;
  required_7d_g: number;
  required_14d_g: number;
  required_selected_g: number;
  shortage_g: number;
  shortage_start_date: string | null;
  lead_time_days: number;
  order_due_date: string | null;
  recommended_order_g: number;
  recommended_order_units: number | null;
  purchase_unit_weight_g: number | null;
  order_spec_label: string | null;
  order_unit_name: string | null;
  status: PurchasingStatus;
  date_points: PurchasingDatePoint[];
  product_drivers: PurchasingProductDriver[];
}

export interface PurchasingSummaryData {
  today_iso: string;
  range_start: string;
  range_end: string;
  entries: PlanningEntryRow[];
  bomRows: PlanningBomRow[];
  submaterialRows: PlanningSubmaterialRow[];
  inventoryRows: PlanningInventoryRow[];
  materialRows: PurchasingMaterialMasterRow[];
  vendorItemRows: PurchasingVendorItemRow[];
}

