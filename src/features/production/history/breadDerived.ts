/**
 * 기준 "브레드" 제품: 도우 폐기(개) × 해당 제품 BOM → 원료 폐기 g, FIFO 차감
 */

import type {
  DateGroupInput,
  BomRowRef,
  ComputedResult,
  LotUsageRow,
} from "./types";
import {
  bomProductMatchesBaseProduct,
  getBomRowsForProductAndStandard,
} from "./bomAdapter";
import {
  allocateIntByWeight,
  applyIngredientWasteFifo,
  type IngredientWasteLotRow,
} from "./wasteFifo";

const BREAD_STANDARD = "브레드";

/**
 * BOM 원료명 ↔ 1차 마감 레거시 원료명 (재고연동 코드 동일 계열)
 * @see 원료 마스터: 그라나파다노파우더 캔 / 브레드 그라나파다노캔 (yy2030) 등
 */
export const BREAD_MATERIAL_LOT_ALIASES: Record<string, string[]> = {
  "브레드 그라나파다노캔": ["그라나파다노파우더 캔", "그라나파다노파우더 팩"],
  "브레드 그라나파다노파우더": ["그라나파다노파우더 팩", "그라나파다노파우더 캔"],
  "브레드 리코타치즈": ["리코타치즈"],
  "브레드 잡화맛청": ["잡화맛청"],
  "브레드 바질소스": ["바질소스WB-1", "바질소스"],
  "그라나파다노파우더 캔": ["브레드 그라나파다노캔"],
  "그라나파다노파우더 팩": ["브레드 그라나파다노파우더"],
  "리코타치즈": ["브레드 리코타치즈"],
  "잡화맛청": ["브레드 잡화맛청"],
  "바질소스WB-1": ["브레드 바질소스"],
};

export function getBreadMaterialLotAliases(materialName: string): string[] {
  return BREAD_MATERIAL_LOT_ALIASES[(materialName ?? "").trim()] ?? [];
}

export type BreadIngredientWasteRow = {
  materialName: string;
  wasteQty: number;
  bomGPerEa: number;
};

export type BreadIngredientUsageRow = {
  materialName: string;
  actualUsageQty: number;
  wasteQty: number;
  finalUsageQty: number;
  lots: IngredientWasteLotRow[];
};

export type BreadProductDerived = {
  productKey: string;
  displayProductLabel: string;
  baseProductName: string;
  finishedQty: number;
  breadWasteQty: number;
  breadDoughUsageQty: number;
  ingredientWasteRows: BreadIngredientWasteRow[];
  ingredientUsageRows: BreadIngredientUsageRow[];
};

export type BreadDerived = {
  applicable: boolean;
  reason?: string;
  breadWasteNegative?: boolean;
  totalBreadWasteQty?: number;
  totalBreadFinishedQty?: number;
  products: BreadProductDerived[];
};

function buildIngredientUsageRows(
  lotUsages: LotUsageRow[],
  ingredientWasteRows: BreadIngredientWasteRow[]
): BreadIngredientUsageRow[] {
  return ingredientWasteRows.map((w) => {
    const lots = applyIngredientWasteFifo(
      lotUsages,
      w.materialName,
      w.wasteQty,
      getBreadMaterialLotAliases(w.materialName)
    );
    const actualUsageQty = lots.reduce((s, l) => s + l.actualUsageQty, 0);
    return {
      materialName: w.materialName,
      actualUsageQty,
      wasteQty: w.wasteQty,
      finalUsageQty: Math.max(0, actualUsageQty - w.wasteQty),
      lots,
    };
  });
}

/** 브레드 폐기 g 환산용 BOM — 도우(베이스소스) 행 제외 */
function excludeDoughBasisRows(rows: BomRowRef[]): BomRowRef[] {
  return rows.filter((r) => (r.basis ?? "").trim() !== "도우");
}

/** materialName 기준 병합 — 뒤에 오는 행이 같은 원료명이면 덮어씀 */
function mergeBomRowsByMaterial(...groups: BomRowRef[][]): BomRowRef[] {
  const map = new Map<string, BomRowRef>();
  for (const group of groups) {
    for (const r of group) {
      const name = (r.materialName ?? "").trim();
      if (!name) continue;
      map.set(name, r);
    }
  }
  return Array.from(map.values());
}

