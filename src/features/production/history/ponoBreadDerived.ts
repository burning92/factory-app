/**
 * @deprecated calculateBreadDerived 사용. 시그니처 포노브레드 하위 호환용.
 */

import type {
  DateGroupInput,
  BomRowRef,
  ComputedResult,
} from "./types";
import {
  calculateBreadDerived,
  getBreadBomRows,
  type BreadIngredientUsageRow,
  type BreadIngredientWasteRow,
} from "./breadDerived";
import { applyIngredientWasteFifo } from "./wasteFifo";

export type PonoBreadIngredientWasteRow = BreadIngredientWasteRow;
export type PonoBreadLotRow = BreadIngredientUsageRow["lots"][number];
export type PonoBreadIngredientUsageRow = BreadIngredientUsageRow;

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

const PONO_BREAD_BASE_NAME = "포노부오노 시그니처 화덕 브레드";

export { applyIngredientWasteFifo };

/** @deprecated getBreadBomRows(base, bom) 사용 */
export function getPonoBreadBomRows(bomList: BomRowRef[]) {
  return getBreadBomRows(PONO_BREAD_BASE_NAME, bomList);
}

/** @deprecated calculateBreadDerived 사용 */
export function calculatePonoBreadDerived(
  dateGroup: DateGroupInput,
  computedResult: ComputedResult,
  bomList: BomRowRef[]
): PonoBreadDerived {
  const all = calculateBreadDerived(dateGroup, computedResult, bomList);
  const pono = all.products.find(
    (p) => p.baseProductName === PONO_BREAD_BASE_NAME
  );
  if (!pono) {
    return {
      applicable: false,
      reason: all.reason ?? "해당 날짜에 포노부오노 시그니처 화덕 브레드(브레드) 제품이 없습니다.",
    };
  }
  if (!all.applicable) {
    return { applicable: false, reason: all.reason };
  }
  return {
    applicable: true,
    breadProductKey: pono.productKey,
    breadProductLabel: pono.displayProductLabel,
    doughMixQty: computedResult.doughMixQty,
    doughWasteQty: computedResult.doughWasteQty,
    breadDoughUsageQty: pono.breadDoughUsageQty,
    finishedQty: pono.finishedQty,
    breadWasteQty: pono.breadWasteQty,
    breadWasteNegative: all.breadWasteNegative,
    reason: all.reason,
    ingredientWasteRows: pono.ingredientWasteRows,
    ingredientUsageRows: pono.ingredientUsageRows,
  };
}
