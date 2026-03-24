import { create } from "zustand";
import type { Material, BomRow } from "@/lib/mockData";
import { supabase } from "@/lib/supabase";

/** Supabase/PostgrestError 등에서 사용자에게 보여줄 에러 문구 추출 (message / details / hint 또는 JSON) */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err != null && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const msg = [o.message, o.details, o.hint].filter(Boolean).map(String).join(" / ");
    if (msg.trim()) return msg;
    return JSON.stringify(err, null, 2);
  }
  return String(err);
}

/** 소비기한별 출고 라인 */
export interface OutboundLine {
  소비기한: string;
  박스: number;
  낱개: number;
  g: number;
  /** 해당 소비기한 라인 마감 시 전일 재고(g) — 라인별 마감 상태 판단용 */
  prior_stock_g?: number;
  /** 해당 소비기한 라인 마감 시 당일 잔량(g) — 라인별 마감 상태 판단용 */
  closing_remainder_g?: number;
  /** 해당 소비기한 라인만의 사용량(g) = 전일재고 + 출고량 - 당일잔량 (라인별 저장·표시용) */
  actual_usage_g?: number;
}

/** 미리 구워놓은 파베이크 사용 한 줄 (수량 + 소비기한) */
export interface ParbakeUsedLine {
  qty: number;
  expiry: string;
}

/** 도우 반죽 공정: 원료별 LOT 한 줄 */
export interface DoughProcessLine {
  사용량_g: number;
  lot: string;
}

/** 도우 반죽 공정 입력 데이터 (run 단위, 첫 로그에 저장) */
export interface DoughProcessData {
  반죽날짜: string;
  사용일자: string;
  작성자명: string;
  /** 반죽 원료: 밀가루, 올리브오일, 소금, 설탕, 이스트, 개량제 */
  반죽원료: Record<string, DoughProcessLine[]>;
  /** 덧가루/덧기름: 덧가루-밀가루, 덧가루-세몰리나, 덧기름-카놀라유 */
  덧가루덧기름: Record<string, DoughProcessLine[]>;
}

/** 출고 기록 */
export interface ProductionLog {
  id: string;
  생산일자: string;
  제품명: string;
  원료명: string;
  출고_라인?: OutboundLine[];
  출고_박스: number;
  출고_낱개: number;
  출고_g: number;
  /** 1차 실시간 사용량: (당일 출고 + 전일 재고) - 당일 잔량 */
  일차사용량_g?: number;
  /** 2차 정산 후 최종 사용량 = 일차사용량_g - 소스폐기량_g (도우 원료) */
  실사용량_g?: number;
  /** 잔량 마감 시 입력한 전일 재고 합계(g) — 리스트 표시용 */
  전일재고_g?: number;
  /** 잔량 마감 시 입력한 당일 잔량 합계(g) — 리스트 표시용 */
  당일잔량_g?: number;
  /** 소스 폐기량(g), 2차 정산 시 도출 */
  소스폐기량_g?: number;
  /** 소스 폐기량의 소비기한 (출고/전일재고 연동) */
  소스폐기량_소비기한?: string;
  상태: "출고됨" | "마감완료";
  /** 출고자/작성자 */
  출고자?: string;
  작성자2?: string;
  승인자?: string;
  /** 소비기한 (생산일자+364일) */
  소비기한?: string;
  반죽량?: number;
  반죽폐기량?: number;
  /** 작업자(잔량 입력자) */
  작업자?: string;
  /** 출고 입력 단계의 완제품 예상수량(EA) */
  완제품예상수량?: number;
  /** 2차 정산: 실제 완제품 생산량 */
  완제품생산량?: number;
  /** 미리 구워놓은 파베이크 사용 (수량 + 소비기한) */
  파베이크사용_라인?: ParbakeUsedLine[];
  보관용파베이크?: number;
  판매용파베이크?: number;
  /** 도우 반죽 공정 입력 (반죽날짜, 사용일자, 반죽원료/덧가루덧기름 LOT별 사용량) */
  dough_data?: DoughProcessData;
}

type SavingKind = "" | "materials" | "bom" | "doughBom" | "logs";

/** 도우 BOM: 밀가루 1kg 기준 부재료(g). 1포대당 생산 수량으로 권장 포대 수 계산 */
export interface DoughBom {
  id: string;
  name: string;
  /** 1포대(25kg)당 생산 수량(개). 권장 포대 수 = 목표 수량 / qtyPerBag */
  qtyPerBag: number;
  salt: number;
  yeast: number;
  oil: number;
  sugar: number;
  improver: number;
}

/** Independent dough log keyed by usage_date (사용일자). Used for auto-join on production date when printing journal. */
export interface DoughLogRecord {
  사용일자: string;
  작성자명: string;
  반죽원료: Record<string, DoughProcessLine[]>;
  덧가루덧기름: Record<string, DoughProcessLine[]>;
  /** 반죽날짜(1단계). 표시용 */
  반죽일자?: string;
  /** 목표 수량(개). 표시용 */
  예상수량?: number;
  /** 도우 BOM id (dough_boms.id). 수정 시 도우 종류 드롭다운 매핑용 */
  dough_id?: string;
}

/** 사용량 계산: 원료별 전일/당일 재고 다중 LOT */
export interface MaterialStockLot {
  qty_g: number;
  expiry: string;
}

export interface UsageCalculationRecord {
  id?: string;
  production_date: string;
  product_name: string;
  author_name?: string;
  dough_usage_g?: number;
  /** 도우 반죽량 (EA) */
  dough_usage_qty?: number;
  dough_waste_g?: number;
  /** 도우 폐기량 (EA) */
  dough_waste_qty?: number;
  finished_qty_expected?: number;
  /** 완제품 생산수량 (EA) */
  finished_qty_actual?: number;
  /** 추가 파베이크 수량 (EA) */
  parbake_add_qty?: number;
  /** 우주인 파베이크 생산량 (EA) */
  parbake_woozooin_qty?: number;
  /** 판매용 파베이크 생산량 (EA) */
  parbake_sales_qty?: number;
  /** draft=작성 중, stock_entered=재고입력완료, closed=최종마감 */
  status?: "draft" | "stock_entered" | "closed";
  /** 원료명 -> { prior_stock, closing_stock } 각각 LOT 배열 */
  materials_data: Record<
    string,
    { prior_stock: MaterialStockLot[]; closing_stock: MaterialStockLot[] }
  >;
}

/** 1차/2차 마감 날짜별 상태 (Supabase production_history_date_state) */
export interface ProductionHistoryDateStateRow {
  production_date: string;
  first_closed_at: string | null;
  second_closed_at: string | null;
  author_name: string | null;
  state_snapshot: unknown;
  updated_at: string;
  updated_by: string | null;
}

interface MasterState {
  materials: Material[];
  bomList: BomRow[];
  /** 도우 BOM 목록 (반죽사용량 입력 페이지 드롭다운·배합 비율 계산) */
  doughBoms: DoughBom[];
  productionLogs: ProductionLog[];
  lastUsedDates: Record<string, string>;
  /** usage_date -> DoughLogRecord (independent dough data, not nested in product logs) */
  doughLogsMap: Record<string, DoughLogRecord>;
  /** 사용량 계산 목록 (생산일자·제품별) */
  usageCalculations: UsageCalculationRecord[];
  usageCalculationsLoading: boolean;

  materialsLoading: boolean;
  bomLoading: boolean;
  doughBomsLoading: boolean;
  productionLogsLoading: boolean;
  lastUsedDatesLoading: boolean;
  doughLogsLoading: boolean;
  saving: SavingKind;
  error: string | null;

  fetchMaterials: () => Promise<void>;
  fetchBom: () => Promise<void>;
  fetchDoughBoms: () => Promise<void>;
  addDoughBom: (row: Omit<DoughBom, "id">) => Promise<void>;
  updateDoughBom: (id: string, patch: Partial<Omit<DoughBom, "id">>) => Promise<void>;
  deleteDoughBom: (id: string) => Promise<void>;
  fetchProductionLogs: () => Promise<void>;
  fetchLastUsedDates: () => Promise<void>;
  fetchDoughLogs: () => Promise<void>;
  getDoughLogByDate: (usageDate: string) => DoughLogRecord | null;
  saveDoughLog: (usageDate: string, data: DoughLogRecord) => Promise<void>;
  deleteDoughLog: (usageDate: string) => Promise<void>;
  fetchUsageCalculations: () => Promise<void>;
  saveUsageCalculation: (data: UsageCalculationRecord) => Promise<void>;
  deleteUsageCalculation: (id: string) => Promise<void>;
  getUsageCalculation: (production_date: string, product_name: string) => UsageCalculationRecord | null;
  /** 해당 제품의 생산일자가 주어진 날짜보다 이전인 '가장 최근' 사용량 계산 기록 (전일재고 자동 이월용) */
  getLatestUsageCalculationBefore: (production_date: string, product_name: string) => UsageCalculationRecord | null;
  /** 해당 생산일자·제품의 출고 원료별 총량(g). 출고 데이터 자동 불러오기용 */
  getOutboundTotalsByDateProduct: (production_date: string, product_name: string) => Record<string, number>;

