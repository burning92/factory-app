/** 재고현황 페이지용 한 행 (ecount_inventory_current 기반) */
export type EcountInventoryViewRow = {
  item_code: string;
  display_item_name: string;
  lot_no: string;
  qty: number;
  category: string | null;
  box_weight_g: number;
  unit_weight_g: number;
};

/** 페이지 데이터 (서버 fetch 결과) */
export type EcountInventoryPageData = {
  lastSyncedAt: string | null;
  totalCount: number;
  tab: "원재료" | "부자재" | "반제품";
  rows: EcountInventoryViewRow[];
};

export const INVENTORY_TABS = ["원재료", "부자재", "반제품"] as const;
export type InventoryTab = (typeof INVENTORY_TABS)[number];
