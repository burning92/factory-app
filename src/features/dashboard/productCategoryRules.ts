/**
 * 대시보드 생산량 분류 규칙. 제품 추가 시 이 배열만 확장하면 됨.
 * 매칭: 표시 라벨(출고/2차마감 제품명)을 NFKC·소문자 정규화 후 includes.
 */

/** 라이트 피자 — 마르게리따, 허니고르곤졸라 등 */
export const DASHBOARD_LIGHT_PIZZA_MARKERS = [
  "마르게리따",
  "마르게리타",
  "허니고르곤졸라",
  "허니고르곤",
] as const;

/** 브레드 — 포노부오노·포노브레드 등 (시트 '포노' 열과 동일 계열) */
export const DASHBOARD_BREAD_MARKERS = [
  "포노부오노",
  "도노부오노",
  "포노브레드",
  "포노 브레드",
  "시그니처 화덕 브레드",
  "화덕 브레드",
] as const;

export function normalizeDashboardLabel(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

export function matchesAnyMarker(normalized: string, markers: readonly string[]): boolean {
  for (const m of markers) {
    if (normalized.includes(normalizeDashboardLabel(m))) return true;
  }
  return false;
}

export type DashboardProductBucket = "light_pizza" | "heavy_pizza" | "bread" | "other";

/**
 * 2차마감에서 '우주인 파베이크'를 완제품 수량으로만 넣은 경우(필드 astronautParbakeQty 비어 있음).
 * 이 라벨은 라이트/헤비/브레드/기타 완제품 합계에서 제외하고, 우주인 파베 수량에 더한다.
 */
export function isUjuinParbakeFinishedProductLabel(displayProductLabel: string): boolean {
  const n = normalizeDashboardLabel(displayProductLabel);
  if (!n.includes("우주인")) return false;
  return n.includes("파베");
}

/**
 * 완제품 표시 라벨 기준 분류. isBreadProduct(계산 엔진)가 true면 브레드 우선.
 * 라이트 피자: 마르게리따·허니고르곤졸라 계열만. 그 외 완제품(브레드 제외)은 헤비 피자.
 * 우주인 파베이크(완제품만 입력)는 집계 층에서 건너뛰고 astronaut 합계에 더한다.
 */
export function categorizeFinishedProduct(
  displayProductLabel: string,
  isBreadProduct: boolean
): DashboardProductBucket {
  if (isBreadProduct) return "bread";
  const n = normalizeDashboardLabel(displayProductLabel);
  if (matchesAnyMarker(n, DASHBOARD_BREAD_MARKERS)) return "bread";
  if (matchesAnyMarker(n, DASHBOARD_LIGHT_PIZZA_MARKERS)) return "light_pizza";
  return "heavy_pizza";
}
