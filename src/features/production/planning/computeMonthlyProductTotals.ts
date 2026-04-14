import type { PlanningEntryRow } from "./types";
import { baseProductName } from "./calculations";
import { categoryBadgeLabel, classifyProductBaseName, type ProductClassification } from "./productClassification";

export type MonthlyProductTotalRow = {
  /** 집계 키(베이스명) */
  productBase: string;
  /** 표시용(베이스와 동일, 추후 별칭 가능) */
  displayName: string;
  monthQty: number;
  classification: ProductClassification;
  badgeLabel: string;
};

/**
 * 베이스 제품명별 월 합계, 수량 내림차순.
 */
export function computeMonthlyProductTotals(entries: PlanningEntryRow[]): MonthlyProductTotalRow[] {
  const byBase = new Map<string, number>();
  for (const e of entries) {
    const qty = Number(e.qty) || 0;
    if (qty <= 0) continue;
    const base = baseProductName(e.product_name_snapshot);
    if (!base.trim()) continue;
    byBase.set(base, (byBase.get(base) ?? 0) + qty);
  }

  const rows: MonthlyProductTotalRow[] = Array.from(byBase.entries()).map(([productBase, monthQty]) => {
    const c = classifyProductBaseName(productBase);
    return {
      productBase,
      displayName: productBase,
      monthQty,
      classification: c,
      badgeLabel: categoryBadgeLabel(c),
    };
  });

  return rows.sort((a, b) => b.monthQty - a.monthQty || a.displayName.localeCompare(b.displayName, "ko"));
}
