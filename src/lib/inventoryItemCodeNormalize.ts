/**
 * Lab / admin 전용: 이카운트 item_code·materials.inventory_item_code 정규화.
 * (운영용 planning/purchasing 계산 모듈과 import 하지 않음 — 규칙만 동일하게 유지)
 */
export function normalizeInventoryItemCode(code: string | null | undefined): string {
  return String(code ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}
