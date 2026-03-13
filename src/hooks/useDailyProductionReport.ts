"use client";

import { useMemo } from "react";
import {
  useMasterStore,
  type ProductionLog,
  type UsageCalculationRecord,
  type DoughLogRecord,
  type MaterialStockLot,
} from "@/store/useMasterStore";
import type { BomRow } from "@/lib/mockData";

/** 당일(Date) 기준 통합 생산 리포트용 일일 집계 입력 */
export interface DailyConsolidatedData {
  date: string;
  productionLogs: ProductionLog[];
  usageCalculations: UsageCalculationRecord[];
  doughLog: DoughLogRecord | null;
  bomList: BomRow[];
}

/** 소스 타입별 사용/폐기 표시 (마스터 일지 UI) */
export interface P1_SourceDisplay {
  usageG: number;
  wasteG: number;
  expiry?: string;
}

/** 파베이크 사용 LOT 한 줄 */
export interface P1_ParbakeUsedLine {
  qty: number;
  lot: string;
}

/** P1 마스터 생산일지용 데이터 */
export interface P1_MasterData {
  date: string;
  /** 총 도우 반죽량 (EA). A = totalDoughUsageQty - totalDoughWasteQty */
  totalDoughUsageQty: number;
  /** 총 도우 폐기량 (EA) */
  totalDoughWasteQty: number;
  /** 총 추가 파베이크 수량 (EA) */
  totalParbakeAddQty: number;
  /** 모든 제품의 완제품 생산량 총합 (EA) */
  totalFinishedQty: number;
  /** 우주인/보관용/판매용 파베이크 생산량 총합 (EA) */
  totalParbakeWoozooinSalesQty: number;
  /** 최종 파베이크 폐기량 (EA) = B - 완제품총합 - 우주인·보관·판매 총합 */
  parbakeWasteQty: number;
  /** 원료명 → 소스 폐기량(g). 폐기된 파베이크에 발린 소스량 */
  sourceWasteByMaterial: Record<string, number>;
  /** 원료명 → 재고 기반 총 사용량(g). 소스만 해당 */
  totalSourceUsageByMaterial: Record<string, number>;
  /** 원료명 → 최종 소스 사용량(g) = 총 사용량 - 소스 폐기량 */
  finalSourceUsageByMaterial: Record<string, number>;
  doughLog: DoughLogRecord | null;

  // ——— UI 전용 표시 필드 (엑셀 서식 매핑) ———
  /** 당일 제품명 목록 (쉼표 구분) */
  productNames: string;
  /** 완제품 소비기한 (첫 로그 기준) */
  expiryDate: string;
  /** 작성자 (사용량 계산 또는 로그) */
  authors: string;
  /** 완제품 수량 표시 문자열 */
  finishedQtyDisplay: string;
  /** 도우 반죽량 (EA) = totalDoughUsageQty */
  totalDoughQty: number;
  /** 파베이크 생산량 (EA) = 보관+판매 */
  parbakeProductionQty: number;
  /** 도우 사용량 (EA) = 반죽량 - 반죽폐기 - 파베이크폐기 */
  totalDoughUsage: number;
  /** 도우 폐기량 (EA) = totalDoughWasteQty */
  totalDoughWaste: number;
  /** 소스 타입별 사용/폐기 (베샤멜, 토마토, 로제, 바질) */
  sourceByType: Record<string, P1_SourceDisplay>;
  /** 덧가루/덧기름: 키별 총 g, LOT 표시 */
  doughAdditives: Record<string, { totalG: number; lotDisplay: string }>;
  /** 반죽 원료별 사용량(g): 이스트, 밀가루, 소금, 올리브오일, 설탕, 개량제 */
  doughIngredients: Record<string, number>;
  /** 보관용 파베이크 생산량(우주인) */
  parbakeWoozooinQty: number;
  /** 판매용 파베이크 생산량(납품용) */
  parbakeSalesQty: number;
  /** 소스별 보관 파베이크 사용: 베샤멜, 로제, 바질, 토마토 → [{ qty, lot }] */
  parbakeUsedBySource: Record<string, P1_ParbakeUsedLine[]>;
}

