"use client";

import { Suspense, useMemo, useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMasterStore, type ProductionLog, type OutboundLine } from "@/store/useMasterStore";
import { calculateUsageSummary, getDateParbakeTypes, type ComputedResult } from "@/features/production/history/calculations";
import { parseProductLabel } from "@/features/production/history/productLabel";
import { getBomRowsForProductAndStandard } from "@/features/production/history/bomAdapter";
import type { BomRowRef } from "@/features/production/history/types";
import DateWheelPicker from "@/components/DateWheelPicker";
import { getAppRecentValue, setAppRecentValue } from "@/lib/appRecentValues";
import { createSafeId } from "@/lib/createSafeId";
import { useAuth } from "@/contexts/AuthContext";

const HISTORY_GROUP_STATE_KEY = "production-history:group-state";
/** 1차 마감 전용 최근 작성자명 (출고 입력과 분리). Supabase 우선, localStorage는 보조 fallback */
const FIRST_CLOSE_LAST_AUTHOR_KEY = "first-close-last-author-name";
const FIRST_CLOSE_LAST_AUTHOR_STORAGE_KEY = "production:first-close-last-author-name";

function getLastAuthorNameFromStorage(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(FIRST_CLOSE_LAST_AUTHOR_STORAGE_KEY) ?? "";
}

function setLastAuthorNameToStorage(name: string): void {
  const trimmed = (name ?? "").trim();
  if (!trimmed || typeof window === "undefined") return;
  localStorage.setItem(FIRST_CLOSE_LAST_AUTHOR_STORAGE_KEY, trimmed);
}

/** sessionStorage에서 읽은 예전 상태: prevDayStockQty/currentDayStockQty → 낱개+잔량g 구조로 마이그레이션 */
function migrateLotRow(row: Record<string, unknown>): LotRow {
  const hasOld = "prevDayStockQty" in row || "currentDayStockQty" in row;
  const base = {
    lotRowId: String(row.lotRowId ?? ""),
    sourceType: (row.sourceType as "from-log" | "manual") ?? "manual",
    expiryDate: String(row.expiryDate ?? ""),
    outboundQty: Number(row.outboundQty) || 0,
    prevDayUnitCount: (row.prevDayUnitCount as number | "") ?? "",
    prevDayRemainderG: (row.prevDayRemainderG as number | "") ?? "",
    currentDayUnitCount: (row.currentDayUnitCount as number | "") ?? "",
    currentDayRemainderG: (row.currentDayRemainderG as number | "") ?? "",
    sourceRowIds: row.sourceRowIds as string[] | undefined,
    prevLoadedFromDate: typeof row.prevLoadedFromDate === "string" ? row.prevLoadedFromDate : undefined,
  };
  if (hasOld) {
    base.prevDayRemainderG = (row.prevDayStockQty as number | "") ?? "";
    base.currentDayRemainderG = (row.currentDayStockQty as number | "") ?? "";
  }
  return base;
}

function migrateDateGroupState(parsed: Record<string, unknown>): Record<string, DateGroupState> {
  const out: Record<string, DateGroupState> = {};
  const lastAuthor = getLastAuthorNameFromStorage();
  for (const [date, raw] of Object.entries(parsed)) {
    const s = raw as Record<string, unknown>;
    const materials = Array.isArray(s.materials)
      ? (s.materials as Record<string, unknown>[]).map((card) => ({
          materialCardId: String(card.materialCardId ?? ""),
          materialName: String(card.materialName ?? ""),
          lots: Array.isArray(card.lots)
            ? (card.lots as Record<string, unknown>[]).map(migrateLotRow)
            : [],
        }))
      : [];
    out[date] = {
      id: String(s.id ?? date),
      date: String(s.date ?? date),
      status: (s.status as "작업대기" | "1차마감완료" | "2차마감완료") ?? "작업대기",
      isFirstClosed: Boolean(s.isFirstClosed),
      isSecondClosed: Boolean(s.isSecondClosed),
      authorName: (s.authorName as string)?.trim() ? String(s.authorName).trim() : lastAuthor,
      doughMixQty: (s.doughMixQty as number | "") ?? "",
      doughWasteQty: (s.doughWasteQty as number | "") ?? "",
      materials,
      products: (s.products as DateGroupState["products"]) ?? [],
      secondClosure: (s.secondClosure as DateGroupState["secondClosure"]) ?? {
        productOutputs: [],
        astronautParbakeQty: "",
        saleParbakeQty: "",
        extraParbakes: [],
      },
    };
  }
  return out;
}

/** 캐시된 단일 날짜 상태도 낱개+잔량g 구조로 마이그레이션(및 빈 작성자명 시 최근값). defaultAuthor 없으면 localStorage 사용 */
function migrateSingleState(cached: DateGroupState, defaultAuthor?: string): DateGroupState {
  const materials = cached.materials.map((card) => ({
    ...card,
    lots: card.lots.map((row) => {
      const r = row as unknown as Record<string, unknown>;
      if ("prevDayStockQty" in r || "currentDayStockQty" in r) {
        return migrateLotRow(r);
      }
      return row as LotRow;
    }),
  }));
  const fallback = defaultAuthor ?? getLastAuthorNameFromStorage();
  const authorName = cached.authorName?.trim() ? cached.authorName : fallback;
  return { ...cached, materials, authorName };
}

type MissingStockFieldKey =
  | "prevDayUnitCount"
  | "prevDayRemainderG"
  | "currentDayUnitCount"
  | "currentDayRemainderG";

function collectMissingStockFieldKeys(row: LotRow, isGOnly: boolean): MissingStockFieldKey[] {
  const keys: MissingStockFieldKey[] = [];
  if (!isGOnly) {
    if (row.prevDayUnitCount === "") keys.push("prevDayUnitCount");
    if (row.currentDayUnitCount === "") keys.push("currentDayUnitCount");
  }
  if (row.prevDayRemainderG === "") keys.push("prevDayRemainderG");
  if (row.currentDayRemainderG === "") keys.push("currentDayRemainderG");
  return keys;
}

/** LOT 1행 기준 미완성 여부. 집계는 LOT당 최대 1건 (g전용은 잔량 2칸만 검사). */
function isLotStockIncomplete(row: LotRow, isGOnly: boolean): boolean {
  return collectMissingStockFieldKeys(row, isGOnly).length > 0;
}

/** 필수 재고 칸이 전부 빈 값인 LOT (배지·건수용). 하나라도 숫자 입력 시 false. */
function isLotStockFullyEmpty(row: LotRow, isGOnly: boolean): boolean {
  if (!isGOnly) {
    if (row.prevDayUnitCount !== "") return false;
    if (row.currentDayUnitCount !== "") return false;
  }
  if (row.prevDayRemainderG !== "") return false;
  if (row.currentDayRemainderG !== "") return false;
  return true;
}

/** 전부 빈 LOT 줄 개수 (섹션 배지용) */
function countFullyEmptyLotsInDate(state: DateGroupState, materialsList: MaterialLike[]): number {
  let total = 0;
  for (const card of state.materials) {
    const mat = materialsList.find((m) => m.materialName === card.materialName);
    const isGOnly = mat ? mat.boxWeightG === 0 && mat.unitWeightG === 0 : false;
    for (const row of card.lots) {
      if (isLotStockFullyEmpty(row, isGOnly)) total += 1;
    }
  }
  return total;
}

