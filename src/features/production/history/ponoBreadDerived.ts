/**
 * 포노부오노 시그니처 화덕 브레드 전용 파생 계산
 * - 적용 조건: 당일 도우 사용 제품이 포노브레드 1개뿐일 때만
 * - breadDoughUsageQty, breadWasteQty, 원료 폐기량, FIFO 차감, 최종 원료 사용량
 */

import type {
  DateGroupInput,
  BomRowRef,
  ComputedResult,
  LotUsageRow,
} from "./types";
import { getBomRowsForProductAndStandard } from "./bomAdapter";

const PONO_BREAD_BASE_NAME = "포노부오노 시그니처 화덕 브레드";
const PONO_BREAD_STANDARD = "브레드";

export type PonoBreadIngredientWasteRow = {
  materialName: string;
  wasteQty: number;
  bomGPerEa: number;
};

export type PonoBreadLotRow = {
  lotRowId: string;
  expiryDate: string;
  actualUsageQty: number;
  wasteDeductedQty: number;
  finalUsageQty: number;
};

export type PonoBreadIngredientUsageRow = {
  materialName: string;
  actualUsageQty: number;
  wasteQty: number;
  finalUsageQty: number;
  lots: PonoBreadLotRow[];
};

export type PonoBreadDerived = {
  applicable: boolean;
  reason?: string;
  breadProductKey?: string;
  breadProductLabel?: string;
  doughMixQty?: number;
  doughWasteQty?: number;
  breadDoughUsageQty?: number;
  finishedQty?: number;
  breadWasteQty?: number;
  breadWasteNegative?: boolean;
  ingredientWasteRows?: PonoBreadIngredientWasteRow[];
  ingredientUsageRows?: PonoBreadIngredientUsageRow[];
};

/** 포노브레드 BOM 행 조회 (제품 기준 "브레드") */
export function getPonoBreadBomRows(bomList: BomRowRef[]): BomRowRef[] {
  return getBomRowsForProductAndStandard(
    PONO_BREAD_BASE_NAME,
    PONO_BREAD_STANDARD,
    bomList
  );
}

/**
 * 원료 폐기량을 해당 원료 LOT들에 FIFO(소비기한 오름차순)로 차감.
 * 반환: 각 LOT별 wasteDeductedQty, finalUsageQty
 */
export function applyIngredientWasteFifo(
  lotUsages: LotUsageRow[],
  materialName: string,
  totalWasteQty: number
): PonoBreadLotRow[] {
  const lots = lotUsages
    .filter((l) => (l.materialName ?? "").trim() === materialName)
    .map((l) => ({ ...l }))
    .sort((a, b) => (a.expiryDate || "").localeCompare(b.expiryDate || ""));

  if (lots.length === 0) {
    return [];
  }

  let remainingWaste = totalWasteQty;
  const result: PonoBreadLotRow[] = lots.map((l) => {
    const deduct = Math.max(0, Math.min(remainingWaste, l.actualUsageQty));
    remainingWaste -= deduct;
    const finalUsageQty = Math.max(0, l.actualUsageQty - deduct);
    return {
      lotRowId: l.lotRowId,
      expiryDate: l.expiryDate,
      actualUsageQty: l.actualUsageQty,
      wasteDeductedQty: deduct,
      finalUsageQty,
    };
  });
  return result;
}

/**
 * 포노브레드 전용 파생 계산.
 * 적용 조건: productSummaries 중 baseProductName + productStandardName 일치하는 제품이 있고,
 * usesTodayDough === true 인 제품이 그 1개뿐일 때만.
 */
export function calculatePonoBreadDerived(
  _dateGroup: DateGroupInput,
  computedResult: ComputedResult,
  bomList: BomRowRef[]
): PonoBreadDerived {
  const { productSummaries, lotUsages, doughMixQty, doughWasteQty } = computedResult;

  const ponoBread = productSummaries.find(
    (p) =>
      (p.baseProductName ?? "").trim() === PONO_BREAD_BASE_NAME &&
      (p.productStandardName ?? "").trim() === PONO_BREAD_STANDARD
  );

  const directDoughProducts = productSummaries.filter((p) => p.usesTodayDough);

  if (!ponoBread) {
    return {
      applicable: false,
      reason: "해당 날짜에 포노부오노 시그니처 화덕 브레드(브레드) 제품이 없습니다.",
    };
  }

  if (directDoughProducts.length !== 1 || directDoughProducts[0]!.productKey !== ponoBread.productKey) {
    return {
      applicable: false,
      reason: "당일 도우 사용 제품이 여러 개여서 포노브레드 전용 계산은 적용되지 않았습니다.",
      breadProductKey: ponoBread.productKey,
      breadProductLabel: ponoBread.displayProductLabel,
    };
  }

  const breadDoughUsageQty = doughMixQty - doughWasteQty;
  const finishedQty = ponoBread.finishedQty ?? 0;
  let breadWasteQty = breadDoughUsageQty - finishedQty;
  const breadWasteNegative = breadWasteQty < 0;
  if (breadWasteNegative) {
    breadWasteQty = 0;
  }

  const bomRows = getPonoBreadBomRows(bomList);
  if (bomRows.length === 0) {
    return {
      applicable: true,
      breadProductKey: ponoBread.productKey,
      breadProductLabel: ponoBread.displayProductLabel,
      doughMixQty,
      doughWasteQty,
      breadDoughUsageQty,
      finishedQty,
      breadWasteQty,
      breadWasteNegative,
      reason: breadWasteNegative
        ? "브레드 폐기량이 음수로 나왔습니다. 입력값을 확인해 주세요."
        : undefined,
      ingredientWasteRows: [],
      ingredientUsageRows: [],
    };
  }

  const ingredientWasteRows: PonoBreadIngredientWasteRow[] = bomRows.map((r) => ({
    materialName: (r.materialName ?? "").trim(),
    wasteQty: Math.round(breadWasteQty * (r.bomGPerEa ?? 0)),
    bomGPerEa: r.bomGPerEa ?? 0,
  }));

  const ingredientUsageRows: PonoBreadIngredientUsageRow[] = ingredientWasteRows.map(
    (w) => {
      const lots = applyIngredientWasteFifo(
        lotUsages,
        w.materialName,
        w.wasteQty
      );
      const actualUsageQty = lots.reduce((s, l) => s + l.actualUsageQty, 0);
      const wasteQty = w.wasteQty;
      const finalUsageQty = Math.max(0, actualUsageQty - wasteQty);
      return {
        materialName: w.materialName,
        actualUsageQty,
        wasteQty,
        finalUsageQty,
        lots,
      };
    }
  );

  return {
    applicable: true,
    breadProductKey: ponoBread.productKey,
    breadProductLabel: ponoBread.displayProductLabel,
    doughMixQty,
    doughWasteQty,
    breadDoughUsageQty,
    finishedQty,
    breadWasteQty,
    breadWasteNegative,
    reason: breadWasteNegative
      ? "브레드 폐기량이 음수로 나왔습니다. 입력값을 확인해 주세요."
      : undefined,
    ingredientWasteRows,
    ingredientUsageRows,
  };
}
