import type { PlanningEntryRow } from "./types";
import { baseProductName } from "./calculations";
import { classifyProductBaseName } from "./productClassification";

export type UnclassifiedBaseRow = { base: string; monthQty: number };

/**
 * 월간 계획에서 분류되지 않은 베이스 제품명과 해당 월 합계 수량.
 * 실사용 검수 시 productClassification.ts 에 베이스명을 추가할 때 참고한다.
 */
export function listUnclassifiedProductBases(entries: PlanningEntryRow[]): UnclassifiedBaseRow[] {
  const byBase = new Map<string, number>();
  for (const e of entries) {
    const qty = Number(e.qty) || 0;
    if (qty <= 0) continue;
    const base = baseProductName(e.product_name_snapshot);
    if (!base.trim()) continue;
    if (classifyProductBaseName(base).major !== "unclassified") continue;
    byBase.set(base, (byBase.get(base) ?? 0) + qty);
  }
  return Array.from(byBase.entries())
    .map(([base, monthQty]) => ({ base, monthQty }))
    .sort((a, b) => b.monthQty - a.monthQty || a.base.localeCompare(b.base, "ko"));
}