  /** 1차/2차 마감 날짜별 상태 (Supabase). history 페이지 상태 판단 기준 */
  productionHistoryDateStates: Record<string, ProductionHistoryDateStateRow>;
  productionHistoryDateStatesLoading: boolean;
  fetchProductionHistoryDateStates: () => Promise<void>;
  saveProductionHistoryDateState: (
    production_date: string,
    payload: {
      first_closed_at?: string | null;
      second_closed_at?: string | null;
      author_name?: string | null;
      state_snapshot: unknown;
      updated_by?: string | null;
    }
  ) => Promise<void>;
  getProductionHistoryDateState: (production_date: string) => ProductionHistoryDateStateRow | null;

  addMaterial: (m: Omit<Material, "id">) => Promise<void>;
  updateMaterial: (id: string, patch: Partial<Omit<Material, "id">>) => Promise<void>;
  deleteMaterial: (id: string) => Promise<void>;

  addBomRows: (rows: Omit<BomRow, "id">[]) => Promise<void>;
  updateBomRow: (id: string, patch: Partial<Omit<BomRow, "id">>) => Promise<void>;
  deleteBomRow: (id: string) => Promise<void>;

  addProductionLog: (log: Omit<ProductionLog, "id" | "상태"> & { 상태?: "출고됨" }) => Promise<void>;
  closeProductionLog: (id: string, patch: { 실사용량_g: number; 상태: "마감완료"; 작업자?: string; 작성자2?: string; 반죽량?: number; 반죽폐기량?: number; 전일재고_g?: number; 당일잔량_g?: number; 출고_라인?: OutboundLine[] }) => Promise<void>;
  /** 해당 log의 출고_라인 맨 뒤에 새 라인 추가 (당일 출고 0). DB·로컬 상태 동시 갱신 */
  appendOutboundLine: (logId: string, newLine: OutboundLine) => Promise<void>;
  updateProductionRunMeta: (생산일자: string, 제품명: string, patch: { 작성자2?: string; 반죽량?: number; 반죽폐기량?: number }) => Promise<void>;
  /** 2차 최종 정산: 완제품생산량·파베이크 사용·보관용·판매용 입력 후 소스 재정산 */
  settleProductionRun: (
    생산일자: string,
    제품명: string,
    payload: {
      완제품생산량: number;
      파베이크사용_라인: ParbakeUsedLine[];
      보관용파베이크: number;
      판매용파베이크: number;
    }
  ) => Promise<void>;
  setLastUsedDate: (materialName: string, date: string) => Promise<void>;
  /** 해당 생산일자+제품명 그룹의 production_logs 전체 삭제 */
  deleteProductionLogsByGroup: (생산일자: string, 제품명: string) => Promise<void>;
  /** 해당 생산일자+제품명 그룹의 출고 수량(g) 일괄 변경 (출고 현황 인라인 수정용) */
  updateOutboundQuantityByGroup: (생산일자: string, 제품명: string, totalG: number) => Promise<void>;
  /** 단일 출고 로그의 특정 LOT(라인 인덱스)만 박스/낱개/g 수정. 출고_라인 배열 불변 유지 */
  updateProductionLogOutbound: (logId: string, payload: { lineIndex: number; 박스: number; 낱개: number; g: number }) => Promise<void>;
  /** 단일 출고 로그의 특정 LOT 한 줄 삭제. 마지막 1개면 해당 원료 출고 기록 전체 삭제 */
  deleteProductionLogOutboundLine: (logId: string, lineIndex: number) => Promise<void>;
  /** 단일 출고 로그(원료 1건) 삭제 */
  deleteProductionLog: (logId: string) => Promise<void>;
}

function mapMaterialFromDb(row: {
  id: string;
  material_name: string;
  box_weight_g: number;
  unit_weight_g: number;
  inventory_item_code?: string | null;
}): Material {
  return {
    id: row.id,
    materialName: row.material_name,
    boxWeightG: row.box_weight_g ?? 0,
    unitWeightG: row.unit_weight_g ?? 0,
    inventoryItemCode: row.inventory_item_code?.trim() || undefined,
  };
}

function mapBomFromDb(row: { id: string; product_name: string; material_name: string; bom_g_per_ea: number; basis: "완제품" | "도우" }): BomRow {
  return {
    id: row.id,
    productName: row.product_name,
    materialName: row.material_name,
    bomGPerEa: row.bom_g_per_ea ?? 0,
    basis: row.basis,
  };
}

/** 생산일자 + 364일 = 소비기한 */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function toStockLot(arr: unknown): MaterialStockLot[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => {
    const o = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      qty_g: Number(o.qty_g) || 0,
      expiry: String(o.expiry ?? "").slice(0, 10),
    };
  });
}

function normalizeMaterialsData(
  raw: Record<string, { prior_stock?: unknown[]; closing_stock?: unknown[] }>
): Record<string, { prior_stock: MaterialStockLot[]; closing_stock: MaterialStockLot[] }> {
  const out: Record<string, { prior_stock: MaterialStockLot[]; closing_stock: MaterialStockLot[] }> = {};
  for (const key of Object.keys(raw ?? {})) {
    const v = raw[key];
    out[key] = {
      prior_stock: toStockLot(v?.prior_stock),
      closing_stock: toStockLot(v?.closing_stock),
    };
  }
  return out;
}

function mapProductionLogFromDb(row: {
  id: string;
  production_date: string;
  product_name: string;
  material_name: string;
  outbound_lines: unknown;
  outbound_box: number;
  outbound_bag: number;
  outbound_g: number;
  actual_usage_g: number | null;
  primary_usage_g?: number | null;
  source_waste_g?: number | null;
  source_waste_expiry?: string | null;
  status: "출고됨" | "마감완료";
  preparer_name?: string | null;
  preparer_name_2?: string | null;
  approver_name?: string | null;
  expiry_date?: string | null;
  dough_qty?: number | null;
  dough_waste_qty?: number | null;
  operator_name?: string | null;
  finished_qty_expected?: number | null;
  finished_product_qty?: number | null;
  parbake_used_lines?: unknown;
  parbake_storage_qty?: number | null;
  parbake_sales_qty?: number | null;
  prior_stock_g?: number | null;
  closing_remainder_g?: number | null;
  dough_process_data?: unknown;
}): ProductionLog {
  const toNum = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const toDateStr = (v: unknown): string => String(v ?? "").slice(0, 10);
  const rawLines = Array.isArray(row.outbound_lines) ? row.outbound_lines as unknown[] : [];
  const lines: OutboundLine[] = rawLines
    .map((item) => {
      const o = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        소비기한: toDateStr(o.소비기한),
        박스: toNum(o.박스),
        낱개: toNum(o.낱개),
        g: toNum(o.g),
        prior_stock_g: o.prior_stock_g != null ? toNum(o.prior_stock_g) : undefined,
        closing_remainder_g: o.closing_remainder_g != null ? toNum(o.closing_remainder_g) : undefined,
        actual_usage_g: o.actual_usage_g != null ? toNum(o.actual_usage_g) : undefined,
      };
    });
  const rawParbake = Array.isArray(row.parbake_used_lines) ? row.parbake_used_lines as unknown[] : [];
  const parbakeLines: ParbakeUsedLine[] = rawParbake
    .map((item) => {
      const o = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return { qty: toNum(o.qty), expiry: toDateStr(o.expiry) };
    })
    .filter((x) => x.qty > 0 || (x.expiry ?? "").trim() !== "");
  const doughData = row.dough_process_data as DoughProcessData | null | undefined;
  const statusVal = row.status === "마감완료" ? "마감완료" : "출고됨";
  return {
    id: String(row.id),
    생산일자: toDateStr(row.production_date),
    제품명: String(row.product_name ?? ""),
    원료명: String(row.material_name ?? ""),
    출고_라인: lines.length > 0 ? lines : undefined,
    출고_박스: toNum(row.outbound_box),
    출고_낱개: toNum(row.outbound_bag),
    출고_g: toNum(row.outbound_g),
    일차사용량_g: row.primary_usage_g != null ? toNum(row.primary_usage_g) : undefined,
    실사용량_g: row.actual_usage_g != null ? toNum(row.actual_usage_g) : undefined,
    전일재고_g: row.prior_stock_g != null ? toNum(row.prior_stock_g) : undefined,
    당일잔량_g: row.closing_remainder_g != null ? toNum(row.closing_remainder_g) : undefined,
    소스폐기량_g: row.source_waste_g != null ? toNum(row.source_waste_g) : undefined,
    소스폐기량_소비기한: row.source_waste_expiry != null ? toDateStr(row.source_waste_expiry) : undefined,
    상태: statusVal,
    출고자: row.preparer_name ?? undefined,
    작성자2: row.preparer_name_2 ?? undefined,
    승인자: row.approver_name ?? undefined,
    소비기한: row.expiry_date != null ? toDateStr(row.expiry_date) : undefined,
    반죽량: row.dough_qty != null ? toNum(row.dough_qty) : undefined,
    반죽폐기량: row.dough_waste_qty != null ? toNum(row.dough_waste_qty) : undefined,
    작업자: row.operator_name ?? undefined,
    완제품예상수량: row.finished_qty_expected != null ? toNum(row.finished_qty_expected) : undefined,
    완제품생산량: row.finished_product_qty != null ? toNum(row.finished_product_qty) : undefined,
    파베이크사용_라인: parbakeLines.length > 0 ? parbakeLines : undefined,
    보관용파베이크: row.parbake_storage_qty != null ? toNum(row.parbake_storage_qty) : undefined,
    판매용파베이크: row.parbake_sales_qty != null ? toNum(row.parbake_sales_qty) : undefined,
    dough_data: doughData && typeof doughData === "object" ? doughData : undefined,
  };
}

