/**
 * 원료 폐기량을 LOT 실사 사용량에 FIFO(소비기한 오름차순)로 차감.
 */

import type { LotUsageRow } from "./types";

export type IngredientWasteLotRow = {
  lotRowId: string;
  expiryDate: string;
  actualUsageQty: number;
  wasteDeductedQty: number;
  finalUsageQty: number;
};

export function applyIngredientWasteFifo(
  lotUsages: LotUsageRow[],
  materialName: string,
  totalWasteQty: number
): IngredientWasteLotRow[] {
  const lots = lotUsages
    .filter((l) => (l.materialName ?? "").trim() === materialName)
    .map((l) => ({ ...l }))
    .sort((a, b) => (a.expiryDate || "").localeCompare(b.expiryDate || ""));

  if (lots.length === 0) {
    return [];
  }

  let remainingWaste = totalWasteQty;
  return lots.map((l) => {
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
}

/** 가중치 비율로 정수 총량을 제품(행)별 배분. 합계가 total과 일치하도록 보정 */
export function allocateIntByWeight(total: number, weights: number[]): number[] {
  if (total <= 0) return weights.map(() => 0);
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (sum <= 0) return weights.map(() => 0);

  const raw = weights.map((w) => (total * Math.max(0, w)) / sum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = total - floors.reduce((s, n) => s + n, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - floors[i]! }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (let k = 0; k < remainder; k++) {
    out[order[k % order.length]!.i]! += 1;
  }
  return out;
}