/** 이전 날짜 중 같은 원료명+같은 소비기한(LOT)인 당일재고를 찾아 전날재고용 값 반환. 가장 최근 날짜 1건만. */
function findPreviousDayStock(
  groupStateByDate: Record<string, DateGroupState>,
  currentDate: string,
  materialName: string,
  expiryDate: string
): { prevUnitCount: number | ""; prevRemainderG: number | ""; fromDate: string } | null {
  const prevDates = Object.keys(groupStateByDate)
    .filter((d) => d < currentDate)
    .sort((a, b) => b.localeCompare(a));
  const expiryNorm = (expiryDate ?? "").trim();
  const matNorm = (materialName ?? "").trim();
  for (const date of prevDates) {
    const state = groupStateByDate[date];
    if (!state?.materials?.length) continue;
    for (const card of state.materials) {
      if ((card.materialName ?? "").trim() !== matNorm) continue;
      const lot = card.lots.find((row) => (row.expiryDate ?? "").trim() === expiryNorm);
      if (!lot) continue;
      return {
        prevUnitCount: lot.currentDayUnitCount ?? "",
        prevRemainderG: lot.currentDayRemainderG ?? "",
        fromDate: date,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Types (id-based, Step 2/3 확장 대비)
// ---------------------------------------------------------------------------

export type LotRow = {
  lotRowId: string;
  sourceType: "from-log" | "manual";
  expiryDate: string;
  outboundQty: number;
  /** 전날재고 낱개 수량 */
  prevDayUnitCount: number | "";
  /** 전날재고 잔량(g) */
  prevDayRemainderG: number | "";
  /** 당일재고 낱개 수량 */
  currentDayUnitCount: number | "";
  /** 당일재고 잔량(g) */
  currentDayRemainderG: number | "";
  /** 합산된 LOT인 경우 원본 추적용 (선택) */
  sourceRowIds?: string[];
  /** 전날재고 불러오기로 채운 날짜 (확인용 표시) */
  prevLoadedFromDate?: string;
};

export type MaterialCard = {
  materialCardId: string;
  materialName: string;
  lots: LotRow[];
};

// Step 2: 제품 목록 (헤더와 동일 소스)
export type ProductItem = {
  productKey: string;
  /** 화면 표시용: 출고현황에 저장된 "제품명 - 기준" 그대로 */
  displayProductLabel: string;
  /** 계산/BOM용: 순수 제품명 */
  baseProductName: string;
  /** 계산/BOM용: 제품 기준 */
  productStandardName: string;
  /** 하위 호환: baseProductName */
  productName: string;
  /** 하위 호환: productStandardName */
  standardName: string;
};

export type ProductOutput = {
  productOutputId: string;
  productKey: string;
  productName: string;
  standardName: string;
  displayProductLabel?: string;
  baseProductName?: string;
  productStandardName?: string;
  finishedQty: number | "";
};

export type ExtraParbakeRow = {
  extraParbakeId: string;
  qty: number | "";
  expiryDate: string;
};

/** 혼합 베이스 날: 파베이크 종류별 폐기량(개). 자동 분배 없이 사용자 입력만 사용 */
export type ParbakeWasteByTypeRow = {
  parbakeName: string;
  wasteQty: number | "";
};

export type SecondClosure = {
  productOutputs: ProductOutput[];
  astronautParbakeQty: number | "";
  saleParbakeQty: number | "";
  extraParbakes: ExtraParbakeRow[];
  /** 베이스 2종 이상인 날만 사용. 타입별 파베이크 폐기량(개) */
  parbakeWasteByType?: ParbakeWasteByTypeRow[];
};

export type DateGroupState = {
  id: string;
  date: string;
  status: "작업대기" | "1차마감완료" | "2차마감완료";
  isFirstClosed: boolean;
  isSecondClosed: boolean;
  /** 작성자명(출고입력자/마감입력자) */
  authorName: string;
  doughMixQty: number | "";
  doughWasteQty: number | "";
  materials: MaterialCard[];
  products: ProductItem[];
  secondClosure: SecondClosure;
};

function generateId(): string {
  return createSafeId();
}

// ---------------------------------------------------------------------------
// Helpers: productionLogs → date groups, product list, initial materials
// ---------------------------------------------------------------------------

type MaterialLike = { materialName: string; boxWeightG: number; unitWeightG: number };

function totalGFromQty(
  box: number,
  nack: number,
  g: number,
  material: MaterialLike | undefined
): number {
  if (!material) return g;
  if (material.boxWeightG === 0 && material.unitWeightG === 0) return g;
  const unitG = material.unitWeightG > 0 ? material.unitWeightG : material.boxWeightG;
  return box * material.boxWeightG + nack * unitG + g;
}

function getLines(log: ProductionLog): OutboundLine[] {
  if (Array.isArray(log.출고_라인) && log.출고_라인.length > 0) {
    return log.출고_라인;
  }
  return [
    {
      소비기한: log.소비기한 ?? "",
      박스: log.출고_박스 ?? 0,
      낱개: log.출고_낱개 ?? 0,
      g: log.출고_g ?? 0,
    },
  ];
}

/** 날짜별 그룹: 날짜 + 해당 날짜 로그 목록 */
function groupLogsByDate(logs: ProductionLog[]): { date: string; logs: ProductionLog[] }[] {
  const byDate = new Map<string, ProductionLog[]>();
  for (const log of logs) {
    const d = (log.생산일자 ?? "").slice(0, 10);
    if (!d) continue;
    const list = byDate.get(d) ?? [];
    list.push(log);
    byDate.set(d, list);
  }
  return Array.from(byDate.entries())
    .map(([date, list]) => ({ date, logs: list }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** 해당 날짜의 제품 표시명 목록 (중복 제거, 출고현황 저장값 그대로) */
function getProductNamesForHeader(logs: ProductionLog[]): string[] {
  const set = new Set<string>();
  for (const log of logs) {
    const name = (log.제품명 ?? "").trim();
    if (name) set.add(name);
  }
  return Array.from(set);
}

/** 해당 날짜의 제품 목록 (헤더와 동일 순서, displayProductLabel = 출고현황 제품명 그대로) */
function getProductsFromLogs(logs: ProductionLog[]): ProductItem[] {
  const seen = new Set<string>();
  const list: ProductItem[] = [];
  for (const log of logs) {
    const displayProductLabel = (log.제품명 ?? "").trim();
    if (!displayProductLabel) continue;
    if (seen.has(displayProductLabel)) continue;
    seen.add(displayProductLabel);
    const { baseProductName, productStandardName } = parseProductLabel(displayProductLabel);
    list.push({
      productKey: displayProductLabel,
      displayProductLabel,
      baseProductName,
      productStandardName,
      productName: baseProductName,
      standardName: productStandardName,
    });
  }
  return list;
}

/** 해당 날짜 로그에서 원료별 카드 + LOT 행 초기값 생성. 같은 원료명+같은 소비기한(expiryDate)은 출고량 합산하여 한 줄로. */
function buildInitialMaterials(
  date: string,
  logs: ProductionLog[],
  materials: MaterialLike[]
): MaterialCard[] {
  // 1) 원료별로 (materialName, expiryDate) 키로 그룹핑하여 출고량 합산
  const byMaterialAndExpiry = new Map<string, { outboundQty: number; prevG: number | ""; currentG: number | ""; sourceRowIds: string[] }>();
  for (const log of logs) {
    const materialName = (log.원료명 ?? "").trim();
    if (!materialName) continue;
    const mat = materials.find((m) => m.materialName === materialName);
    const lines = getLines(log);
    for (const line of lines) {
      const outboundG = totalGFromQty(
        line.박스 ?? 0,
        line.낱개 ?? 0,
        line.g ?? 0,
        mat
      );
      const expiryDate = (line.소비기한 ?? "").trim();
      const key = `${materialName}\t${expiryDate}`;
      const prevVal = line.prior_stock_g;
      const prevG =
        prevVal != null && Number.isFinite(Number(prevVal)) ? Number(prevVal) : "";
      const currVal = line.closing_remainder_g;
      const currentG =
        currVal != null && Number.isFinite(Number(currVal)) ? Number(currVal) : "";
      const existing = byMaterialAndExpiry.get(key);
      const rowId = generateId();
      if (existing) {
        existing.outboundQty += outboundG;
        existing.sourceRowIds.push(rowId);
        if (existing.prevG === "" && prevG !== "") existing.prevG = prevG;
        if (existing.currentG === "" && currentG !== "") existing.currentG = currentG;
      } else {
        byMaterialAndExpiry.set(key, {
          outboundQty: outboundG,
          prevG,
          currentG,
          sourceRowIds: [rowId],
        });
      }
    }
  }
  // 2) 원료별로 카드 묶고, (materialName, expiryDate)당 LotRow 1개. DB에는 g만 있으므로 잔량(g)에 넣고 낱개는 빈칸
  const byMaterial = new Map<string, LotRow[]>();
  for (const [key, agg] of Array.from(byMaterialAndExpiry.entries())) {
    const [materialName, expiryDate] = key.split("\t");
    const row: LotRow = {
      lotRowId: generateId(),
      sourceType: "from-log",
      expiryDate: expiryDate ?? "",
      outboundQty: agg.outboundQty,
      prevDayUnitCount: "",
      prevDayRemainderG: agg.prevG,
      currentDayUnitCount: "",
      currentDayRemainderG: agg.currentG,
      sourceRowIds: agg.sourceRowIds,
    };
    const list = byMaterial.get(materialName) ?? [];
    list.push(row);
    byMaterial.set(materialName, list);
  }
  return Array.from(byMaterial.entries()).map(([materialName, lots]) => ({
    materialCardId: generateId(),
    materialName,
    lots,
  }));
}

/**
 * 마감 스냅샷의 LOT별 출고량을 출고 현황(production_logs) 최신값과 맞춘다.
 * 출고만 수정하고 1·2차 마감을 다시 저장하지 않은 경우에도 사용량·생산일지가 출고와 일치하도록 한다.
 * — 수동 추가 LOT(sourceType === "manual")의 출고량은 건드리지 않는다.
 */
/** DB 출고(production_logs) 기준으로 마감 스냅샷의 LOT별 출고량을 갱신한다. */
function mergeOutboundFromLogsForDate(
  date: string,
  materials: MaterialCard[],
  logs: ProductionLog[],
  materialsList: MaterialLike[]
): MaterialCard[] {
  const fresh = buildInitialMaterials(date, logs, materialsList);
  if (materials.length === 0) return fresh;

  const outboundByKey = new Map<string, number>();
  for (const c of fresh) {
    const mn = (c.materialName ?? "").trim();
    for (const lot of c.lots) {
      const exp = (lot.expiryDate ?? "").trim();
      outboundByKey.set(`${mn}\t${exp}`, lot.outboundQty);
    }
  }

  const materialByName = new Map<string, MaterialCard>();
  for (const c of materials) {
    const mn = (c.materialName ?? "").trim();
    materialByName.set(mn, {
      ...c,
      lots: c.lots.map((l) => ({ ...l })),
    });
  }

  for (const mn of Array.from(materialByName.keys())) {
    const card = materialByName.get(mn)!;
    const newLots = card.lots.map((lot) => {
      if (lot.sourceType === "manual") return lot;
      const exp = (lot.expiryDate ?? "").trim();
      const key = `${mn}\t${exp}`;
      const ob = outboundByKey.get(key);
      if (ob === undefined) return { ...lot, outboundQty: 0 };
      return { ...lot, outboundQty: ob };
    });
    materialByName.set(mn, { ...card, lots: newLots });
  }

  const existingKeys = new Set<string>();
  for (const c of materials) {
    const mn = (c.materialName ?? "").trim();
    for (const lot of c.lots) {
      existingKeys.add(`${mn}\t${(lot.expiryDate ?? "").trim()}`);
    }
  }

  for (const fc of fresh) {
    const mn = (fc.materialName ?? "").trim();
    let card = materialByName.get(mn);
    if (!card) {
      card = {
        materialCardId: generateId(),
        materialName: fc.materialName,
        lots: [],
      };
      materialByName.set(mn, card);
    }
    const lots = [...card.lots];
    for (const fl of fc.lots) {
      const exp = (fl.expiryDate ?? "").trim();
      const key = `${mn}\t${exp}`;
      if (existingKeys.has(key)) continue;
      lots.push({
        lotRowId: generateId(),
        sourceType: "from-log",
        expiryDate: fl.expiryDate,
        outboundQty: fl.outboundQty,
        prevDayUnitCount: "",
        prevDayRemainderG: "",
        currentDayUnitCount: "",
        currentDayRemainderG: "",
      });
      existingKeys.add(key);
    }
    materialByName.set(mn, { ...card, lots });
  }

  return Array.from(materialByName.values());
}

function outboundSnapshot(materials: MaterialCard[]): string {
  return JSON.stringify(
    materials.map((c) => ({
      m: c.materialName,
      lots: c.lots.map((l) => ({
        e: l.expiryDate,
        o: l.outboundQty,
        s: l.sourceType,
      })),
    }))
  );
}

/** 해당 날짜 생산 제품들의 BOM 원료 목록 중, 아직 카드로 없는 원료만 반환 (원료 추가 선택지) */
function getAddableBomMaterialNames(
  products: { baseProductName?: string; productStandardName?: string }[],
  bomList: BomRowRef[],
  existingMaterialNames: Set<string>
): string[] {
  const names = new Set<string>();
  for (const p of products) {
    const base = (p.baseProductName ?? "").trim();
    const standard = (p.productStandardName ?? "").trim();
    if (!base) continue;
    const rows = getBomRowsForProductAndStandard(base, standard, bomList);
    for (const r of rows) {
      const name = (r.materialName ?? "").trim();
      if (name && !existingMaterialNames.has(name)) names.add(name);
    }
  }
  return Array.from(names).sort();
}

/** 날짜 그룹 초기 상태 (Step 2: products, secondClosure 포함). defaultAuthor 있으면 작성자명 기본값으로 사용 */
function createInitialDateGroupState(
  date: string,
  logs: ProductionLog[],
  materials: MaterialLike[],
  defaultAuthor?: string
): DateGroupState {
  const products = getProductsFromLogs(logs);
  const productOutputs: ProductOutput[] = products.map((p) => ({
    productOutputId: generateId(),
    productKey: p.productKey,
    productName: p.productName,
    standardName: p.standardName,
    displayProductLabel: p.displayProductLabel,
    baseProductName: p.baseProductName,
    productStandardName: p.productStandardName,
    finishedQty: "",
  }));
  const secondClosure: SecondClosure = {
    productOutputs,
    astronautParbakeQty: "",
    saleParbakeQty: "",
    extraParbakes: [
      { extraParbakeId: generateId(), qty: "", expiryDate: "" },
      { extraParbakeId: generateId(), qty: "", expiryDate: "" },
    ],
    parbakeWasteByType: undefined,
  };
  return {
    id: date,
    date,
    status: "작업대기",
    isFirstClosed: false,
    isSecondClosed: false,
    authorName: defaultAuthor ?? "",
    doughMixQty: "",
    doughWasteQty: "",
    materials: buildInitialMaterials(date, logs, materials),
    products,
    secondClosure,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function UsageCalculationPageContent() {
  const { profile } = useAuth();
  const loginAuthor =
    (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();

  const {
    productionLogs,
    materials,
    bomList,
    fetchProductionLogs,
    fetchMaterials,
    fetchBom,
    fetchProductionHistoryDateStates,
    saveProductionHistoryDateState,
    deleteProductionHistoryDateState,
    getProductionHistoryDateState,
    productionHistoryDateStatesLoading,
  } = useMasterStore();

  useEffect(() => {
    fetchProductionLogs();
    fetchMaterials();
    fetchBom();
    fetchProductionHistoryDateStates();
  }, [fetchProductionLogs, fetchMaterials, fetchBom, fetchProductionHistoryDateStates]);

  const materialsList = useMemo(
    () =>
      materials.map((m) => ({
        materialName: m.materialName,
        boxWeightG: m.boxWeightG,
        unitWeightG: m.unitWeightG,
      })),
    [materials]
  );

  const dateGroups = useMemo(() => groupLogsByDate(productionLogs), [productionLogs]);
  const searchParams = useSearchParams();

  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [expandedSecondDate, setExpandedSecondDate] = useState<string | null>(null);
  const [groupStateByDate, setGroupStateByDate] = useState<Record<string, DateGroupState>>({});
  const [toast, setToast] = useState<{ message: string } | null>(null);
  const [saving, setSaving] = useState<{ date: string; type: "first" | "second" } | null>(null);
  const [resettingDateClosing, setResettingDateClosing] = useState<string | null>(null);
  const hasRestoredRef = useRef(false);
  /** 1차 마감 작성자명 기본값: Supabase(first-close-last-author-name) → localStorage → 빈값 */
  const [defaultAuthor, setDefaultAuthor] = useState(() =>
    typeof window !== "undefined" ? getLastAuthorNameFromStorage() : ""
  );
  const [defaultAuthorReady, setDefaultAuthorReady] = useState(false);

  /** URL ?date= 복원: 해당 날짜 아코디언 자동 펼침 */
  useEffect(() => {
    const q = searchParams.get("date");
    if (q) setExpandedDate(q);
  }, [searchParams]);

  /** 마운트 시 1차 마감 최근 작성자명: Supabase → localStorage. 조회 후 defaultAuthorReady로 복원 시점 제어 */
  useEffect(() => {
    if (loginAuthor) {
      setDefaultAuthor(loginAuthor);
      setDefaultAuthorReady(true);
      return;
    }
    getAppRecentValue(FIRST_CLOSE_LAST_AUTHOR_KEY)
      .then((v) => {
        const fromSupabase = (v ?? "").trim();
        setDefaultAuthor(fromSupabase || getLastAuthorNameFromStorage());
      })
      .catch(() => setDefaultAuthor(getLastAuthorNameFromStorage()))
      .finally(() => setDefaultAuthorReady(true));
  }, [loginAuthor]);

  /** Supabase 날짜별 마감 상태 기준으로 groupStateByDate 초기화 (1회). defaultAuthor 조회 후 복원하여 cross-device 작성자명 반영 */
  useEffect(() => {
    if (!defaultAuthorReady || hasRestoredRef.current || typeof window === "undefined" || productionHistoryDateStatesLoading) return;
    if (dateGroups.length === 0) return;
    hasRestoredRef.current = true;
    const next: Record<string, DateGroupState> = {};
    for (const { date, logs } of dateGroups) {
      const row = getProductionHistoryDateState(date);
      if (row?.state_snapshot && typeof row.state_snapshot === "object") {
        const migrated = migrateSingleState(row.state_snapshot as DateGroupState, defaultAuthor);
        next[date] = {
          ...migrated,
          status: row.second_closed_at ? "2차마감완료" : row.first_closed_at ? "1차마감완료" : "작업대기",
          isFirstClosed: !!row.first_closed_at,
          isSecondClosed: !!row.second_closed_at,
          authorName: ((row.author_name ?? migrated.authorName ?? "").trim() || migrated.authorName) ?? "",
        };
      } else {
        next[date] = createInitialDateGroupState(date, logs, materialsList, defaultAuthor);
      }
    }
    setGroupStateByDate(next);
  }, [defaultAuthorReady, productionHistoryDateStatesLoading, dateGroups, materialsList, getProductionHistoryDateState, defaultAuthor]);

  /** 날짜별 상태 변경 시 sessionStorage에 저장 */
  useEffect(() => {
    if (typeof window === "undefined" || !hasRestoredRef.current) return;
    if (Object.keys(groupStateByDate).length === 0) return;
    try {
      sessionStorage.setItem(HISTORY_GROUP_STATE_KEY, JSON.stringify(groupStateByDate));
    } catch {
      // ignore
    }
  }, [groupStateByDate]);

  /** 출고 현황(DB) 변경 시 마감 스냅샷의 LOT별 출고량을 맞춤. 출고만 수정한 뒤에도 1·2차 재저장 없이 표시·계산·생산일지가 일치하도록 함 */
  useEffect(() => {
    if (typeof window === "undefined" || !hasRestoredRef.current) return;
    setGroupStateByDate((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      let changed = false;
      const next: Record<string, DateGroupState> = { ...prev };
      for (const date of Object.keys(next)) {
        const logs = productionLogs.filter((l) => (l.생산일자 ?? "").slice(0, 10) === date);
        const s = next[date];
        if (!s) continue;
        const merged = mergeOutboundFromLogsForDate(date, s.materials, logs, materialsList);
        if (outboundSnapshot(merged) === outboundSnapshot(s.materials)) continue;
        next[date] = { ...s, materials: merged };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [productionLogs, materialsList, groupStateByDate]);

  /** 토스트 2.5초 후 자동 제거 */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  /** Step 3: 날짜별 계산 결과 (Step 4 출력에서 그대로 사용). 원료 1개중량(g)으로 재고 g 환산 */
  const materialsMeta = useMemo(
    () =>
      materials.map((m) => ({
        materialName: m.materialName,
        unitWeightG: m.unitWeightG,
        boxWeightG: m.boxWeightG,
      })),
    [materials]
  );
  const computedByDate = useMemo((): Record<string, ComputedResult> => {
    const out: Record<string, ComputedResult> = {};
    const bomRefs = bomList.map((b) => ({
      productName: b.productName,
      materialName: b.materialName,
      bomGPerEa: b.bomGPerEa,
      basis: b.basis,
    }));
    for (const { date, logs } of dateGroups) {
      const rawState =
        groupStateByDate[date] ??
        createInitialDateGroupState(date, logs, materialsList, defaultAuthor);
      const state: DateGroupState = {
        ...rawState,
        materials: mergeOutboundFromLogsForDate(date, rawState.materials, logs, materialsList),
      };
      out[date] = calculateUsageSummary(state, bomRefs, materialsMeta);
    }
    return out;
  }, [dateGroups, groupStateByDate, materialsList, bomList, materialsMeta, defaultAuthor]);

  const getOrInitGroupState = useCallback(
    (date: string): DateGroupState => {
      const cached = groupStateByDate[date];
      const logs = productionLogs.filter((l) => (l.생산일자 ?? "").slice(0, 10) === date);
      if (cached) {
        if (!cached.products?.length || !cached.secondClosure) {
          const products = getProductsFromLogs(logs);
          const productOutputs =
            cached.secondClosure?.productOutputs?.length === products.length
              ? cached.secondClosure.productOutputs
              : products.map((p) => ({
                  productOutputId: generateId(),
                  productKey: p.productKey,
                  productName: p.productName,
                  standardName: p.standardName,
                  displayProductLabel: p.displayProductLabel,
                  baseProductName: p.baseProductName,
                  productStandardName: p.productStandardName,
                  finishedQty: "" as number | "",
                }));
          const secondClosure: SecondClosure = cached.secondClosure ?? {
            productOutputs,
            astronautParbakeQty: "",
            saleParbakeQty: "",
            extraParbakes: [
              { extraParbakeId: generateId(), qty: "", expiryDate: "" },
              { extraParbakeId: generateId(), qty: "", expiryDate: "" },
            ],
          };
          return migrateSingleState(
            {
              ...cached,
              status: cached.status ?? "작업대기",
              isSecondClosed: cached.isSecondClosed ?? false,
              authorName: cached.authorName ?? "",
              products: cached.products?.length ? cached.products : products,
              secondClosure: {
                ...secondClosure,
                productOutputs: secondClosure.productOutputs.length ? secondClosure.productOutputs : productOutputs,
                extraParbakes:
                  secondClosure.extraParbakes?.length >= 2
                    ? secondClosure.extraParbakes
                    : [
                        { extraParbakeId: generateId(), qty: "", expiryDate: "" },
                        { extraParbakeId: generateId(), qty: "", expiryDate: "" },
                      ],
              },
            },
            defaultAuthor
          );
        }
        return migrateSingleState(cached, defaultAuthor);
      }
      return createInitialDateGroupState(date, logs, materialsList, defaultAuthor);
    },
    [groupStateByDate, productionLogs, materialsList, defaultAuthor]
  );

  const setGroupState = useCallback((date: string, state: DateGroupState) => {
    setGroupStateByDate((prev) => ({ ...prev, [date]: state }));
  }, []);

  const toggleExpand = useCallback(
    (date: string) => {
      setExpandedDate((prev) => (prev === date ? null : date));
      if (!groupStateByDate[date]) {
        const logs = productionLogs.filter((l) => (l.생산일자 ?? "").slice(0, 10) === date);
        setGroupStateByDate((prev) => ({
          ...prev,
          [date]: createInitialDateGroupState(date, logs, materialsList, defaultAuthor),
        }));
      }
    },
    [groupStateByDate, productionLogs, materialsList, defaultAuthor]
  );

  const updateDough = useCallback(
    (date: string, field: "doughMixQty" | "doughWasteQty", value: number | "") => {
      const s = getOrInitGroupState(date);
      setGroupState(date, { ...s, [field]: value });
    },
    [getOrInitGroupState, setGroupState]
  );

  const updateAuthorName = useCallback(
    (date: string, value: string) => {
      const s = getOrInitGroupState(date);
      setGroupState(date, { ...s, authorName: value ?? "" });
    },
    [getOrInitGroupState, setGroupState]
  );

  const updateLotRow = useCallback(
    (
      date: string,
      materialCardId: string,
      lotRowId: string,
      patch: Partial<Pick<LotRow, "expiryDate" | "prevDayUnitCount" | "prevDayRemainderG" | "currentDayUnitCount" | "currentDayRemainderG" | "prevLoadedFromDate">>
    ) => {
      const s = getOrInitGroupState(date);
      const materials = s.materials.map((card) => {
        if (card.materialCardId !== materialCardId) return card;
        return {
          ...card,
          lots: card.lots.map((row) =>
            row.lotRowId === lotRowId ? { ...row, ...patch } : row
          ),
        };
      });
      setGroupState(date, { ...s, materials });
    },
    [getOrInitGroupState, setGroupState]
  );

  const addManualLot = useCallback(
    (date: string, materialCardId: string, materialName: string) => {
      const s = getOrInitGroupState(date);
      const newRow: LotRow = {
        lotRowId: generateId(),
        sourceType: "manual",
        expiryDate: "",
        outboundQty: 0,
        prevDayUnitCount: "",
        prevDayRemainderG: "",
        currentDayUnitCount: "",
        currentDayRemainderG: "",
      };
      const materials = s.materials.map((card) => {
        if (card.materialCardId !== materialCardId) return card;
        return { ...card, lots: [...card.lots, newRow] };
      });
      setGroupState(date, { ...s, materials });
    },
    [getOrInitGroupState, setGroupState]
  );

  const removeLotRow = useCallback(
    (date: string, materialCardId: string, lotRowId: string) => {
      const s = getOrInitGroupState(date);
      const materials = s.materials.map((card) => {
        if (card.materialCardId !== materialCardId) return card;
        return {
          ...card,
          lots: card.lots.filter((row) => row.lotRowId !== lotRowId),
        };
      });
      setGroupState(date, { ...s, materials });
    },
    [getOrInitGroupState, setGroupState]
  );

  /** 전날재고 불러오기: 같은 원료명+같은 LOT의 가장 최근 이전 날짜 당일재고 → 현재 행 전날재고에 채움 */
  const loadPrevStock = useCallback(
    (date: string, materialCardId: string, lotRowId: string, materialName: string, expiryDate: string) => {
      const found = findPreviousDayStock(groupStateByDate, date, materialName, expiryDate);
      if (!found) {
        setToast({ message: "불러올 이전 당일재고가 없습니다." });
        return;
      }
      updateLotRow(date, materialCardId, lotRowId, {
        prevDayUnitCount: found.prevUnitCount,
        prevDayRemainderG: found.prevRemainderG,
        prevLoadedFromDate: found.fromDate,
      });
    },
    [groupStateByDate, updateLotRow]
  );

  const addMaterialCard = useCallback(
    (date: string, materialName: string) => {
      const s = getOrInitGroupState(date);
      const newCard: MaterialCard = {
        materialCardId: generateId(),
        materialName,
        lots: [
          {
            lotRowId: generateId(),
            sourceType: "manual",
            expiryDate: "",
            outboundQty: 0,
            prevDayUnitCount: "",
            prevDayRemainderG: "",
            currentDayUnitCount: "",
            currentDayRemainderG: "",
          },
        ],
      };
      setGroupState(date, { ...s, materials: [...s.materials, newCard] });
    },
    [getOrInitGroupState, setGroupState]
  );

  const closeFirst = useCallback(
    async (date: string) => {
      const s = getOrInitGroupState(date);
      if (s.authorName.trim()) {
        setAppRecentValue(FIRST_CLOSE_LAST_AUTHOR_KEY, s.authorName.trim());
        setLastAuthorNameToStorage(s.authorName.trim());
      }
      setSaving({ date, type: "first" });
      try {
        const existing = getProductionHistoryDateState(date);
        await saveProductionHistoryDateState(date, {
          state_snapshot: s,
          first_closed_at: new Date().toISOString(),
          second_closed_at: existing?.second_closed_at ?? null,
          author_name: s.authorName.trim() || null,
          updated_by: s.authorName.trim() || null,
        });
        setGroupState(date, {
          ...s,
          isFirstClosed: true,
          status: "1차마감완료",
        });
        setToast({ message: "1차 마감이 저장되었습니다." });
        setExpandedDate(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "1차 마감 저장에 실패했습니다.";
        setToast({ message: msg });
      } finally {
        setSaving(null);
      }
    },
    [getOrInitGroupState, setGroupState, getProductionHistoryDateState, saveProductionHistoryDateState]
  );

  const toggleSecondExpand = useCallback((date: string) => {
    setExpandedSecondDate((prev) => (prev === date ? null : date));
  }, []);

  const updateProductOutput = useCallback(
    (date: string, productOutputId: string, finishedQty: number | "") => {
      const s = getOrInitGroupState(date);
      const productOutputs = s.secondClosure.productOutputs.map((o) =>
        o.productOutputId === productOutputId ? { ...o, finishedQty } : o
      );
      setGroupState(date, {
        ...s,
        secondClosure: { ...s.secondClosure, productOutputs },
      });
    },
    [getOrInitGroupState, setGroupState]
  );

  const updateSecondClosureParbake = useCallback(
    (date: string, field: "astronautParbakeQty" | "saleParbakeQty", value: number | "") => {
      const s = getOrInitGroupState(date);
      setGroupState(date, {
        ...s,
        secondClosure: { ...s.secondClosure, [field]: value },
      });
    },
    [getOrInitGroupState, setGroupState]
  );

  const addExtraParbake = useCallback(
    (date: string) => {
      const s = getOrInitGroupState(date);
      const row: ExtraParbakeRow = {
        extraParbakeId: generateId(),
        qty: "",
        expiryDate: "",
      };
      setGroupState(date, {
        ...s,
        secondClosure: {
          ...s.secondClosure,
          extraParbakes: [...s.secondClosure.extraParbakes, row],
        },
      });
    },
    [getOrInitGroupState, setGroupState]
  );

  const updateExtraParbake = useCallback(
    (date: string, extraParbakeId: string, patch: Partial<Pick<ExtraParbakeRow, "qty" | "expiryDate">>) => {
      const s = getOrInitGroupState(date);
      const extraParbakes = s.secondClosure.extraParbakes.map((r) =>
        r.extraParbakeId === extraParbakeId ? { ...r, ...patch } : r
      );
      setGroupState(date, {
        ...s,
        secondClosure: { ...s.secondClosure, extraParbakes },
      });
    },
    [getOrInitGroupState, setGroupState]
  );

  const removeExtraParbake = useCallback(
    (date: string, extraParbakeId: string) => {
      const s = getOrInitGroupState(date);
      const extraParbakes = s.secondClosure.extraParbakes.filter(
        (r) => r.extraParbakeId !== extraParbakeId
      );
      setGroupState(date, {
        ...s,
        secondClosure: { ...s.secondClosure, extraParbakes },
      });
    },
    [getOrInitGroupState, setGroupState]
  );

  const updateParbakeWasteByType = useCallback(
    (date: string, parbakeName: string, wasteQty: number | "") => {
      const s = getOrInitGroupState(date);
      const prev = s.secondClosure.parbakeWasteByType ?? [];
      const next = prev.some((t) => t.parbakeName === parbakeName)
        ? prev.map((t) => (t.parbakeName === parbakeName ? { ...t, wasteQty } : t))
        : [...prev, { parbakeName, wasteQty }];
      setGroupState(date, {
        ...s,
        secondClosure: { ...s.secondClosure, parbakeWasteByType: next },
      });
    },
    [getOrInitGroupState, setGroupState]
  );

  const closeSecond = useCallback(
    async (date: string) => {
      const s = getOrInitGroupState(date);
      setSaving({ date, type: "second" });
      try {
        const existing = getProductionHistoryDateState(date);
        await saveProductionHistoryDateState(date, {
          state_snapshot: { ...s, isSecondClosed: true, status: "2차마감완료" },
          first_closed_at: existing?.first_closed_at ?? new Date().toISOString(),
          second_closed_at: new Date().toISOString(),
          author_name: s.authorName.trim() || null,
          updated_by: s.authorName.trim() || null,
        });
        setGroupState(date, {
          ...s,
          isSecondClosed: true,
          status: "2차마감완료",
        });
        setToast({ message: "2차 마감이 저장되었습니다." });
        setExpandedDate(null);
        setExpandedSecondDate(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "2차 마감 저장에 실패했습니다.";
        setToast({ message: msg });
      } finally {
        setSaving(null);
      }
    },
    [getOrInitGroupState, setGroupState, getProductionHistoryDateState, saveProductionHistoryDateState]
  );

  const canManageDateClosing =
    profile?.role === "manager" || profile?.role === "admin";

  const resetDateClosingState = useCallback(
    async (date: string) => {
      if (
        !window.confirm(
          "이 날짜의 1차/2차 마감 저장값을 초기화합니다. 출고 수정 후 다시 마감해야 합니다. 계속하시겠습니까?"
        )
      ) {
        return;
      }
      const logs = productionLogs.filter((l) => (l.생산일자 ?? "").slice(0, 10) === date);
      setResettingDateClosing(date);
      try {
        await deleteProductionHistoryDateState(date);
        setGroupStateByDate((prev) => ({
          ...prev,
          [date]: createInitialDateGroupState(date, logs, materialsList, defaultAuthor),
        }));
        setExpandedSecondDate((prev) => (prev === date ? null : prev));
        setToast({ message: "해당 날짜의 마감 저장값을 초기화했습니다." });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "마감 저장값 초기화에 실패했습니다.";
        setToast({ message: msg });
      } finally {
        setResettingDateClosing(null);
      }
    },
    [
      productionLogs,
      materialsList,
      defaultAuthor,
      deleteProductionHistoryDateState,
    ]
  );

  return (
    <div className="py-10 px-4 sm:px-6 lg:px-8">
      {/* 토스트 */}
      {toast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-[min(100vw-2rem,28rem)] rounded-lg bg-cyan-600 text-white px-4 py-2 text-sm font-medium shadow-lg whitespace-pre-line break-words"
          role="alert"
        >
          {toast.message}
        </div>
      )}
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-100 mb-2">사용량 계산</h1>
        <p className="text-sm text-slate-400 mb-6">
          생산일자별로 1차 마감 입력 후 2차 마감을 진행할 수 있습니다.
        </p>

        {dateGroups.length === 0 ? (
          <div className="rounded-2xl border border-slate-700 bg-space-800/80 p-8 text-center text-slate-500 shadow-glow">
            출고 내역이 있는 날짜가 없습니다. 출고 입력·출고 현황에서 데이터를 먼저 등록해 주세요.
          </div>
        ) : (
          <ul className="space-y-3">
            {dateGroups.map(({ date, logs }) => {
              const state = getOrInitGroupState(date);
              const productLabels = getProductNamesForHeader(logs);
              const isExpanded = expandedDate === date;
              const isSecondExpanded = expandedSecondDate === date;
              const canOpenSecond = state.isFirstClosed;
              const badgeClass =
                state.status === "2차마감완료"
                  ? "bg-cyan-500/20 text-cyan-300"
                  : state.status === "1차마감완료"
                    ? "bg-slate-600 text-slate-200"
                    : "bg-slate-700 text-slate-400";
              return (
                <li
                  key={date}
                  className="rounded-2xl border border-slate-700 bg-space-800/80 overflow-hidden shadow-glow"
                >
                  <button
                    type="button"
                    onClick={() => toggleExpand(date)}
                    className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-slate-800/50 transition-colors border-b border-slate-700/80"
                  >
                    <span className="font-medium text-slate-100">
                      [{date}] {productLabels.length ? productLabels.join(", ") : "—"}
                    </span>
                    <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${badgeClass}`}>
                      {state.status === "2차마감완료"
                        ? "2차마감 완료"
                        : state.status === "1차마감완료"
                          ? "1차마감 완료"
                          : "작업대기"}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-700/80 p-4 sm:p-6 space-y-6 bg-space-900/40">
                      {/* 마감 초기화 (manager/admin) — 생산일지는 생산일지 완료 목록에서만 엽니다 */}
                      <div className="flex flex-wrap items-center justify-end gap-3">
                        {canManageDateClosing && (
                          <button
                            type="button"
                            disabled={resettingDateClosing === date}
                            onClick={() => resetDateClosingState(date)}
                            className="rounded-lg border border-amber-600/60 bg-amber-950/40 text-amber-100 hover:bg-amber-900/50 px-4 py-2 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {resettingDateClosing === date ? "초기화 중..." : "마감 초기화"}
                          </button>
                        )}
                        {state.status === "2차마감완료" && (
                          <Link
                            href="/production/history/completed"
                            className="text-sm font-medium text-cyan-400 hover:text-cyan-300"
                          >
                            생산일지 보기 →
                          </Link>
                        )}
                      </div>
                      {/* Step 3 계산 경고 (있을 때만) */}
                      {computedByDate[date]?.warnings?.length > 0 && (
                        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
                          <p className="text-xs font-medium text-amber-200">계산 참고 사항</p>
                          <ul className="text-xs text-amber-200/90 list-disc list-inside space-y-0.5">
                            {computedByDate[date].warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {/* 상단 공통: 작성자명, 도우 반죽량 / 도우 폐기량 */}
                      <div className="rounded-xl border border-slate-700 bg-space-800/80 p-4 shadow-glow">
                        <h3 className="text-sm font-semibold text-slate-300 mb-3">1차 마감 입력</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                          <label className="flex flex-col gap-1.5 sm:col-span-2">
                            <span className="text-sm font-medium text-slate-400">작성자명</span>
                            <input
                              type="text"
                              className="w-full rounded-lg border border-slate-600 bg-space-900 px-4 py-3 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                              placeholder="출고입력자 / 마감입력자"
                              value={state.authorName ?? ""}
                              onChange={(e) => updateAuthorName(date, e.target.value)}
                            />
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="text-sm font-medium text-slate-400">도우 반죽량 (개)</span>
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              className="w-full rounded-lg border border-slate-600 bg-space-900 px-4 py-3 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                              placeholder="0"
                              value={state.doughMixQty === "" ? "" : state.doughMixQty}
                              onChange={(e) => {
                                const v = e.target.value;
                                updateDough(date, "doughMixQty", v === "" ? "" : Math.max(0, Number(v) || 0));
                              }}
                            />
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="text-sm font-medium text-slate-400">도우 폐기량 (개)</span>
                            <input
                              type="number"
                              min={0}
                              inputMode="numeric"
                              className="w-full rounded-lg border border-slate-600 bg-space-900 px-4 py-3 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                              placeholder="0"
                              value={state.doughWasteQty === "" ? "" : state.doughWasteQty}
                              onChange={(e) => {
                                const v = e.target.value;
                                updateDough(date, "doughWasteQty", v === "" ? "" : Math.max(0, Number(v) || 0));
                              }}
                            />
                          </label>
                        </div>
                      </div>

                      {/* 원료 카드 */}
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-300">원료별 출고·재고</h3>
                          {(() => {
                            const emptyLots = countFullyEmptyLotsInDate(state, materialsList);
                            if (emptyLots === 0) return null;
                            return (
                              <span className="text-xs font-medium text-amber-200 bg-amber-950/50 border border-amber-600/50 rounded-full px-2.5 py-0.5">
                                미입력 원료/LOT {emptyLots}건
                              </span>
                            );
                          })()}
                          {(() => {
                            const existing = new Set(state.materials.map((m) => m.materialName));
                            const addable = getAddableBomMaterialNames(
                              state.products,
                              bomList,
                              existing
                            );
                            if (addable.length === 0) return null;
                            return (
                              <span className="flex items-center gap-2">
                                <label className="text-xs text-slate-400">원료 추가:</label>
                                <select
                                  key={`add-mat-${date}-${state.materials.length}`}
                                  className="rounded-lg border border-slate-600 bg-space-900 px-3 py-1.5 text-sm text-slate-200 focus:ring-2 focus:ring-cyan-500/50"
                                  value=""
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v) addMaterialCard(date, v);
                                  }}
                                >
                                  <option value="">선택...</option>
                                  {addable.map((name) => (
                                    <option key={name} value={name}>
                                      {name}
                                    </option>
                                  ))}
                                </select>
                              </span>
                            );
                          })()}
                        </div>
                        {state.materials.map((card) => (
                          <MaterialCardBlock
                            key={card.materialCardId}
                            card={card}
                            materialsList={materialsList}
                            onUpdateLot={(lotRowId, patch) =>
                              updateLotRow(date, card.materialCardId, lotRowId, patch)
                            }
                            onAddLot={() =>
                              addManualLot(date, card.materialCardId, card.materialName)
                            }
                            onRemoveLot={(lotRowId) =>
                              removeLotRow(date, card.materialCardId, lotRowId)
                            }
                            onLoadPrevStock={(lotRowId, materialName, expiryDate) =>
                              loadPrevStock(date, card.materialCardId, lotRowId, materialName, expiryDate)
                            }
                          />
                        ))}
                      </div>

                      {/* 1차 마감 저장 */}
                      <div className="pt-2 space-y-1.5">
                        {(() => {
                          const saved = getProductionHistoryDateState(date);
                          const savedAt = saved?.updated_at;
                          const savedBy = saved?.updated_by;
                          return (savedAt || savedBy) ? (
                            <p className="text-xs text-slate-500">
                              {savedAt && (
                                <span>마지막 저장: {new Date(savedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</span>
                              )}
                              {savedBy && (
                                <span className={savedAt ? "ml-2" : ""}>저장자: {savedBy}</span>
                              )}
                            </p>
                          ) : null;
                        })()}
                        <button
                          type="button"
                          disabled={saving?.date === date && saving?.type === "first"}
                          onClick={() => closeFirst(date)}
                          className="w-full sm:w-auto min-w-[180px] py-3 px-6 rounded-xl bg-cyan-500 text-space-900 font-semibold shadow-glow hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 transition-colors disabled:opacity-80 disabled:cursor-not-allowed"
                        >
                          {saving?.date === date && saving?.type === "first"
                            ? "저장 중..."
                            : "1차 마감 저장"}
                        </button>
                      </div>

                      {/* 2차 마감 버튼 (1차 완료 시만 활성화) */}
                      <div className="pt-4 border-t border-slate-700">
                        <button
                          type="button"
                          disabled={!canOpenSecond}
                          onClick={() => canOpenSecond && toggleSecondExpand(date)}
                          className={`w-full sm:w-auto min-w-[160px] py-2.5 px-5 rounded-xl font-medium transition-colors ${
                            canOpenSecond
                              ? "bg-slate-600 text-slate-100 hover:bg-slate-500 border border-slate-500"
                              : "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                          }`}
                        >
                          2차 마감
                        </button>
                      </div>

                      {/* 2차 마감 입력 영역 */}
                      {canOpenSecond && isSecondExpanded && (
                        <div className="rounded-xl border border-slate-600 bg-space-800/80 p-4 sm:p-6 space-y-6 border-cyan-500/30 shadow-glow">
                          <h3 className="text-base font-semibold text-slate-100">2차 마감 입력</h3>

                          {/* 제품별 완제품 생산수량 */}
                          <div className="space-y-3">
                            <h4 className="text-sm font-medium text-slate-400">완제품 생산량</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {state.secondClosure.productOutputs.map((o) => (
                                <label key={o.productOutputId} className="flex flex-col gap-1.5">
                                  <span className="text-sm text-slate-400">
                                    완제품생산량({o.displayProductLabel ?? o.productName})
                                  </span>
                                  <input
                                    type="number"
                                    min={0}
                                    inputMode="numeric"
                                    className="w-full rounded-lg border border-slate-600 bg-space-900 px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                                    placeholder="0"
                                    value={o.finishedQty === "" ? "" : o.finishedQty}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      updateProductOutput(
                                        date,
                                        o.productOutputId,
                                        v === "" ? "" : Number(v)
                                      );
                                    }}
                                  />
                                </label>
                              ))}
                            </div>
                          </div>

                          {/* 우주인 / 판매용 파베이크 */}
                          <div className="rounded-lg border border-slate-700 bg-space-900/60 p-4 space-y-3">
                            <h4 className="text-sm font-medium text-slate-400">파베이크 생산량</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <label className="flex flex-col gap-1.5">
                                <span className="text-sm text-slate-400">우주인 파베이크 생산량</span>
                                <input
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  className="w-full rounded-lg border border-slate-600 bg-space-900 px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                                  placeholder="0"
                                  value={
                                    state.secondClosure.astronautParbakeQty === ""
                                      ? ""
                                      : state.secondClosure.astronautParbakeQty
                                  }
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    updateSecondClosureParbake(
                                      date,
                                      "astronautParbakeQty",
                                      v === "" ? "" : Number(v)
                                    );
                                  }}
                                />
                              </label>
                              <label className="flex flex-col gap-1.5">
                                <span className="text-sm text-slate-400">판매용 파베이크 생산량</span>
                                <input
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  className="w-full rounded-lg border border-slate-600 bg-space-900 px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                                  placeholder="0"
                                  value={
                                    state.secondClosure.saleParbakeQty === ""
                                      ? ""
                                      : state.secondClosure.saleParbakeQty
                                  }
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    updateSecondClosureParbake(
                                      date,
                                      "saleParbakeQty",
                                      v === "" ? "" : Number(v)
                                    );
                                  }}
                                />
                              </label>
                            </div>
                          </div>

                          {/* 추가 파베이크 수량 */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-medium text-slate-400">추가 파베이크 수량</h4>
                              <button
                                type="button"
                                onClick={() => addExtraParbake(date)}
                                className="text-sm font-medium text-cyan-400 hover:text-cyan-300 py-2 px-3 rounded-lg border border-dashed border-slate-600 hover:border-cyan-500/50"
                              >
                                + 추가
                              </button>
                            </div>
                            <ul className="space-y-2">
                              {state.secondClosure.extraParbakes.map((row) => (
                                <li
                                  key={row.extraParbakeId}
                                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-700 bg-space-900/80 p-3"
                                >
                                  <div className="w-24 sm:w-28">
                                    <span className="text-xs text-slate-500 block mb-0.5">수량</span>
                                    <input
                                      type="number"
                                      min={0}
                                      inputMode="numeric"
                                      className="w-full rounded-lg border border-slate-600 bg-space-900 px-2 py-2 text-sm text-slate-100"
                                      value={row.qty === "" ? "" : row.qty}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        updateExtraParbake(date, row.extraParbakeId, {
                                          qty: v === "" ? "" : Number(v),
                                        });
                                      }}
                                    />
                                  </div>
                                  <div className="flex-1 min-w-[120px]">
                                    <span className="text-xs text-slate-500 block mb-0.5">소비기한</span>
                                    <DateWheelPicker
                                      value={row.expiryDate || ""}
                                      onChange={(v) =>
                                        updateExtraParbake(date, row.extraParbakeId, {
                                          expiryDate: v || "",
                                        })
                                      }
                                      className="w-full rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-cyan-500/50"
                                      placeholder="날짜 선택"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeExtraParbake(date, row.extraParbakeId)}
                                    className="mt-5 sm:mt-0 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 py-2 px-3 rounded-lg"
                                  >
                                    삭제
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>

                          {/* 혼합 베이스 날: 파베이크 폐기량 타입별 입력 (자동 분배 없음) */}
                          {(() => {
                            const comp = computedByDate[date];
                            const dateParbakeTypes = comp ? getDateParbakeTypes(comp.productSummaries) : [];
                            if (dateParbakeTypes.length <= 1) return null;
                            return (
                              <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 p-4 space-y-3">
                                <h4 className="text-sm font-medium text-amber-200">파베이크 폐기량 상세 (혼합 베이스)</h4>
                                <p className="text-xs text-slate-400">
                                  당일 파베이크 종류가 2종 이상이므로, 종류별 폐기량을 입력해 주세요. 총합만으로는 자동 배분하지 않습니다.
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  {dateParbakeTypes.map((parbakeName) => (
                                    <label key={parbakeName} className="flex flex-col gap-1.5">
                                      <span className="text-sm text-slate-400">{parbakeName} 폐기량 (개)</span>
                                      <input
                                        type="number"
                                        min={0}
                                        inputMode="numeric"
                                        className="w-full rounded-lg border border-slate-600 bg-space-900 px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500/50"
                                        placeholder="0"
                                        value={
                                          state.secondClosure.parbakeWasteByType?.find((t) => t.parbakeName === parbakeName)?.wasteQty ?? ""
                                        }
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          updateParbakeWasteByType(
                                            date,
                                            parbakeName,
                                            v === "" ? "" : Math.max(0, Number(v) || 0)
                                          );
                                        }}
                                      />
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}

                          {/* 2차 마감 저장 */}
                          <div className="pt-2 space-y-1.5">
                            {(() => {
                              const saved = getProductionHistoryDateState(date);
                              const savedAt = saved?.updated_at;
                              const savedBy = saved?.updated_by;
                              return (savedAt || savedBy) ? (
                                <p className="text-xs text-slate-500">
                                  {savedAt && (
                                    <span>마지막 저장: {new Date(savedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}</span>
                                  )}
                                  {savedBy && (
                                    <span className={savedAt ? "ml-2" : ""}>저장자: {savedBy}</span>
                                  )}
                                </p>
                              ) : null;
                            })()}
                            <button
                              type="button"
                              disabled={saving?.date === date && saving?.type === "second"}
                              onClick={() => closeSecond(date)}
                              className="w-full sm:w-auto min-w-[180px] py-3 px-6 rounded-xl bg-cyan-500 text-space-900 font-semibold shadow-glow hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400 transition-colors disabled:opacity-80 disabled:cursor-not-allowed"
                            >
                              {saving?.date === date && saving?.type === "second"
                                ? "저장 중..."
                                : "2차 마감 저장"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Material Card (원료명 1장 = 카드 1개, 내부 LOT 행들)
// ---------------------------------------------------------------------------

type MaterialsListLike = { materialName: string; boxWeightG: number; unitWeightG: number }[];

function MaterialCardBlock({
  card,
  materialsList,
  onUpdateLot,
  onAddLot,
  onRemoveLot,
  onLoadPrevStock,
}: {
  card: MaterialCard;
  materialsList: MaterialsListLike;
  onUpdateLot: (
    lotRowId: string,
    patch: Partial<Pick<LotRow, "expiryDate" | "prevDayUnitCount" | "prevDayRemainderG" | "currentDayUnitCount" | "currentDayRemainderG" | "prevLoadedFromDate">>
  ) => void;
  onAddLot: () => void;
  onRemoveLot: (lotRowId: string) => void;
  onLoadPrevStock?: (lotRowId: string, materialName: string, expiryDate: string) => void;
}) {
  const mat = materialsList.find((m) => m.materialName === card.materialName);
  const isGOnly = mat ? mat.boxWeightG === 0 && mat.unitWeightG === 0 : false;
  const inputCls = "w-full rounded-lg border border-slate-600 bg-space-900 px-3 py-2 text-sm text-slate-100 focus:ring-2 focus:ring-cyan-500/50 min-w-0";
  const stockInputCls = (isEmpty: boolean) =>
    `${inputCls} ${isEmpty ? "border-amber-500/55 bg-amber-950/25 ring-1 ring-amber-500/35 placeholder:text-amber-200/70" : ""}`;
  const numVal = (v: number | "") => (v === "" ? "" : v);
  return (
    <div className="rounded-xl border border-slate-700 bg-space-800/80 p-4 shadow-glow">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h4 className="font-semibold text-slate-100 min-w-0">{card.materialName}</h4>
        <button
          type="button"
          onClick={onAddLot}
          className="text-sm font-medium text-cyan-400 hover:text-cyan-300 py-2 px-3 rounded-lg border border-slate-600 hover:border-cyan-500/50 shrink-0"
        >
          + 추가
        </button>
      </div>
      <ul className="space-y-3">
        {card.lots.map((row) => (
          <li
            key={row.lotRowId}
            className="flex flex-col gap-2 rounded-lg bg-space-900/80 p-3 border border-slate-700"
          >
            {isLotStockFullyEmpty(row, isGOnly) && (
              <span className="text-[11px] font-medium shrink-0 text-amber-200 bg-amber-950/45 border border-amber-600/45 rounded-full px-2 py-0.5 w-fit">
                미입력
              </span>
            )}
            <div className="flex flex-wrap items-start gap-3">
            <div className="w-full sm:w-[120px]">
              <span className="text-xs text-slate-500 block mb-1">소비기한(LOT)</span>
              {row.sourceType === "from-log" ? (
                <input
                  type="text"
                  readOnly
                  className={`${inputCls} placeholder-slate-500 bg-slate-800`}
                  value={row.expiryDate || "—"}
                />
              ) : (
                <DateWheelPicker
                  value={row.expiryDate || ""}
                  onChange={(v) => onUpdateLot(row.lotRowId, { expiryDate: v || "" })}
                  className={`${inputCls} placeholder-slate-500`}
                  placeholder="날짜 선택"
                />
              )}
            </div>
            <div className="w-[90px]">
              <span className="text-xs text-slate-500 block mb-1">출고량</span>
              <div className="rounded-lg border border-slate-600 px-3 py-2 text-sm bg-slate-800 text-slate-200">
                {row.outboundQty.toLocaleString()}
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-600/80 bg-space-900/50 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs font-medium text-slate-400">전날재고</p>
                  {onLoadPrevStock && (
                    <button
                      type="button"
                      onClick={() => onLoadPrevStock(row.lotRowId, card.materialName, row.expiryDate ?? "")}
                      className="text-xs font-medium text-slate-400 hover:text-cyan-400 border border-slate-600 hover:border-cyan-500/50 rounded-lg py-1.5 px-2.5 transition-colors"
                    >
                      전날재고 불러오기
                    </button>
                  )}
                </div>
                <div className={isGOnly ? "space-y-2" : "grid grid-cols-2 gap-3"}>
                  {!isGOnly && (
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-slate-500">낱개</span>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className={stockInputCls(row.prevDayUnitCount === "")}
                        placeholder="미입력"
                        value={numVal(row.prevDayUnitCount)}
                        onChange={(e) => {
                          const v = e.target.value;
                          onUpdateLot(row.lotRowId, {
                            prevDayUnitCount: v === "" ? "" : Math.max(0, Number(v) || 0),
                          });
                        }}
                      />
                    </label>
                  )}
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">잔량(g)</span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className={stockInputCls(row.prevDayRemainderG === "")}
                      placeholder="미입력"
                      value={numVal(row.prevDayRemainderG)}
                      onChange={(e) => {
                        const v = e.target.value;
                        onUpdateLot(row.lotRowId, {
                          prevDayRemainderG: v === "" ? "" : Math.max(0, Number(v) || 0),
                        });
                      }}
                    />
                  </label>
                </div>
                {row.prevLoadedFromDate && (
                  <p className="text-xs text-slate-500 mt-1.5">
                    전날재고 불러옴: {row.prevLoadedFromDate}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-slate-600/80 bg-space-900/50 p-3">
                <p className="text-xs font-medium text-slate-400 mb-2">당일재고</p>
                <div className={isGOnly ? "space-y-2" : "grid grid-cols-2 gap-3"}>
                  {!isGOnly && (
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-slate-500">낱개</span>
                      <input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className={stockInputCls(row.currentDayUnitCount === "")}
                        placeholder="미입력"
                        value={numVal(row.currentDayUnitCount)}
                        onChange={(e) => {
                          const v = e.target.value;
                          onUpdateLot(row.lotRowId, {
                            currentDayUnitCount: v === "" ? "" : Math.max(0, Number(v) || 0),
                          });
                        }}
                      />
                    </label>
                  )}
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-500">잔량(g)</span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className={stockInputCls(row.currentDayRemainderG === "")}
                      placeholder="미입력"
                      value={numVal(row.currentDayRemainderG)}
                      onChange={(e) => {
                        const v = e.target.value;
                        onUpdateLot(row.lotRowId, {
                          currentDayRemainderG: v === "" ? "" : Math.max(0, Number(v) || 0),
                        });
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
            {row.sourceType === "manual" && (
              <button
                type="button"
                onClick={() => onRemoveLot(row.lotRowId)}
                className="mt-5 sm:mt-0 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 py-2 px-3 rounded-lg"
              >
                삭제
              </button>
            )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function UsageCalculationPage() {
  return (
    <Suspense fallback={<div className="p-4">로딩 중...</div>}>
      <UsageCalculationPageContent />
    </Suspense>
  );
}
