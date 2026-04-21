import type { HarangCategory } from "@/features/harang/types";
import type { Profile } from "@/types/auth";

export type HarangProductionRequestStatus =
  | "pending"
  | "shortage"
  | "in_progress"
  | "completed"
  | "settled"
  | "cancelled";

export const STATUS_LABEL: Record<HarangProductionRequestStatus, string> = {
  pending: "대기",
  shortage: "자재부족",
  in_progress: "진행중",
  completed: "완료",
  settled: "종결",
  cancelled: "취소",
};

export type MaterialKey = `${HarangCategory}:${string}`;

export function materialKey(category: HarangCategory, itemId: string): MaterialKey {
  return `${category}:${itemId}`;
}

/** 본사(100) 생산요청 등록·취소 등 (manager·headquarters·admin, worker 제외) */
export function canManageHqHarangProductionRequests(
  organizationCode: string | null | undefined,
  role: Profile["role"] | null | undefined,
): boolean {
  if (organizationCode === "000" && role === "admin") return true;
  return organizationCode === "100" && (role === "manager" || role === "headquarters" || role === "admin");
}

/** 하랑(200) 생산 반영 UI (manager·worker·assistant_manager). admin은 별도로 항상 허용하는 쪽에서 처리 */
export function canApplyHarangProductionRequestLine(
  organizationCode: string | null | undefined,
  role: Profile["role"] | null | undefined,
): boolean {
  if (role === "admin") return true;
  return organizationCode === "200" && (role === "manager" || role === "worker" || role === "assistant_manager");
}

/** 품목별 현재고 합계 (LOT 합산) */
export function sumStockByMaterial(
  lots: Array<{ category: HarangCategory; item_id: string; current_quantity: number | string | null }>,
): Map<MaterialKey, number> {
  const m = new Map<MaterialKey, number>();
  for (const l of lots) {
    const k = materialKey(l.category, l.item_id);
    const q = Number(l.current_quantity ?? 0);
    m.set(k, (m.get(k) ?? 0) + q);
  }
  return m;
}

export function computeLineMaterialDisplay(params: {
  need: number;
  stock: number;
  totalReserved: number;
  lineReserved: number;
}): {
  need: number;
  stock: number;
  reservedTotal: number;
  reservedLine: number;
  availableGlobal: number;
  shortage: number;
} {
  const { need, stock, totalReserved, lineReserved } = params;
  const rOther = totalReserved - lineReserved;
  const availOther = stock - rOther;
  const shortage = need > Math.max(availOther, 0) ? need - Math.max(availOther, 0) : 0;
  const availableGlobal = stock - totalReserved;
  return {
    need,
    stock,
    reservedTotal: totalReserved,
    reservedLine: lineReserved,
    availableGlobal,
    shortage,
  };
}
