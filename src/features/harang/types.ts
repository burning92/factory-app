export type HarangCategory = "raw_material" | "packaging_material";

export interface HarangMasterItem {
  id: string;
  item_code: string;
  item_name: string;
  default_unit: string;
  /** 설정 시 해당 단위로만 사용 (입고·BOM·생산입력) */
  locked_unit?: string | null;
  box_weight_g?: number;
  unit_weight_g?: number;
  is_active: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface HarangBomRow {
  id: string;
  product_name: string;
  material_category?: "raw_material" | "packaging_material";
  material_id: string;
  material_code: string;
  material_name: string;
  bom_qty: number;
  unit: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HarangInboundItem {
  id: string;
  category: HarangCategory;
  item_id: string;
  item_code: string;
  item_name: string;
  lot_date: string;
  quantity: number;
  unit: string;
  box_qty?: number;
  unit_qty?: number;
  remainder_g?: number;
  note: string | null;
}

export interface HarangInboundHeader {
  id: string;
  inbound_date: string;
  inbound_no: string;
  inbound_route: "AF발송" | "하랑직입고";
  note: string | null;
  created_by: string | null;
  created_at: string;
  items?: HarangInboundItem[];
  profiles?:
    | { display_name: string | null; login_id: string | null }
    | { display_name: string | null; login_id: string | null }[]
    | null;
}

export interface HarangInventoryLot {
  id: string;
  category: HarangCategory;
  item_id: string;
  item_code: string;
  item_name: string;
  lot_date: string;
  inbound_date: string;
  inbound_route: "AF발송" | "하랑직입고";
  source_header_id: string;
  source_item_id: string;
  initial_quantity: number;
  current_quantity: number;
  unit: string;
  note: string | null;
  created_at: string;
}

export interface HarangInventoryTransaction {
  id: number;
  category: HarangCategory;
  item_id: string;
  item_code: string;
  item_name: string;
  lot_id: string | null;
  tx_date: string;
  tx_type: "inbound" | "usage" | "adjustment";
  reference_no: string | null;
  quantity_delta: number;
  unit: string;
  note: string | null;
  created_at: string;
}

export interface HarangProductionHeader {
  id: string;
  production_date: string;
  production_no: string;
  product_name: string;
  finished_qty: number;
  request_id?: string | null;
  request_line_id?: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  profiles?:
    | { display_name: string | null; login_id: string | null }
    | { display_name: string | null; login_id: string | null }[]
    | null;
}