/** P2 제품별 원료 한 건 */
export interface P2_IngredientRow {
  materialName: string;
  bomG: number;
  /** 분배된 실제 사용량(g). 공통 원료는 10자리 절삭/몰빵 규칙 적용 */
  allocatedUsage_g: number;
  isShared: boolean;
  /** LOT(소비기한) 표시용. 해당 제품·원료의 첫 출고/재고 LOT */
  lot?: string;
}

/** P2 제품별 원료 데이터 */
export interface P2_ProductData {
  productName: string;
  finishedQty: number;
  ingredients: P2_IngredientRow[];
}

/** 도우 베이스 소스 원료 여부 (원료명에 '도우'·'소스' 포함, '토핑' 미포함) */
function isDoughSourceMaterial(원료명: string): boolean {
  const name = 원료명.trim();
  if (name.includes("토핑")) return false;
  return name.includes("도우") && name.includes("소스");
}

/** 원료명 → 소스 타입 (베샤멜, 토마토, 로제, 바질). UI 그룹핑용 */
function getSourceTypeFromMaterial(원료명: string): string {
  const n = (원료명 ?? "").trim();
  if (/토마토/i.test(n)) return "토마토";
  if (/로제/i.test(n)) return "로제";
  if (/바질/i.test(n)) return "바질";
  if (/베샤멜|치즈|고르곤/i.test(n)) return "베샤멜";
  return "베샤멜";
}

/** 제품명 → 파베이크 소스 타입 (보관 파베이크 사용 그룹핑) */
function getParbakeSourceFromProduct(제품명: string): string {
  const n = (제품명 ?? "").trim();
  if (/마르게리타|마르게리따|토마토/i.test(n)) return "토마토";
  if (/바질/i.test(n)) return "바질";
  if (/로제/i.test(n)) return "로제";
  if (/치즈|고르곤/i.test(n)) return "베샤멜";
  return "베샤멜";
}

/** 10자리 절삭: Math.floor(val/10)*10 */
function truncateTens(val: number): number {
  return Math.floor(val / 10) * 10;
}

/**
 * 당일(date) 해당 productionLogs, usageCalculations, doughLog를 모두 모아
 * 날짜 단위 통합 데이터로 반환.
 */
function consolidateDaily(
  date: string,
  productionLogs: ProductionLog[],
  usageCalculations: UsageCalculationRecord[],
  doughLogsMap: Record<string, DoughLogRecord>,
  bomList: BomRow[]
): DailyConsolidatedData {
  const dateKey = date.slice(0, 10);
  const logs = productionLogs.filter((l) => l.생산일자 === dateKey);
  const calcs = usageCalculations.filter((u) => u.production_date === dateKey);
  const doughLog = doughLogsMap[dateKey] ?? null;
  return {
    date: dateKey,
    productionLogs: logs,
    usageCalculations: calcs,
    doughLog,
    bomList,
  };
}

/**
 * (product, material)별 실제 사용량 = 전일재고 + 출고 - 당일재고.
 * usageCalculations.materials_data + productionLogs 출고_g 사용.
 */
function getActualUsageByProductMaterial(
  date: string,
  productName: string,
  materialName: string,
  logs: ProductionLog[],
  calcs: UsageCalculationRecord[]
): number {
  const log = logs.find(
    (l) => l.제품명 === productName && (l.원료명 ?? "") === materialName
  );
  const calc = calcs.find(
    (c) => c.production_date === date && c.product_name === productName
  );
  const priorSum = (calc?.materials_data?.[materialName]?.prior_stock ?? []).reduce(
    (s: number, lot: MaterialStockLot) => s + (lot.qty_g ?? 0),
    0
  );
  const closingSum = (calc?.materials_data?.[materialName]?.closing_stock ?? []).reduce(
    (s: number, lot: MaterialStockLot) => s + (lot.qty_g ?? 0),
    0
  );
  const outbound = log?.출고_g ?? 0;
  return Math.max(0, priorSum + outbound - closingSum);
}

