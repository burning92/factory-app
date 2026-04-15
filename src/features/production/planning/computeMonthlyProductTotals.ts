import type { PlanningEntryRow } from "./types";
import { baseProductName, productKindFromSnapshot } from "./calculations";
import {
  categoryBadgeLabel,
  classifyPlanningSnapshotForRollup,
  classifyProductBaseName,
  formatMiniPlanningLabel,
  isMiniProductKind,
  rollupQtyForPlanning,
  type ProductClassification,
} from "./productClassification";

/** 집계 행 구분: 미니만 별도 행, 일반·파베이크 등 그 외 조건은 같은 베이스로 합산 */
const MINI_GROUP_SUFFIX = "::MINI";

function groupKeyFromSnapshot(snapshot: string): string | null {
  const base = baseProductName(snapshot);
  if (!base.trim()) return null;
  const kind = productKindFromSnapshot(snapshot);
  if (isMiniProductKind(kind)) return `${base}${MINI_GROUP_SUFFIX}`;
  return base;
}

function parseProductGroupKey(key: string): { baseName: string; isMiniVariant: boolean } {
  if (key.endsWith(MINI_GROUP_SUFFIX)) {
    return { baseName: key.slice(0, -MINI_GROUP_SUFFIX.length), isMiniVariant: true };
  }
  return { baseName: key, isMiniVariant: false };
}

export type MonthlyProductTotalRow = {
  /** 행·React key (미니 행은 베이스와 다른 값) */
  groupKey: string;
  /** 베이스 제품명 */
  baseName: string;
  /** 미니 전용 행 여부 */
  isMiniVariant: boolean;
  /** 표시용 제품명 */
  displayName: string;
  monthQty: number;
  classification: ProductClassification;
  badgeLabel: string;
  /** 하위 호환: groupKey 와 동일 */
  productBase: string;
};

/**
 * 월 합계: 같은 베이스에서 일반·파베이크(및 미니 제외 조건)는 한 줄로, 미니는 별도 줄.
 */
export function computeMonthlyProductTotals(entries: PlanningEntryRow[]): MonthlyProductTotalRow[] {
  const byKey = new Map<string, number>();
  for (const e of entries) {
    const snap = e.product_name_snapshot.trim();
    const qty = rollupQtyForPlanning(snap, e.qty);
    if (qty <= 0) continue;
    const key = groupKeyFromSnapshot(e.product_name_snapshot);
    if (!key) continue;
    byKey.set(key, (byKey.get(key) ?? 0) + qty);
  }

  const rows: MonthlyProductTotalRow[] = Array.from(byKey.entries()).map(([groupKey, monthQty]) => {
    const { baseName, isMiniVariant } = parseProductGroupKey(groupKey);
    const c: ProductClassification = isMiniVariant
      ? classifyPlanningSnapshotForRollup(`${baseName} - 미니`)
      : classifyProductBaseName(baseName);
    const displayName = isMiniVariant ? formatMiniPlanningLabel(baseName) : baseName;
    return {
      groupKey,
      baseName,
      isMiniVariant,
      displayName,
      monthQty,
      classification: c,
      badgeLabel: categoryBadgeLabel(c),
      productBase: groupKey,
    };
  });

  return rows.sort(
    (a, b) =>
      b.monthQty - a.monthQty ||
      a.baseName.localeCompare(b.baseName, "ko") ||
      (a.isMiniVariant === b.isMiniVariant ? 0 : a.isMiniVariant ? 1 : -1)
  );
}