function mapDoughLogFromDb(row: {
  usage_date: string;
  author_name?: string | null;
  dough_ingredients?: unknown;
  dust_oil?: unknown;
  dough_date?: string | null;
  meta?: { target_quantity?: number; dough_id?: string } | null;
}): DoughLogRecord {
  const usage_date = typeof row.usage_date === "string" ? row.usage_date.slice(0, 10) : "";
  const 반죽원료 = (row.dough_ingredients && typeof row.dough_ingredients === "object") ? row.dough_ingredients as Record<string, DoughProcessLine[]> : {};
  const 덧가루덧기름 = (row.dust_oil && typeof row.dust_oil === "object") ? row.dust_oil as Record<string, DoughProcessLine[]> : {};
  const dough_date = row.dough_date != null ? String(row.dough_date).slice(0, 10) : undefined;
  const meta = row.meta != null && typeof row.meta === "object" ? row.meta as { target_quantity?: number; dough_id?: string } : undefined;
  const 예상수량 = meta != null && typeof meta.target_quantity === "number" ? meta.target_quantity : undefined;
  const dough_id = meta != null && typeof meta.dough_id === "string" && meta.dough_id.trim() !== "" ? meta.dough_id.trim() : undefined;
  return {
    사용일자: usage_date,
    작성자명: row.author_name ?? "",
    반죽원료,
    덧가루덧기름,
    반죽일자: dough_date || undefined,
    예상수량,
    dough_id: dough_id || undefined,
  };
}

