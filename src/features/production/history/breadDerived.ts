/**
 * 기준 "브레드" 제품: 도우 폐기(개) × 해당 제품 BOM → 원료 폐기 g, FIFO 차감
 */

import type {
  DateGroupInput,
  BomRowRef,
  ComputedResult,
  LotUsageRow,
} from "./types";
import { getBomRowsForProductAndStandard } from "./bomAdapter";
import {
  allocateIntByWeight,
  applyIngredientWasteFifo,
  type IngredientWasteLotRow,
} from "./wasteFifo";

const BREAD_STANDARD = "브레드";

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
      w.wasteQty
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

export function getBreadBomRows(
  baseProductName: string,
  bomList: BomRowRef[]
): BomRowRef[] {
  return getBomRowsForProductAndStandard(
    baseProductName,
    BREAD_STANDARD,
    bomList
  );
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