/**
 * 당일(Date) 기준 통합 데이터 가공 훅.
 * - 1) 데이터 통합 (날짜 단위로 productionLogs, usageCalculations, doughLogs 병합)
 * - 2) P1: 파베이크 폐기량 역산, 소스 폐기량 연동, 최종 소스 사용량
 * - 3) P2: 제품별 원료 분배, 공통 원료 10자리 절삭 + 나머지 몰빵
 * UI 바인딩 없이 순수 데이터만 반환.
 */
export function useDailyProductionReport(date: string): {
  daily: DailyConsolidatedData | null;
  P1: P1_MasterData | null;
  P2: P2_ProductData[];
} {
  const productionLogs = useMasterStore((s) => s.productionLogs);
  const usageCalculations = useMasterStore((s) => s.usageCalculations);
  const doughLogsMap = useMasterStore((s) => s.doughLogsMap);
  const bomList = useMasterStore((s) => s.bomList);

  return useMemo(() => {
    const dateKey = (date ?? "").slice(0, 10);
    if (!dateKey) return { daily: null, P1: null, P2: [] };

    const daily = consolidateDaily(
      dateKey,
      productionLogs,
      usageCalculations,
      doughLogsMap,
      bomList
    );
    const { productionLogs: logs, usageCalculations: calcs, bomList: bom } = daily;

    if (logs.length === 0) {
      const emptyP1: P1_MasterData = {
        date: dateKey,
        totalDoughUsageQty: 0,
        totalDoughWasteQty: 0,
        totalParbakeAddQty: 0,
        totalFinishedQty: 0,
        totalParbakeWoozooinSalesQty: 0,
        parbakeWasteQty: 0,
        sourceWasteByMaterial: {},
        totalSourceUsageByMaterial: {},
        finalSourceUsageByMaterial: {},
        doughLog: daily.doughLog,
        productNames: "",
        expiryDate: "",
        authors: "",
        finishedQtyDisplay: "",
        totalDoughQty: 0,
        parbakeProductionQty: 0,
        totalDoughUsage: 0,
        totalDoughWaste: 0,
        sourceByType: {},
        doughAdditives: {},
        doughIngredients: {},
        parbakeWoozooinQty: 0,
        parbakeSalesQty: 0,
        parbakeUsedBySource: {},
      };
      return { daily, P1: emptyP1, P2: [] };
    }

    // ——— 제품 목록 (당일 출고된 제품) ———
    const productNames = Array.from(
      new Set(logs.map((l) => l.제품명).filter(Boolean))
    ) as string[];

    // ——— P1: 파베이크 폐기량 역산 ———
    let totalDoughUsageQty = 0;
    let totalDoughWasteQty = 0;
    let totalParbakeAddQty = 0;
    let totalFinishedQty = 0;
    let totalParbakeWoozooinSalesQty = 0;

    for (const productName of productNames) {
      const calc = calcs.find(
        (c) => c.production_date === dateKey && c.product_name === productName
      );
      const firstLog = logs.find((l) => l.제품명 === productName);
      totalDoughUsageQty +=
        calc?.dough_usage_qty ??
        firstLog?.반죽량 ??
        0;
      totalDoughWasteQty +=
        calc?.dough_waste_qty ??
        firstLog?.반죽폐기량 ??
        0;
      const parbakeUsed =
        firstLog?.파베이크사용_라인?.reduce((s, l) => s + (l.qty ?? 0), 0) ?? 0;
      totalParbakeAddQty += parbakeUsed;
      totalFinishedQty +=
        calc?.finished_qty_actual ?? firstLog?.완제품생산량 ?? 0;
      totalParbakeWoozooinSalesQty +=
        (calc?.parbake_woozooin_qty ?? firstLog?.보관용파베이크 ?? 0) +
        (calc?.parbake_sales_qty ?? firstLog?.판매용파베이크 ?? 0);
    }

    const A = totalDoughUsageQty - totalDoughWasteQty;
    const B = A + totalParbakeAddQty;
    const parbakeWasteQty = Math.max(
      0,
      B - totalFinishedQty - totalParbakeWoozooinSalesQty
    );

    // ——— P1: 소스 폐기량 연동 (폐기 파베이크 × 도우 기준 소스 BOM) ———
    // 파베이크 폐기량을 제품별 비율로 배분 후, 제품별 도우 소스 BOM으로 소스 폐기량 계산
    const sourceWasteByMaterial: Record<string, number> = {};
    const totalSourceUsageByMaterial: Record<string, number> = {};
    const finalSourceUsageByMaterial: Record<string, number> = {};

    if (totalFinishedQty > 0 && parbakeWasteQty > 0) {
      for (const productName of productNames) {
        const finished =
          calcs.find((c) => c.product_name === productName)?.finished_qty_actual ??
          logs.find((l) => l.제품명 === productName)?.완제품생산량 ??
          0;
        const share = finished / totalFinishedQty;
        const productParbakeWaste = parbakeWasteQty * share;
        const productBom = bom.filter((b) => b.productName === productName);
        for (const row of productBom) {
          if (!isDoughSourceMaterial(row.materialName)) continue;
          const wasteG = Math.round(productParbakeWaste * row.bomGPerEa);
          sourceWasteByMaterial[row.materialName] =
            (sourceWasteByMaterial[row.materialName] ?? 0) + wasteG;
        }
      }
    }

    // 재고 기반 총 소스 사용량 (당일 해당 제품들에서 해당 원료 사용량 합)
    for (const productName of productNames) {
      const productBom = bom.filter((b) => b.productName === productName);
      for (const row of productBom) {
        if (!isDoughSourceMaterial(row.materialName)) continue;
        const usage = getActualUsageByProductMaterial(
          dateKey,
          productName,
          row.materialName,
          logs,
          calcs
        );
        totalSourceUsageByMaterial[row.materialName] =
          (totalSourceUsageByMaterial[row.materialName] ?? 0) + usage;
      }
    }
    for (const mat of Object.keys(totalSourceUsageByMaterial)) {
      const total = totalSourceUsageByMaterial[mat] ?? 0;
      const waste = sourceWasteByMaterial[mat] ?? 0;
      finalSourceUsageByMaterial[mat] = Math.max(0, total - waste);
    }

    // ——— P1 UI 표시 필드 ———
    const productNamesStr = productNames.join(", ");
    const firstLogAny = logs[0];
    const expiryDateStr = firstLogAny?.소비기한 ?? firstLogAny?.출고_라인?.[0]?.소비기한 ?? "";
    const authorsStr = calcs.map((c) => c.author_name).filter(Boolean).join(", ") ||
      logs.map((l) => l.작성자2 ?? l.출고자).filter(Boolean).join(", ") || "";
    const totalDoughUsageEA = Math.max(
      0,
      totalDoughUsageQty - totalDoughWasteQty - parbakeWasteQty
    );
    const sourceByType: Record<string, P1_SourceDisplay> = {};
    for (const mat of Object.keys(finalSourceUsageByMaterial)) {
      const type = getSourceTypeFromMaterial(mat);
      if (!sourceByType[type]) {
        sourceByType[type] = { usageG: 0, wasteG: 0, expiry: expiryDateStr || undefined };
      }
      sourceByType[type].usageG += finalSourceUsageByMaterial[mat] ?? 0;
      sourceByType[type].wasteG += sourceWasteByMaterial[mat] ?? 0;
    }
    const doughAdditives: Record<string, { totalG: number; lotDisplay: string }> = {};
    const doughIngredients: Record<string, number> = {};
    if (daily.doughLog) {
      const dl = daily.doughLog;
      for (const [key, lines] of Object.entries(dl.덧가루덧기름 ?? {})) {
        const arr = Array.isArray(lines) ? lines : [];
        const totalG = arr.reduce((s, x) => s + (x?.사용량_g ?? 0), 0);
        const lotDisplay = arr.map((x) => x?.lot ?? "").filter(Boolean).join(", ") || "—";
        if (key) doughAdditives[key] = { totalG, lotDisplay };
      }
      for (const [key, lines] of Object.entries(dl.반죽원료 ?? {})) {
        const arr = Array.isArray(lines) ? lines : [];
        const totalG = arr.reduce((s, x) => s + (x?.사용량_g ?? 0), 0);
        if (key) doughIngredients[key] = totalG;
      }
    }
    let parbakeWoozooinQty = 0;
    let parbakeSalesQty = 0;
    const parbakeUsedBySource: Record<string, P1_ParbakeUsedLine[]> = {
      베샤멜: [],
      토마토: [],
      로제: [],
      바질: [],
    };
    for (const productName of productNames) {
      const calc = calcs.find(
        (c) => c.production_date === dateKey && c.product_name === productName
      );
      const firstLog = logs.find((l) => l.제품명 === productName);
      parbakeWoozooinQty += calc?.parbake_woozooin_qty ?? firstLog?.보관용파베이크 ?? 0;
      parbakeSalesQty += calc?.parbake_sales_qty ?? firstLog?.판매용파베이크 ?? 0;
      const sourceType = getParbakeSourceFromProduct(productName);
      const lines = firstLog?.파베이크사용_라인 ?? [];
      for (const l of lines) {
        if ((l.qty ?? 0) <= 0) continue;
        parbakeUsedBySource[sourceType] = parbakeUsedBySource[sourceType] ?? [];
        parbakeUsedBySource[sourceType].push({
          qty: l.qty ?? 0,
          lot: (l.expiry ?? "").trim() || "—",
        });
      }
    }

    const P1: P1_MasterData = {
      date: dateKey,
      totalDoughUsageQty,
      totalDoughWasteQty,
      totalParbakeAddQty,
      totalFinishedQty,
      totalParbakeWoozooinSalesQty,
      parbakeWasteQty,
      sourceWasteByMaterial,
      totalSourceUsageByMaterial,
      finalSourceUsageByMaterial,
      doughLog: daily.doughLog,
      productNames: productNamesStr,
      expiryDate: expiryDateStr,
      authors: authorsStr,
      finishedQtyDisplay: totalFinishedQty > 0 ? String(totalFinishedQty) : "",
      totalDoughQty: totalDoughUsageQty,
      parbakeProductionQty: totalParbakeWoozooinSalesQty,
      totalDoughUsage: totalDoughUsageEA,
      totalDoughWaste: totalDoughWasteQty,
      sourceByType,
      doughAdditives,
      doughIngredients,
      parbakeWoozooinQty,
      parbakeSalesQty,
      parbakeUsedBySource,
    };

    // ——— P2: 당일 원료별 총 실제 사용량 & 제품별 사용 원료 ———
    const materialToProducts = new Map<string, string[]>();
    const materialTotalUsage = new Map<string, number>();

    for (const productName of productNames) {
      const productLogs = logs.filter((l) => l.제품명 === productName);
      const productMaterials = Array.from(
        new Set(productLogs.map((l) => l.원료명).filter(Boolean))
      ) as string[];
      for (const materialName of productMaterials) {
        if (!materialToProducts.has(materialName)) {
          materialToProducts.set(materialName, []);
          materialTotalUsage.set(materialName, 0);
        }
        if (!materialToProducts.get(materialName)!.includes(productName)) {
          materialToProducts.get(materialName)!.push(productName);
        }
        const usage = getActualUsageByProductMaterial(
          dateKey,
          productName,
          materialName,
          logs,
          calcs
        );
        materialTotalUsage.set(
          materialName,
          (materialTotalUsage.get(materialName) ?? 0) + usage
        );
      }
    }

    // 공통 원료: 10자리 절삭(적은 쪽) + 나머지 몰빵(많은 쪽). 3개 이상이면 적은 순으로 절삭, 마지막에 나머지 몰빵
    const productMaterialAllocation = new Map<
      string,
      Map<string, number>
    >();
    for (const [materialName, products] of Array.from(materialToProducts.entries())) {
      const totalUsage = materialTotalUsage.get(materialName) ?? 0;
      if (products.length === 1) {
        const m = productMaterialAllocation.get(products[0]!) ?? new Map();
        m.set(materialName, totalUsage);
        productMaterialAllocation.set(products[0]!, m);
        continue;
      }
      // 2개 이상: 완제품 적은 순 정렬 → 앞쪽은 절삭, 마지막 제품이 나머지 몰빵
      const productQty = products.map((p) => {
        const q =
          calcs.find((c) => c.product_name === p)?.finished_qty_actual ??
          logs.find((l) => l.제품명 === p)?.완제품생산량 ??
          0;
        return { productName: p, finishedQty: q };
      });
      productQty.sort((a, b) => a.finishedQty - b.finishedQty);
      let allocatedSum = 0;
      for (let i = 0; i < productQty.length; i++) {
        const p = productQty[i]!;
        const bomRow = bom.find(
          (b) => b.productName === p.productName && b.materialName === materialName
        );
        const bomG = bomRow?.bomGPerEa ?? 0;
        const alloc =
          i < productQty.length - 1
            ? truncateTens(bomG * p.finishedQty)
            : Math.max(0, totalUsage - allocatedSum);
        allocatedSum += alloc;
        const m = productMaterialAllocation.get(p.productName) ?? new Map();
        m.set(materialName, alloc);
        productMaterialAllocation.set(p.productName, m);
      }
    }

    /** (productName, materialName) → 첫 LOT(소비기한) */
    const getLotForProductMaterial = (pName: string, mName: string): string => {
      const log = logs.find((l) => l.제품명 === pName && (l.원료명 ?? "") === mName);
      const line = log?.출고_라인?.[0];
      if (line?.소비기한?.trim()) return line.소비기한.trim();
      const calc = calcs.find((c) => c.production_date === dateKey && c.product_name === pName);
      const prior = calc?.materials_data?.[mName]?.prior_stock?.[0];
      if (prior?.expiry?.trim()) return prior.expiry.trim();
      const closing = calc?.materials_data?.[mName]?.closing_stock?.[0];
      if (closing?.expiry?.trim()) return closing.expiry.trim();
      return "";
    };

    // P2 배열 생성: 제품별 finishedQty + ingredients (BOM 기준, allocatedUsage_g·isShared·lot)
    const P2: P2_ProductData[] = productNames.map((productName) => {
      const finishedQty =
        calcs.find((c) => c.product_name === productName)?.finished_qty_actual ??
        logs.find((l) => l.제품명 === productName)?.완제품생산량 ??
        0;
      const productBom = bom.filter((b) => b.productName === productName);
      const allocMap = productMaterialAllocation.get(productName);
      const ingredients: P2_IngredientRow[] = productBom.map((row) => {
        const isShared = (materialToProducts.get(row.materialName)?.length ?? 0) > 1;
        const allocatedUsage_g = allocMap?.get(row.materialName) ?? 0;
        const lot = getLotForProductMaterial(productName, row.materialName);
        return {
          materialName: row.materialName,
          bomG: row.bomGPerEa,
          allocatedUsage_g,
          isShared,
          lot: lot || undefined,
        };
      });
      return { productName, finishedQty, ingredients };
    });

    return { daily, P1, P2 };
  }, [date, productionLogs, usageCalculations, doughLogsMap, bomList]);
}