export const useMasterStore = create<MasterState>((set, get) => ({
  materials: [],
  bomList: [],
  doughBoms: [],
  productionLogs: [],
  lastUsedDates: {},
  doughLogsMap: {},
  usageCalculations: [],
  usageCalculationsLoading: false,
  productionHistoryDateStates: {},
  productionHistoryDateStatesLoading: false,

  materialsLoading: false,
  bomLoading: false,
  doughBomsLoading: false,
  productionLogsLoading: false,
  lastUsedDatesLoading: false,
  doughLogsLoading: false,
  saving: "",
  error: null,

  fetchMaterials: async () => {
    set({ materialsLoading: true, error: null });
    try {
      const { data, error: e } = await supabase
        .from("materials")
        .select("id, material_name, box_weight_g, unit_weight_g, inventory_item_code")
        .order("material_name");
      if (e) throw e;
      set({ materials: (data ?? []).map(mapMaterialFromDb), materialsLoading: false });
    } catch (err) {
      set({
        materialsLoading: false,
        error: err instanceof Error ? err.message : "원료 목록을 불러오지 못했습니다.",
      });
    }
  },

  fetchBom: async () => {
    set({ bomLoading: true, error: null });
    try {
      const { data, error: e } = await supabase.from("bom").select("id, product_name, material_name, bom_g_per_ea, basis").order("product_name");
      if (e) throw e;
      set({ bomList: (data ?? []).map(mapBomFromDb), bomLoading: false });
    } catch (err) {
      set({
        bomLoading: false,
        error: err instanceof Error ? err.message : "BOM 목록을 불러오지 못했습니다.",
      });
    }
  },

  fetchDoughBoms: async () => {
    set({ doughBomsLoading: true, error: null });
    try {
      const { data, error: e } = await supabase
        .from("dough_boms")
        .select("id, name, production_per_bag, salt, yeast, oil, sugar, improver")
        .order("name");
      if (e) throw e;
      set({
        doughBoms: (data ?? []).map((row: { id: number; name: string; production_per_bag: number; salt: number; yeast: number; oil: number; sugar: number; improver: number }) => ({
          id: String(row.id),
          name: row.name ?? "",
          qtyPerBag: Number(row.production_per_bag) ?? 0,
          salt: Number(row.salt) ?? 0,
          yeast: Number(row.yeast) ?? 0,
          oil: Number(row.oil) ?? 0,
          sugar: Number(row.sugar) ?? 0,
          improver: Number(row.improver) ?? 0,
        })),
        doughBomsLoading: false,
      });
    } catch (err) {
      set({
        doughBomsLoading: false,
        error: err instanceof Error ? err.message : "도우 BOM 목록을 불러오지 못했습니다.",
      });
    }
  },

  addDoughBom: async (row: Omit<DoughBom, "id">) => {
    set({ saving: "doughBom", error: null });
    const toInt = (v: unknown) => (typeof v === "number" && !Number.isNaN(v) ? Math.floor(v) : parseInt(String(v), 10) || 0);
    const toFloat = (v: unknown): number => {
      if (typeof v === "number" && !Number.isNaN(v)) return v;
      const n = parseFloat(String(v));
      return Number.isNaN(n) ? 0 : n;
    };
    const payload = {
      name: String(row.name ?? "").trim(),
      production_per_bag: toInt(row.qtyPerBag),
      salt: toFloat(row.salt),
      yeast: toFloat(row.yeast),
      oil: toFloat(row.oil),
      sugar: toFloat(row.sugar),
      improver: toFloat(row.improver),
    };
    try {
      const { data, error: e } = await supabase
        .from("dough_boms")
        .insert(payload)
        .select("id, name, production_per_bag, salt, yeast, oil, sugar, improver")
        .single();
      if (e) throw e;
      const newRow: DoughBom = {
        id: String(data.id),
        name: data.name ?? "",
        qtyPerBag: Number(data.production_per_bag) ?? 0,
        salt: toFloat(data.salt),
        yeast: toFloat(data.yeast),
        oil: toFloat(data.oil),
        sugar: toFloat(data.sugar),
        improver: toFloat(data.improver),
      };
      set((state) => ({ doughBoms: [...state.doughBoms, newRow], saving: "" }));
    } catch (err) {
      const msg = getErrorMessage(err);
      set({ saving: "", error: msg });
      throw err;
    }
  },

  updateDoughBom: async (id: string, patch: Partial<Omit<DoughBom, "id">>) => {
    set({ saving: "doughBom", error: null });
    const toInt = (v: unknown) => (typeof v === "number" && !Number.isNaN(v) ? Math.floor(v) : parseInt(String(v), 10) || 0);
    const toFloat = (v: unknown): number => {
      if (typeof v === "number" && !Number.isNaN(v)) return v;
      const n = parseFloat(String(v));
      return Number.isNaN(n) ? 0 : n;
    };
    const payload: Record<string, unknown> = {};
    if (patch.name != null) payload.name = String(patch.name).trim();
    if (patch.qtyPerBag != null) payload.production_per_bag = toInt(patch.qtyPerBag);
    if (patch.salt != null) payload.salt = toFloat(patch.salt);
    if (patch.yeast != null) payload.yeast = toFloat(patch.yeast);
    if (patch.oil != null) payload.oil = toFloat(patch.oil);
    if (patch.sugar != null) payload.sugar = toFloat(patch.sugar);
    if (patch.improver != null) payload.improver = toFloat(patch.improver);
    const idNum = parseInt(id, 10);
    const idForDb = Number.isNaN(idNum) ? id : idNum;
    try {
      const { error: e } = await supabase.from("dough_boms").update(payload).eq("id", idForDb);
      if (e) throw e;
      set((state) => ({
        doughBoms: state.doughBoms.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        saving: "",
      }));
    } catch (err) {
      const msg = getErrorMessage(err);
      set({ saving: "", error: msg });
      throw err;
    }
  },

  deleteDoughBom: async (id: string) => {
    set({ saving: "doughBom", error: null });
    try {
      const idNum = parseInt(id, 10);
      const { error: e } = await supabase.from("dough_boms").delete().eq("id", Number.isNaN(idNum) ? id : idNum);
      if (e) throw e;
      set((state) => ({ doughBoms: state.doughBoms.filter((x) => x.id !== id), saving: "" }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "도우 BOM 삭제에 실패했습니다.",
      });
      throw err;
    }
  },

  fetchProductionLogs: async () => {
    set({ productionLogsLoading: true, error: null });
    try {
      const primarySelect = "id, production_date, product_name, material_name, outbound_lines, outbound_box, outbound_bag, outbound_g, actual_usage_g, primary_usage_g, source_waste_g, source_waste_expiry, status, preparer_name, preparer_name_2, approver_name, expiry_date, dough_qty, dough_waste_qty, operator_name, finished_qty_expected, finished_product_qty, parbake_used_lines, parbake_storage_qty, parbake_sales_qty, prior_stock_g, closing_remainder_g, dough_process_data";
      const fallbackSelect = "id, production_date, product_name, material_name, outbound_lines, outbound_box, outbound_bag, outbound_g, actual_usage_g, status, preparer_name, preparer_name_2, approver_name, expiry_date, dough_qty, dough_waste_qty, operator_name, finished_qty_expected";
      const primary = await supabase
        .from("production_logs")
        .select(primarySelect)
        .order("production_date", { ascending: false })
        .order("created_at", { ascending: false });
      let rows: unknown[] = [];
      if (primary.error) {
        console.warn("[fetchProductionLogs] primary select failed. Fallback query will run.", primary.error);
        const fallback = await supabase
          .from("production_logs")
          .select(fallbackSelect)
          .order("production_date", { ascending: false })
          .order("created_at", { ascending: false });
        if (fallback.error) throw fallback.error;
        rows = (fallback.data ?? []) as unknown[];
      } else {
        rows = (primary.data ?? []) as unknown[];
      }
      const mapped: ProductionLog[] = [];
      for (const raw of rows) {
        try {
          mapped.push(mapProductionLogFromDb(raw as Parameters<typeof mapProductionLogFromDb>[0]));
        } catch (parseErr) {
          console.warn("[fetchProductionLogs] skipped malformed row:", parseErr, raw);
        }
      }
      set({ productionLogs: mapped, productionLogsLoading: false, error: null });
    } catch (err) {
      set({
        productionLogsLoading: false,
        error: getErrorMessage(err) || "출고 기록을 불러오지 못했습니다.",
      });
    }
  },

  fetchLastUsedDates: async () => {
    set({ lastUsedDatesLoading: true, error: null });
    try {
      const { data, error: e } = await supabase.from("last_used_dates").select("material_name, last_expiry_date");
      if (e) throw e;
      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        map[row.material_name] = row.last_expiry_date;
      }
      set({ lastUsedDates: map, lastUsedDatesLoading: false });
    } catch (err) {
      set({
        lastUsedDatesLoading: false,
        error: err instanceof Error ? err.message : "소비기한 기본값을 불러오지 못했습니다.",
      });
    }
  },

  fetchDoughLogs: async () => {
    set({ doughLogsLoading: true, error: null });
    try {
      const { data, error: e } = await supabase
        .from("dough_logs")
        .select("usage_date, author_name, dough_ingredients, dust_oil, dough_date, meta")
        .order("usage_date", { ascending: false });
      if (e) throw e;
      const map: Record<string, DoughLogRecord> = {};
      for (const row of data ?? []) {
        const usage_date = typeof row.usage_date === "string" ? row.usage_date.slice(0, 10) : String(row.usage_date).slice(0, 10);
        map[usage_date] = mapDoughLogFromDb(row as Parameters<typeof mapDoughLogFromDb>[0]);
      }
      set({ doughLogsMap: map, doughLogsLoading: false });
    } catch (err) {
      set({
        doughLogsLoading: false,
        error: err instanceof Error ? err.message : "반죽 사용량 목록을 불러오지 못했습니다.",
      });
    }
  },

  getDoughLogByDate: (usageDate: string) => {
    const dateKey = usageDate.slice(0, 10);
    return get().doughLogsMap[dateKey] ?? null;
  },

  saveDoughLog: async (usageDate: string, data: DoughLogRecord) => {
    set({ saving: "logs", error: null });
    const dateKey = usageDate.slice(0, 10);
    const sanitizeLine = (l: DoughProcessLine): { 사용량_g: number; lot: string } => ({
      사용량_g: Number.isFinite(l.사용량_g) && !Number.isNaN(l.사용량_g) ? Math.max(0, Number(l.사용량_g)) : 0,
      lot: l.lot != null && String(l.lot).trim() !== "" ? String(l.lot).trim() : "—",
    });
    const sanitizeRecord = (rec: Record<string, DoughProcessLine[]>): Record<string, { 사용량_g: number; lot: string }[]> => {
      const out: Record<string, { 사용량_g: number; lot: string }[]> = {};
      for (const key of Object.keys(rec ?? {})) {
        const arr = rec[key];
        if (Array.isArray(arr) && arr.length > 0)
          out[key] = arr.map(sanitizeLine);
      }
      return out;
    };
    try {
      const doughIng = sanitizeRecord(data.반죽원료 ?? {});
      const dustOil = sanitizeRecord(data.덧가루덧기름 ?? {});
      const meta: { target_quantity?: number; dough_id?: string } = {};
      if (data.예상수량 != null && Number.isFinite(data.예상수량)) meta.target_quantity = Math.round(data.예상수량);
      if (data.dough_id != null && String(data.dough_id).trim() !== "") meta.dough_id = String(data.dough_id).trim();
      const payload = {
        usage_date: dateKey,
        author_name: data.작성자명 != null && String(data.작성자명).trim() !== "" ? String(data.작성자명).trim() : null,
        dough_ingredients: Object.keys(doughIng).length ? doughIng : {},
        dust_oil: Object.keys(dustOil).length ? dustOil : {},
        dough_date: data.반죽일자 != null && String(data.반죽일자).trim() !== "" ? String(data.반죽일자).trim().slice(0, 10) : null,
        meta: Object.keys(meta).length ? meta : null,
        updated_at: new Date().toISOString(),
      };
      const { error: e } = await supabase.from("dough_logs").upsert(payload, {
        onConflict: "usage_date",
      });
      if (e) throw e;
      set((state) => ({
        doughLogsMap: { ...state.doughLogsMap, [dateKey]: data },
        saving: "",
      }));
    } catch (err) {
      const msg = getErrorMessage(err);
      set({
        saving: "",
        error: msg || "반죽 사용량 저장에 실패했습니다.",
      });
      throw err;
    }
  },

  deleteDoughLog: async (usageDate: string) => {
    set({ saving: "logs", error: null });
    const dateKey = usageDate.slice(0, 10);
    try {
      const { error: e } = await supabase
        .from("dough_logs")
        .delete()
        .eq("usage_date", dateKey);
      if (e) throw e;
      set((state) => {
        const next = { ...state.doughLogsMap };
        delete next[dateKey];
        return { doughLogsMap: next, saving: "" };
      });
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "반죽 내역 삭제에 실패했습니다.",
      });
      throw err;
    }
  },

  fetchUsageCalculations: async () => {
    set({ usageCalculationsLoading: true, error: null });
    try {
      const { data, error: e } = await supabase
        .from("usage_calculations")
        .select("id, production_date, product_name, author_name, dough_usage_g, dough_usage_qty, dough_waste_g, dough_waste_qty, finished_qty_expected, finished_qty_actual, parbake_add_qty, parbake_woozooin_qty, parbake_sales_qty, status, materials_data")
        .order("production_date", { ascending: false });
      if (e) throw e;
      const list: UsageCalculationRecord[] = (data ?? []).map((row) => {
        const raw = (row.materials_data && typeof row.materials_data === "object" ? row.materials_data as Record<string, { prior_stock?: unknown[]; closing_stock?: unknown[] }> : {});
        const statusVal = row.status as string | null;
        const status = statusVal === "stock_entered" || statusVal === "closed" ? statusVal : "draft";
        return {
          id: row.id,
          production_date: String(row.production_date).slice(0, 10),
          product_name: row.product_name ?? "",
          author_name: row.author_name ?? undefined,
          dough_usage_g: row.dough_usage_g != null ? Number(row.dough_usage_g) : undefined,
          dough_usage_qty: row.dough_usage_qty != null ? Number(row.dough_usage_qty) : undefined,
          dough_waste_g: row.dough_waste_g != null ? Number(row.dough_waste_g) : undefined,
          dough_waste_qty: row.dough_waste_qty != null ? Number(row.dough_waste_qty) : undefined,
          finished_qty_expected: row.finished_qty_expected != null ? Number(row.finished_qty_expected) : undefined,
          finished_qty_actual: row.finished_qty_actual != null ? Number(row.finished_qty_actual) : undefined,
          parbake_add_qty: row.parbake_add_qty != null ? Number(row.parbake_add_qty) : undefined,
          parbake_woozooin_qty: row.parbake_woozooin_qty != null ? Number(row.parbake_woozooin_qty) : undefined,
          parbake_sales_qty: row.parbake_sales_qty != null ? Number(row.parbake_sales_qty) : undefined,
          status,
          materials_data: normalizeMaterialsData(raw),
        };
      });
      set({ usageCalculations: list, usageCalculationsLoading: false });
    } catch (err) {
      set({
        usageCalculationsLoading: false,
        error: err instanceof Error ? err.message : "사용량 계산 목록을 불러오지 못했습니다.",
      });
    }
  },

  saveUsageCalculation: async (data: UsageCalculationRecord) => {
    set({ saving: "logs", error: null });
    const dateKey = data.production_date.slice(0, 10);
    try {
      const statusVal = data.status === "closed" ? "closed" : data.status === "stock_entered" ? "stock_entered" : "draft";
      const payload = {
        production_date: dateKey,
        product_name: data.product_name ?? "",
        author_name: data.author_name?.trim() || null,
        dough_usage_g: data.dough_usage_g != null && Number.isFinite(data.dough_usage_g) ? data.dough_usage_g : null,
        dough_usage_qty: data.dough_usage_qty != null && Number.isFinite(data.dough_usage_qty) ? data.dough_usage_qty : null,
        dough_waste_g: data.dough_waste_g != null && Number.isFinite(data.dough_waste_g) ? data.dough_waste_g : null,
        dough_waste_qty: data.dough_waste_qty != null && Number.isFinite(data.dough_waste_qty) ? data.dough_waste_qty : null,
        finished_qty_expected: data.finished_qty_expected != null && Number.isFinite(data.finished_qty_expected) ? data.finished_qty_expected : null,
        finished_qty_actual: data.finished_qty_actual != null && Number.isFinite(data.finished_qty_actual) ? data.finished_qty_actual : null,
        parbake_add_qty: data.parbake_add_qty != null && Number.isFinite(data.parbake_add_qty) ? data.parbake_add_qty : null,
        parbake_woozooin_qty: data.parbake_woozooin_qty != null && Number.isFinite(data.parbake_woozooin_qty) ? data.parbake_woozooin_qty : null,
        parbake_sales_qty: data.parbake_sales_qty != null && Number.isFinite(data.parbake_sales_qty) ? data.parbake_sales_qty : null,
        status: statusVal,
        materials_data: data.materials_data ?? {},
        updated_at: new Date().toISOString(),
      };
      const { data: upserted, error: e } = await supabase
        .from("usage_calculations")
        .upsert(payload, { onConflict: "production_date,product_name" })
        .select("id, production_date, product_name, author_name, dough_usage_g, dough_usage_qty, dough_waste_g, dough_waste_qty, finished_qty_expected, finished_qty_actual, parbake_add_qty, parbake_woozooin_qty, parbake_sales_qty, status, materials_data")
        .single();
      if (e) {
        console.error("Save Error (Supabase):", e.message, e.details, e.hint);
        throw e;
      }
      const sv = upserted.status as string | null;
      const mapped: UsageCalculationRecord = {
        id: upserted.id,
        production_date: String(upserted.production_date).slice(0, 10),
        product_name: upserted.product_name ?? "",
        author_name: upserted.author_name ?? undefined,
        dough_usage_g: upserted.dough_usage_g != null ? Number(upserted.dough_usage_g) : undefined,
        dough_usage_qty: upserted.dough_usage_qty != null ? Number(upserted.dough_usage_qty) : undefined,
        dough_waste_g: upserted.dough_waste_g != null ? Number(upserted.dough_waste_g) : undefined,
        dough_waste_qty: upserted.dough_waste_qty != null ? Number(upserted.dough_waste_qty) : undefined,
        finished_qty_expected: upserted.finished_qty_expected != null ? Number(upserted.finished_qty_expected) : undefined,
        finished_qty_actual: upserted.finished_qty_actual != null ? Number(upserted.finished_qty_actual) : undefined,
        parbake_add_qty: upserted.parbake_add_qty != null ? Number(upserted.parbake_add_qty) : undefined,
        parbake_woozooin_qty: upserted.parbake_woozooin_qty != null ? Number(upserted.parbake_woozooin_qty) : undefined,
        parbake_sales_qty: upserted.parbake_sales_qty != null ? Number(upserted.parbake_sales_qty) : undefined,
        status: sv === "stock_entered" || sv === "closed" ? sv : "draft",
        materials_data: normalizeMaterialsData((upserted.materials_data && typeof upserted.materials_data === "object" ? upserted.materials_data as Record<string, { prior_stock?: unknown[]; closing_stock?: unknown[] }> : {})),
      };
      set((state) => ({
        usageCalculations: state.usageCalculations.filter(
          (u) => !(u.production_date === dateKey && u.product_name === data.product_name)
        ).concat(mapped),
        saving: "",
      }));
    } catch (err) {
      console.error("Save Error:", err);
      set({
        saving: "",
        error: err instanceof Error ? err.message : "사용량 계산 저장에 실패했습니다.",
      });
      throw err;
    }
  },

  deleteUsageCalculation: async (id: string) => {
    set({ saving: "logs", error: null });
    try {
      const { error: e } = await supabase
        .from("usage_calculations")
        .delete()
        .eq("id", id);
      if (e) throw e;
      set((state) => ({
        usageCalculations: state.usageCalculations.filter((u) => u.id !== id),
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "사용량 계산 삭제에 실패했습니다.",
      });
      throw err;
    }
  },

  getUsageCalculation: (production_date: string, product_name: string) => {
    const dateKey = production_date.slice(0, 10);
    return get().usageCalculations.find(
      (u) => u.production_date === dateKey && u.product_name === product_name
    ) ?? null;
  },

  getLatestUsageCalculationBefore: (production_date: string, product_name: string) => {
    const dateKey = production_date.slice(0, 10);
    const list = get().usageCalculations.filter(
      (u) => u.product_name === product_name && u.production_date < dateKey
    );
    if (list.length === 0) return null;
    list.sort((a, b) => b.production_date.localeCompare(a.production_date));
    return list[0] ?? null;
  },

  getOutboundTotalsByDateProduct: (production_date: string, product_name: string) => {
    const dateKey = production_date.slice(0, 10);
    const logs = get().productionLogs.filter(
      (log) => log.생산일자 === dateKey && log.제품명 === product_name
    );
    const out: Record<string, number> = {};
    for (const log of logs) {
      const name = log.원료명 ?? "";
      if (name) out[name] = (out[name] ?? 0) + (log.출고_g ?? 0);
    }
    return out;
  },

  fetchProductionHistoryDateStates: async () => {
    set({ productionHistoryDateStatesLoading: true, error: null });
    try {
      const { data, error: e } = await supabase
        .from("production_history_date_state")
        .select("production_date, first_closed_at, second_closed_at, author_name, state_snapshot, updated_at, updated_by")
        .order("production_date", { ascending: false });
      if (e) throw e;
      const byDate: Record<string, ProductionHistoryDateStateRow> = {};
      for (const row of data ?? []) {
        const dateKey = String(row.production_date).slice(0, 10);
        byDate[dateKey] = {
          production_date: dateKey,
          first_closed_at: row.first_closed_at ?? null,
          second_closed_at: row.second_closed_at ?? null,
          author_name: row.author_name ?? null,
          state_snapshot: row.state_snapshot ?? {},
          updated_at: row.updated_at ?? new Date().toISOString(),
          updated_by: row.updated_by ?? null,
        };
      }
      set({ productionHistoryDateStates: byDate, productionHistoryDateStatesLoading: false });
    } catch (err) {
      set({
        productionHistoryDateStatesLoading: false,
        error: err instanceof Error ? err.message : "날짜별 마감 상태를 불러오지 못했습니다.",
      });
    }
  },

  saveProductionHistoryDateState: async (production_date, payload) => {
    const dateKey = production_date.slice(0, 10);
    set({ saving: "logs", error: null });
    try {
      const row: Record<string, unknown> = {
        production_date: dateKey,
        state_snapshot: payload.state_snapshot ?? {},
        updated_at: new Date().toISOString(),
      };
      if (payload.first_closed_at !== undefined) row.first_closed_at = payload.first_closed_at;
      if (payload.second_closed_at !== undefined) row.second_closed_at = payload.second_closed_at;
      if (payload.author_name !== undefined) row.author_name = payload.author_name;
      if (payload.updated_by !== undefined) row.updated_by = payload.updated_by;
      const { data: upserted, error: e } = await supabase
        .from("production_history_date_state")
        .upsert(row, { onConflict: "production_date" })
        .select("production_date, first_closed_at, second_closed_at, author_name, state_snapshot, updated_at, updated_by")
        .single();
      if (e) {
        console.error("Save production_history_date_state:", e.message, e.details, e.hint);
        throw e;
      }
      const r = upserted;
      const dateStr = String(r.production_date).slice(0, 10);
      set((state) => ({
        productionHistoryDateStates: {
          ...state.productionHistoryDateStates,
          [dateStr]: {
            production_date: dateStr,
            first_closed_at: r.first_closed_at ?? null,
            second_closed_at: r.second_closed_at ?? null,
            author_name: r.author_name ?? null,
            state_snapshot: r.state_snapshot ?? {},
            updated_at: r.updated_at ?? new Date().toISOString(),
            updated_by: r.updated_by ?? null,
          },
        },
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "마감 상태 저장에 실패했습니다.",
      });
      throw err;
    }
  },

  getProductionHistoryDateState: (production_date: string) => {
    const dateKey = production_date.slice(0, 10);
    return get().productionHistoryDateStates[dateKey] ?? null;
  },

  addMaterial: async (m) => {
    set({ saving: "materials", error: null });
    try {
      const { data, error: e } = await supabase
        .from("materials")
        .insert({
          material_name: m.materialName,
          box_weight_g: m.boxWeightG,
          unit_weight_g: m.unitWeightG,
          inventory_item_code: m.inventoryItemCode?.trim() || null,
        })
        .select("id, material_name, box_weight_g, unit_weight_g, inventory_item_code")
        .single();
      if (e) throw e;
      set((state) => ({
        materials: [...state.materials, mapMaterialFromDb(data)],
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "원료 등록에 실패했습니다.",
      });
      throw err;
    }
  },

  updateMaterial: async (id, patch) => {
    set({ saving: "materials", error: null });
    try {
      const payload: Record<string, unknown> = {};
      if (patch.materialName != null) payload.material_name = patch.materialName;
      if (patch.boxWeightG != null) payload.box_weight_g = patch.boxWeightG;
      if (patch.unitWeightG != null) payload.unit_weight_g = patch.unitWeightG;
      if (patch.inventoryItemCode != null) payload.inventory_item_code = patch.inventoryItemCode.trim() || null;
      const { error: e } = await supabase.from("materials").update(payload).eq("id", id);
      if (e) throw e;
      set((state) => ({
        materials: state.materials.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "원료 수정에 실패했습니다.",
      });
      throw err;
    }
  },

  deleteMaterial: async (id) => {
    set({ saving: "materials", error: null });
    try {
      const { error: e } = await supabase.from("materials").delete().eq("id", id);
      if (e) throw e;
      set((state) => ({ materials: state.materials.filter((x) => x.id !== id), saving: "" }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "원료 삭제에 실패했습니다.",
      });
      throw err;
    }
  },

  addBomRows: async (rows) => {
    set({ saving: "bom", error: null });
    try {
      const inserts = rows.map((r) => ({
        product_name: r.productName,
        material_name: r.materialName,
        bom_g_per_ea: r.bomGPerEa,
        basis: r.basis,
      }));
      const { data, error: e } = await supabase.from("bom").insert(inserts).select("id, product_name, material_name, bom_g_per_ea, basis");
      if (e) throw e;
      const newRows = (data ?? []).map(mapBomFromDb);
      set((state) => ({ bomList: [...state.bomList, ...newRows], saving: "" }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "BOM 등록에 실패했습니다.",
      });
      throw err;
    }
  },

  updateBomRow: async (id, patch) => {
    set({ saving: "bom", error: null });
    try {
      const payload: Record<string, unknown> = {};
      if (patch.productName != null) payload.product_name = patch.productName;
      if (patch.materialName != null) payload.material_name = patch.materialName;
      if (patch.bomGPerEa != null) payload.bom_g_per_ea = patch.bomGPerEa;
      if (patch.basis != null) payload.basis = patch.basis;
      const { error: e } = await supabase.from("bom").update(payload).eq("id", id);
      if (e) throw e;
      set((state) => ({
        bomList: state.bomList.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "BOM 수정에 실패했습니다.",
      });
      throw err;
    }
  },

  deleteBomRow: async (id) => {
    set({ saving: "bom", error: null });
    try {
      const { error: e } = await supabase.from("bom").delete().eq("id", id);
      if (e) throw e;
      set((state) => ({ bomList: state.bomList.filter((x) => x.id !== id), saving: "" }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "BOM 삭제에 실패했습니다.",
      });
      throw err;
    }
  },

  addProductionLog: async (log) => {
    set({ saving: "logs", error: null });
    const safeNum = (v: unknown, d: number) => {
      if (v === null || v === undefined) return d;
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };
    try {
      const rawLines = log.출고_라인 ?? [];
      const 출고_라인 = rawLines.map((r) => ({
        소비기한: r.소비기한 ?? "",
        박스: safeNum(r.박스, 0),
        낱개: safeNum(r.낱개, 0),
        g: safeNum(r.g, 0),
      }));
      const 출고_박스 = 출고_라인.reduce((s, r) => s + r.박스, 0);
      const 출고_낱개 = 출고_라인.reduce((s, r) => s + r.낱개, 0);
      const 출고_g = 출고_라인.reduce((s, r) => s + r.g, 0);
      const 소비기한 = log.소비기한 ?? addDays(log.생산일자, 364);

      const insertPayload = {
        production_date: log.생산일자,
        product_name: log.제품명 ?? "",
        material_name: log.원료명 ?? "",
        outbound_lines: 출고_라인,
        outbound_box: 출고_박스,
        outbound_bag: 출고_낱개,
        outbound_g: 출고_g,
        status: log.상태 ?? "출고됨",
        preparer_name: log.출고자 ?? null,
        preparer_name_2: log.작성자2 ?? null,
        approver_name: String(log.승인자 ?? ""),
        expiry_date: 소비기한,
        dough_qty: log.반죽량 != null ? safeNum(log.반죽량, 0) : null,
        dough_waste_qty: log.반죽폐기량 != null ? safeNum(log.반죽폐기량, 0) : null,
        finished_qty_expected: log.완제품예상수량 != null ? safeNum(log.완제품예상수량, 0) : null,
        operator_name: log.작업자 ?? null,
      };

      const { data, error: e } = await supabase
        .from("production_logs")
        .insert(insertPayload)
        .select("id, production_date, product_name, material_name, outbound_lines, outbound_box, outbound_bag, outbound_g, actual_usage_g, status, preparer_name, preparer_name_2, approver_name, expiry_date, dough_qty, dough_waste_qty, operator_name, finished_qty_expected")
        .single();
      if (e) throw e;
      set((state) => ({
        productionLogs: [mapProductionLogFromDb(data), ...state.productionLogs],
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error: getErrorMessage(err) || "출고 저장에 실패했습니다.",
      });
      throw err;
    }
  },

  closeProductionLog: async (id, patch) => {
    set({ saving: "logs", error: null });
    const safeNum = (v: unknown, fallback: number): number => {
      if (v === null || v === undefined) return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    try {
      const updatePayload: Record<string, unknown> = {
        actual_usage_g: safeNum(patch.실사용량_g, 0),
        primary_usage_g: safeNum(patch.실사용량_g, 0),
        status: patch.상태,
      };
      if (patch.작업자 != null) updatePayload.operator_name = patch.작업자;
      if (patch.작성자2 != null) updatePayload.preparer_name_2 = patch.작성자2;
      if (patch.반죽량 != null && Number.isFinite(Number(patch.반죽량))) updatePayload.dough_qty = Number(patch.반죽량);
      if (patch.반죽폐기량 != null && Number.isFinite(Number(patch.반죽폐기량))) updatePayload.dough_waste_qty = Number(patch.반죽폐기량);
      if (patch.전일재고_g != null && Number.isFinite(Number(patch.전일재고_g))) updatePayload.prior_stock_g = Number(patch.전일재고_g);
      if (patch.당일잔량_g != null && Number.isFinite(Number(patch.당일잔량_g))) updatePayload.closing_remainder_g = Number(patch.당일잔량_g);
      if (Array.isArray(patch.출고_라인) && patch.출고_라인.length > 0) updatePayload.outbound_lines = patch.출고_라인;
      const { error: e } = await supabase
        .from("production_logs")
        .update(updatePayload)
        .eq("id", id);
      if (e) throw e;
      set((state) => ({
        productionLogs: state.productionLogs.map((x) =>
          x.id === id
            ? {
                ...x,
                일차사용량_g: patch.실사용량_g,
                실사용량_g: patch.실사용량_g,
                상태: patch.상태,
                작업자: patch.작업자,
                작성자2: patch.작성자2 ?? x.작성자2,
                반죽량: patch.반죽량 ?? x.반죽량,
                반죽폐기량: patch.반죽폐기량 ?? x.반죽폐기량,
                전일재고_g: patch.전일재고_g ?? x.전일재고_g,
                당일잔량_g: patch.당일잔량_g ?? x.당일잔량_g,
                출고_라인: patch.출고_라인 ?? x.출고_라인,
              }
            : x
        ),
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error: getErrorMessage(err) || "마감 저장에 실패했습니다.",
      });
      throw err;
    }
  },

  appendOutboundLine: async (logId, newLine) => {
    set({ saving: "logs", error: null });
    const safeNum = (v: unknown, d: number) => {
      if (v === null || v === undefined) return d;
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };
    const normalized = {
      소비기한: String(newLine.소비기한 ?? "").trim(),
      박스: safeNum(newLine.박스, 0),
      낱개: safeNum(newLine.낱개, 0),
      g: safeNum(newLine.g, 0),
    };
    try {
      const log = get().productionLogs.find((x) => x.id === logId);
      if (!log) throw new Error("해당 출고 기록을 찾을 수 없습니다.");
      const current: OutboundLine[] =
        Array.isArray(log.출고_라인) && log.출고_라인.length > 0
          ? log.출고_라인
          : [{ 소비기한: "", 박스: log.출고_박스 ?? 0, 낱개: log.출고_낱개 ?? 0, g: log.출고_g ?? 0 }];
      const nextLines = [...current, normalized];
      const 출고_박스 = nextLines.reduce((s, r) => s + r.박스, 0);
      const 출고_낱개 = nextLines.reduce((s, r) => s + r.낱개, 0);
      const 출고_g = nextLines.reduce((s, r) => s + r.g, 0);
      const { error: e } = await supabase
        .from("production_logs")
        .update({
          outbound_lines: nextLines,
          outbound_box: 출고_박스,
          outbound_bag: 출고_낱개,
          outbound_g: 출고_g,
        })
        .eq("id", logId);
      if (e) throw e;
      set((state) => ({
        productionLogs: state.productionLogs.map((x) =>
          x.id === logId
            ? {
                ...x,
                출고_라인: nextLines,
                출고_박스,
                출고_낱개,
                출고_g,
              }
            : x
        ),
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error: getErrorMessage(err) || "전일 재고 라인 추가에 실패했습니다.",
      });
      throw err;
    }
  },

  updateProductionRunMeta: async (생산일자, 제품명, patch) => {
    set({ saving: "logs", error: null });
    try {
      const ids = get().productionLogs
        .filter((l) => l.생산일자 === 생산일자 && l.제품명 === 제품명)
        .map((l) => l.id);
      if (ids.length === 0) return;
      const updatePayload: Record<string, unknown> = {};
      if (patch.작성자2 != null) updatePayload.preparer_name_2 = patch.작성자2;
      if (patch.반죽량 != null) updatePayload.dough_qty = patch.반죽량;
      if (patch.반죽폐기량 != null) updatePayload.dough_waste_qty = patch.반죽폐기량;
      if (Object.keys(updatePayload).length === 0) {
        set({ saving: "" });
        return;
      }
      const { error: e } = await supabase
        .from("production_logs")
        .update(updatePayload)
        .in("id", ids);
      if (e) throw e;
      set((state) => ({
        productionLogs: state.productionLogs.map((x) =>
          x.생산일자 === 생산일자 && x.제품명 === 제품명
            ? {
                ...x,
                작성자2: patch.작성자2 ?? x.작성자2,
                반죽량: patch.반죽량 ?? x.반죽량,
                반죽폐기량: patch.반죽폐기량 ?? x.반죽폐기량,
              }
            : x
        ),
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "생산 run 메타 저장에 실패했습니다.",
      });
      throw err;
    }
  },

  settleProductionRun: async (생산일자, 제품명, payload) => {
    set({ saving: "logs", error: null });
    const state = get();
    const logs = state.productionLogs.filter(
      (l) => l.생산일자 === 생산일자 && l.제품명 === 제품명
    );
    const bomList = state.bomList;
    if (logs.length === 0) return;

    const 파베이크사용총량 =
      payload.파베이크사용_라인?.reduce((s, l) => s + l.qty, 0) ?? 0;
    const first = logs[0];
    const 반죽량 = first.반죽량 ?? 0;
    const 반죽폐기량 = first.반죽폐기량 ?? 0;
    const 완제품생산량 = payload.완제품생산량 ?? 0;
    const 보관용 = payload.보관용파베이크 ?? 0;
    const 판매용 = payload.판매용파베이크 ?? 0;

    const 파베이크폐기량 = Math.max(
      0,
      반죽량 + 파베이크사용총량 - (반죽폐기량 + 완제품생산량 + 보관용 + 판매용)
    );

    const isDough = (log: ProductionLog) =>
      bomList.some(
        (b) =>
          b.productName === log.제품명 &&
          b.materialName === log.원료명 &&
          b.basis === "도우"
      );
    const getDoughBomG = (log: ProductionLog) => {
      const row = bomList.find(
        (b) =>
          b.productName === log.제품명 &&
          b.materialName === log.원료명 &&
          b.basis === "도우"
      );
      return row?.bomGPerEa ?? 0;
    };

    try {
      const runPayload: Record<string, unknown> = {
        finished_product_qty: 완제품생산량,
        parbake_used_lines: payload.파베이크사용_라인?.length
          ? payload.파베이크사용_라인
          : null,
        parbake_storage_qty: 보관용,
        parbake_sales_qty: 판매용,
      };
      const { error: eRun } = await supabase
        .from("production_logs")
        .update(runPayload)
        .eq("production_date", 생산일자)
        .eq("product_name", 제품명);
      if (eRun) throw eRun;

      for (const log of logs) {
        if (!isDough(log)) continue;
        const 도우당소스g = getDoughBomG(log);
        const 소스폐기량_g = Math.round(파베이크폐기량 * 도우당소스g);
        const 일차 = log.일차사용량_g ?? log.실사용량_g ?? 0;
        const 최종사용량_g = Math.max(0, 일차 - 소스폐기량_g);
        const 소스폐기량_소비기한 =
          log.출고_라인?.[0]?.소비기한 ??
          payload.파베이크사용_라인?.[0]?.expiry ??
          null;

        const { error: eLog } = await supabase
          .from("production_logs")
          .update({
            source_waste_g: 소스폐기량_g,
            source_waste_expiry: 소스폐기량_소비기한,
            actual_usage_g: 최종사용량_g,
          })
          .eq("id", log.id);
        if (eLog) throw eLog;
      }

      set((prev) => ({
        productionLogs: prev.productionLogs.map((x) => {
          if (x.생산일자 !== 생산일자 || x.제품명 !== 제품명)
            return x;
          const updated = {
            ...x,
            완제품생산량,
            파베이크사용_라인: payload.파베이크사용_라인,
            보관용파베이크: 보관용,
            판매용파베이크: 판매용,
          };
          if (isDough(x)) {
            const 소스폐기량_g = Math.round(
              파베이크폐기량 * getDoughBomG(x)
            );
            const 일차 = x.일차사용량_g ?? x.실사용량_g ?? 0;
            updated.소스폐기량_g = 소스폐기량_g;
            updated.소스폐기량_소비기한 =
              x.출고_라인?.[0]?.소비기한 ??
              payload.파베이크사용_라인?.[0]?.expiry;
            updated.실사용량_g = Math.max(0, 일차 - 소스폐기량_g);
          }
          return updated;
        }),
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error:
          err instanceof Error ? err.message : "2차 최종 정산 저장에 실패했습니다.",
      });
      throw err;
    }
  },

  setLastUsedDate: async (materialName, date) => {
    try {
      await supabase.from("last_used_dates").upsert(
        { material_name: materialName, last_expiry_date: date, updated_at: new Date().toISOString() },
        { onConflict: "material_name" }
      );
      set((state) => ({
        lastUsedDates: { ...state.lastUsedDates, [materialName]: date },
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "소비기한 저장에 실패했습니다.",
      });
    }
  },

  deleteProductionLogsByGroup: async (생산일자, 제품명) => {
    set({ saving: "logs", error: null });
    try {
      const [usageResult, logsResult] = await Promise.all([
        supabase
          .from("usage_calculations")
          .delete()
          .eq("production_date", 생산일자)
          .eq("product_name", 제품명),
        supabase
          .from("production_logs")
          .delete()
          .eq("production_date", 생산일자)
          .eq("product_name", 제품명),
      ]);
      if (usageResult.error) throw usageResult.error;
      if (logsResult.error) throw logsResult.error;
      set((state) => ({
        productionLogs: state.productionLogs.filter(
          (log) => !(log.생산일자 === 생산일자 && log.제품명 === 제품명)
        ),
        usageCalculations: state.usageCalculations.filter(
          (u) => !(u.production_date === 생산일자 && u.product_name === 제품명)
        ),
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "기록 삭제에 실패했습니다.",
      });
      throw err;
    }
  },

  updateOutboundQuantityByGroup: async (생산일자, 제품명, totalG) => {
    set({ saving: "logs", error: null });
    const safeG = Math.max(0, Math.round(Number(totalG)) || 0);
    const newLine: OutboundLine[] = [{ 소비기한: "", 박스: 0, 낱개: 0, g: safeG }];
    try {
      const ids = get().productionLogs
        .filter((l) => l.생산일자 === 생산일자 && l.제품명 === 제품명)
        .map((l) => l.id);
      if (ids.length === 0) return;
      const { error: e } = await supabase
        .from("production_logs")
        .update({
          outbound_lines: newLine,
          outbound_box: 0,
          outbound_bag: 0,
          outbound_g: safeG,
        })
        .in("id", ids);
      if (e) throw e;
      set((state) => ({
        productionLogs: state.productionLogs.map((x) =>
          x.생산일자 === 생산일자 && x.제품명 === 제품명
            ? {
                ...x,
                출고_라인: newLine,
                출고_박스: 0,
                출고_낱개: 0,
                출고_g: safeG,
              }
            : x
        ),
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "출고 수량 변경에 실패했습니다.",
      });
      throw err;
    }
  },

  updateProductionLogOutbound: async (logId, payload) => {
    set({ saving: "logs", error: null });
    const { lineIndex, 박스: raw박스, 낱개: raw낱개, g: rawG } = payload;
    const 박스 = Math.max(0, Math.round(Number(raw박스)) || 0);
    const 낱개 = Math.max(0, Math.round(Number(raw낱개)) || 0);
    const g = Math.max(0, Math.round(Number(rawG)) || 0);
    try {
      const state = get();
      const log = state.productionLogs.find((x) => x.id === logId);
      if (!log) throw new Error("해당 출고 기록을 찾을 수 없습니다.");
      const current: OutboundLine[] =
        Array.isArray(log.출고_라인) && log.출고_라인.length > 0
          ? log.출고_라인
          : [{ 소비기한: "", 박스: log.출고_박스 ?? 0, 낱개: log.출고_낱개 ?? 0, g: log.출고_g ?? 0 }];
      if (lineIndex < 0 || lineIndex >= current.length) throw new Error("유효하지 않은 라인 인덱스입니다.");
      const existing = current[lineIndex]!;
      const nextLines = current.map((line, i) =>
        i === lineIndex ? { ...line, 소비기한: existing.소비기한 ?? "", 박스, 낱개, g } : line
      );
      const 출고_박스 = nextLines.reduce((s, r) => s + r.박스, 0);
      const 출고_낱개 = nextLines.reduce((s, r) => s + r.낱개, 0);
      const 출고_g = nextLines.reduce((s, r) => s + r.g, 0);
      const { error: e } = await supabase
        .from("production_logs")
        .update({
          outbound_lines: nextLines,
          outbound_box: 출고_박스,
          outbound_bag: 출고_낱개,
          outbound_g: 출고_g,
        })
        .eq("id", logId);
      if (e) throw e;
      set((s) => ({
        productionLogs: s.productionLogs.map((x) =>
          x.id === logId ? { ...x, 출고_라인: nextLines, 출고_박스: 출고_박스, 출고_낱개: 출고_낱개, 출고_g: 출고_g } : x
        ),
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "출고 수량 변경에 실패했습니다.",
      });
      throw err;
    }
  },

  deleteProductionLogOutboundLine: async (logId, lineIndex) => {
    set({ saving: "logs", error: null });
    try {
      const state = get();
      const log = state.productionLogs.find((x) => x.id === logId);
      if (!log) throw new Error("해당 출고 기록을 찾을 수 없습니다.");
      const current: OutboundLine[] =
        Array.isArray(log.출고_라인) && log.출고_라인.length > 0
          ? log.출고_라인
          : [{ 소비기한: "", 박스: log.출고_박스 ?? 0, 낱개: log.출고_낱개 ?? 0, g: log.출고_g ?? 0 }];
      const nextLines = current.filter((_, i) => i !== lineIndex);
      if (nextLines.length === 0) {
        const { error: e } = await supabase.from("production_logs").delete().eq("id", logId);
        if (e) throw e;
        set((s) => ({ productionLogs: s.productionLogs.filter((x) => x.id !== logId), saving: "" }));
      } else {
        const 출고_박스 = nextLines.reduce((s, r) => s + r.박스, 0);
        const 출고_낱개 = nextLines.reduce((s, r) => s + r.낱개, 0);
        const 출고_g = nextLines.reduce((s, r) => s + r.g, 0);
        const { error: e } = await supabase
          .from("production_logs")
          .update({
            outbound_lines: nextLines,
            outbound_box: 출고_박스,
            outbound_bag: 출고_낱개,
            outbound_g: 출고_g,
          })
          .eq("id", logId);
        if (e) throw e;
        set((s) => ({
          productionLogs: s.productionLogs.map((x) =>
            x.id === logId ? { ...x, 출고_라인: nextLines, 출고_박스: 출고_박스, 출고_낱개: 출고_낱개, 출고_g: 출고_g } : x
          ),
          saving: "",
        }));
      }
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "해당 LOT 삭제에 실패했습니다.",
      });
      throw err;
    }
  },

  deleteProductionLog: async (logId) => {
    set({ saving: "logs", error: null });
    try {
      const { error: e } = await supabase.from("production_logs").delete().eq("id", logId);
      if (e) throw e;
      set((state) => ({
        productionLogs: state.productionLogs.filter((x) => x.id !== logId),
        saving: "",
      }));
    } catch (err) {
      set({
        saving: "",
        error: err instanceof Error ? err.message : "해당 출고 기록 삭제에 실패했습니다.",
      });
      throw err;
    }
  },
}));
