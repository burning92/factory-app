import type { PlanningEntryRow } from "./types";
import {
  classifyPlanningSnapshotForRollup,
  rollupQtyForPlanning,
  type ProductClassification,
} from "./productClassification";

export type MonthlyCategoryRollup = {
  /** 피자(라이트+헤비+미니), 미분류 제외 */
  pizzaQty: number;
  parbakeStorageQty: number;
  parbakeSaleQty: number;
  breadQty: number;
  unclassifiedQty: number;
  totalQty: number;
  pizzaLight: number;
  pizzaHeavy: number;
  pizzaMini: number;
  /** 라이트+헤비+미니 */
  pizzaSum: number;
  parbakeTotal: number;
};

function addQty(roll: MonthlyCategoryRollup, c: ProductClassification, qty: number): void {
  roll.totalQty += qty;
  if (c.major === "unclassified") {
    roll.unclassifiedQty += qty;
    return;
  }
  if (c.major === "bread") {
    roll.breadQty += qty;
    return;
  }
  if (c.major === "parbake_storage") {
    roll.parbakeStorageQty += qty;
    roll.parbakeTotal += qty;
    return;
  }
  if (c.major === "parbake_sale") {
    roll.parbakeSaleQty += qty;
    roll.parbakeTotal += qty;
    return;
  }
  if (c.major === "pizza") {
    roll.pizzaQty += qty;
    roll.pizzaSum += qty;
    if (c.pizzaSubtype === "light") roll.pizzaLight += qty;
    else if (c.pizzaSubtype === "heavy") roll.pizzaHeavy += qty;
    else if (c.pizzaSubtype === "mini") roll.pizzaMini += qty;
    // pizzaSubtype 이 null 인 피자는 pizzaQty/pizzaSum 에만 잡히고 라이트/헤비/미니 소계에는 안 잡힘 → productClassification 에 서브타입 보강 권장
  }
}

/**
 * 월간 계획 행을 제품 베이스 기준으로 분류 합산한다.
 */
export function computeMonthlyCategoryTotals(entries: PlanningEntryRow[]): MonthlyCategoryRollup {
  const roll: MonthlyCategoryRollup = {
    pizzaQty: 0,
    parbakeStorageQty: 0,
    parbakeSaleQty: 0,
    breadQty: 0,
    unclassifiedQty: 0,
    totalQty: 0,
    pizzaLight: 0,
    pizzaHeavy: 0,
    pizzaMini: 0,
    pizzaSum: 0,
    parbakeTotal: 0,
  };

  for (const e of entries) {
    const snap = e.product_name_snapshot.trim();
    const qty = rollupQtyForPlanning(snap, e.qty);
    if (qty <= 0) continue;
    const c = classifyPlanningSnapshotForRollup(snap);
    addQty(roll, c, qty);
  }

  return roll;
}
