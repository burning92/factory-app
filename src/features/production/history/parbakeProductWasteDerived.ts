/**
 * 파베이크 폐기(개) × 파베이크사용·당일도우 피자 BOM(완제품 기준) → 토핑/치즈 폐기 g
 * (도우 소스는 BOM에 없으면 제외 — 베이스 소스 폐기는 calculateBaseWasteRows 별도)
 */

import type {
  DateGroupInput,
  BomRowRef,
  ComputedResult,
  ProductSummary,
} from "./types";
import { isStoredParbakeOnlyDay } from "./calculations";
import { getBomRowsForProductAndStandard } from "./bomAdapter";
import {
  allocateIntByWeight,
  applyIngredientWasteFifo,
  type IngredientWasteLotRow,
} from "./wasteFifo";

export type ParbakeIngredientWasteRow = {
  materialName: string;
  wasteQty: number;
  bomGPerEa: number;
};

export type ParbakeIngredientUsageRow = {
  materialName: string;
  actualUsageQty: number;
  wasteQty: number;
  finalUsageQty: number;
  lots: IngredientWasteLotRow[];
};

export type ParbakeProductDerived = {
  productKey: string;
  displayProductLabel: string;
  baseProductName: string;
  productStandardName: string;
  finishedQty: number;
  parbakeWasteQty: number;
  ingredientWasteRows: ParbakeIngredientWasteRow[];
  ingredientUsageRows: ParbakeIngredientUsageRow[];
};

export type ParbakeProductWasteDerived = {
  applicable: boolean;
  reason?: string;
  totalParbakeWasteQty?: number;
  products: ParbakeProductDerived[];
};

/** 파베이크사용(보관 파베이크) 제품만 — 일반(당일 도우)은 베이스 소스 폐기 경로 */
function isParbakeWasteProduct(p: ProductSummary): boolean {
  return p.usesStoredParbake && !p.isBreadProduct;
}

function getFinishedProductBomRows(
  baseProductName: string,
  productStandardName: string,
  bomList: BomRowRef[]
): BomRowRef[] {
  return getBomRowsForProductAndStandard(
    baseProductName,
    productStandardName,
    bomList
  ).filter((r) => (r.basis ?? "").trim() !== "도우");
}

function buildIngredientUsageRows(
  lotUsages: ComputedResult["lotUsages"],
  ingredientWasteRows: ParbakeIngredientWasteRow[]
): ParbakeIngredientUsageRow[] {
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

export function calculateParbakeProductWasteDerived(
  _dateGroup: DateGroupInput,
  computedResult: ComputedResult,
  bomList: BomRowRef[]
): ParbakeProductWasteDerived {
  const { productSummaries, lotUsages, parbakeWasteQty, doughMixQty } =
    computedResult;
  const candidates = productSummaries.filter(isParbakeWasteProduct);

  if (
    isStoredParbakeOnlyDay(productSummaries) &&
    (doughMixQty ?? 0) === 0
  ) {
    return {
      applicable: false,
      reason:
        "파베이크사용만(당일 반죽 없음): 재고 파베이크 잔량은 토핑·치즈 원료 폐기로 환산하지 않습니다.",
      products: [],
    };
  }

  if (parbakeWasteQty <= 0 || candidates.length === 0) {
    return {
      applicable: false,
      reason:
        parbakeWasteQty <= 0
          ? "당일 파베이크 폐기량이 없어 토핑·치즈 폐기를 계산하지 않습니다."
          : "파베이크·피자 완제품이 없습니다.",
      products: [],
    };
  }

  const weights = candidates.map((p) => p.finishedQty ?? 0);
  const allocated = allocateIntByWeight(parbakeWasteQty, weights);

  const products: ParbakeProductDerived[] = candidates.map((p, i) => {
    const standard = (p.productStandardName ?? "").trim() || "일반";
    const wasteUnits = allocated[i] ?? 0;
    const bomRows = getFinishedProductBomRows(
      p.baseProductName ?? "",
      standard,
      bomList
    );
    const ingredientWasteRows: ParbakeIngredientWasteRow[] = bomRows.map(
      (r) => ({
        materialName: (r.materialName ?? "").trim(),
        wasteQty: Math.round(wasteUnits * (r.bomGPerEa ?? 0)),
        bomGPerEa: r.bomGPerEa ?? 0,
      })
    );
    return {
      productKey: p.productKey,
      displayProductLabel: p.displayProductLabel,
      baseProductName: (p.baseProductName ?? p.displayProductLabel).trim(),
      productStandardName: standard,
      finishedQty: p.finishedQty ?? 0,
      parbakeWasteQty: wasteUnits,
      ingredientWasteRows,
      ingredientUsageRows: buildIngredientUsageRows(
        lotUsages,
        ingredientWasteRows
      ),
    };
  });

  const hasAnyWaste = products.some((p) =>
    p.ingredientWasteRows.some((r) => r.wasteQty > 0)
  );

  return {
    applicable: hasAnyWaste,
    totalParbakeWasteQty: parbakeWasteQty,
    products,
  };
}

export function findParbakeProductDerived(
  derived: ParbakeProductWasteDerived | null,
  productKey: string
): ParbakeProductDerived | undefined {
  return derived?.products.find((p) => p.productKey === productKey);
}