/**
 * 브레드 BOM: 레거시 "일반" + 신규 "브레드" 기준을 합침.
 * (브레드 기준만 일부 등록된 경우에도 예전 일반 완제품 원료가 빠지지 않도록)
 */
export function getBreadBomRows(
  baseProductName: string,
  bomList: BomRowRef[]
): BomRowRef[] {
  const base = (baseProductName ?? "").trim();
  if (!base) return [];

  const fromGeneral = excludeDoughBasisRows(
    getBomRowsForProductAndStandard(base, "일반", bomList)
  );
  const fromBread = excludeDoughBasisRows(
    getBomRowsForProductAndStandard(base, BREAD_STANDARD, bomList)
  );
  const fromLegacy = excludeDoughBasisRows(
    bomList.filter((b) => bomProductMatchesBaseProduct(b.productName, base))
  );

  const merged = mergeBomRowsByMaterial(fromGeneral, fromLegacy, fromBread);
  return merged;
}

export function calculateBreadDerived(
  _dateGroup: DateGroupInput,
  computedResult: ComputedResult,
  bomList: BomRowRef[]
): BreadDerived {
  const {
    productSummaries,
    lotUsages,
    doughMixQty,
    doughWasteQty,
    breadWasteQty: totalBreadWasteQty,
    generalDoughFinishedQty,
  } = computedResult;

  const breadProducts = productSummaries.filter((p) => p.isBreadProduct);
  if (breadProducts.length === 0) {
    return {
      applicable: false,
      reason: '해당 날짜에 브레드(기준) 제품이 없습니다.',
      products: [],
    };
  }

  const totalBreadFinished = breadProducts.reduce(
    (s, p) => s + (p.finishedQty ?? 0),
    0
  );
  const rawBreadWaste =
    doughMixQty -
    doughWasteQty -
    totalBreadFinished -
    (generalDoughFinishedQty ?? 0);
  const breadWasteNegative = rawBreadWaste < 0;
  const resolvedTotalWaste =
    totalBreadWasteQty ?? Math.max(0, rawBreadWaste);

  const weights = breadProducts.map((p) => p.finishedQty ?? 0);
  const allocatedWastes = allocateIntByWeight(resolvedTotalWaste, weights);

  const products: BreadProductDerived[] = breadProducts.map((p, i) => {
    const finishedQty = p.finishedQty ?? 0;
    const breadWasteQty = allocatedWastes[i] ?? 0;
    const breadDoughUsageQty = Math.max(
      0,
      finishedQty + breadWasteQty
    );
    const bomRows = getBreadBomRows(p.baseProductName ?? "", bomList);
    const ingredientWasteRows: BreadIngredientWasteRow[] = bomRows.map(
      (r) => ({
        materialName: (r.materialName ?? "").trim(),
        wasteQty: Math.round(breadWasteQty * (r.bomGPerEa ?? 0)),
        bomGPerEa: r.bomGPerEa ?? 0,
      })
    );
    return {
      productKey: p.productKey,
      displayProductLabel: p.displayProductLabel,
      baseProductName: (p.baseProductName ?? p.displayProductLabel).trim(),
      finishedQty,
      breadWasteQty,
      breadDoughUsageQty,
      ingredientWasteRows,
      ingredientUsageRows: buildIngredientUsageRows(
        lotUsages,
        ingredientWasteRows
      ),
    };
  });

  return {
    applicable: true,
    breadWasteNegative,
    totalBreadWasteQty: resolvedTotalWaste,
    totalBreadFinishedQty: totalBreadFinished,
    reason: breadWasteNegative
      ? "브레드 폐기량이 음수로 나왔습니다. 입력값을 확인해 주세요."
      : undefined,
    products,
  };
}

/** 제품 키로 브레드 파생 행 조회 */
export function findBreadProductDerived(
  derived: BreadDerived | null,
  productKey: string
): BreadProductDerived | undefined {
  return derived?.products.find((p) => p.productKey === productKey);
}
