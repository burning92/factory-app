/** API payload from Google Apps Script (raw sheet rows) */

export type RawMasterRow = {
  item_code?: string | null;
  item_name?: string | null;
  inventory_type?: string | null;
  category?: string | null;
  box_weight_g?: string | number | null;
  unit_weight_g?: string | number | null;
  use_yn?: string | null;
  note?: string | null;
  [key: string]: unknown;
};

export type RawInventoryRow = {
  item_code?: string | null;
  raw_item_name?: string | null;
  lot_no?: string | null;
  qty?: string | number | null;
  [key: string]: unknown;
};

export type SyncPayload = {
  masterRows: RawMasterRow[];
  inventoryRows: RawInventoryRow[];
  /** RAW 구글시트 마지막 갱신 시각 (ISO 문자열). 선택. */
  sourceRefreshedAt?: string | null;
};

/** Normalized for ecount_item_master */
export type NormalizedMasterRow = {
  item_code: string;
  item_name: string;
  inventory_type: "원재료" | "부자재" | "반제품";
  category: string | null;
  box_weight_g: number;
  unit_weight_g: number;
  is_active: boolean;
  note: string | null;
};

/** Normalized for ecount_inventory_current (with display fields from master or fallback) */
export type NormalizedInventoryRow = {
  item_code: string;
  lot_no: string;
  qty: number;
  raw_item_name: string;
  display_item_name: string;
  inventory_type: string;
  category: string | null;
  box_weight_g: number;
  unit_weight_g: number;
};

export const ALLOWED_INVENTORY_TYPES = ["원재료", "부자재", "반제품"] as const;
export const LOT_PLACEHOLDER = "NO_LOT";
