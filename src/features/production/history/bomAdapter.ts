/**
 * BOM 조회 어댑터
 * - 제품명(baseProductName) + 제품 기준 "일반" + 하위원료 기준 "도우" 로 도우 소스 행만 조회
 */

import type { BomRowRef } from "./types";

/** DB에 product_name이 "마르게리따" 또는 "마르게리따 - 일반" 형태로 올 수 있음 */
function bomProductMatchesBase(
  bomProductName: string,
  baseProductName: string
): boolean {
  const b = (bomProductName ?? "").trim();
  const base = (baseProductName ?? "").trim();
  if (!base) return false;
  return b === base || b === `${base} - 일반`;
}

/**
 * 제품명 = baseProductName, 제품 기준 = "일반", 하위원료 기준 = "도우" 인 BOM 행만 반환.
 * (실제 DB에 product_standard 컬럼이 없으면 product_name이 "baseProductName" 또는 "baseProductName - 일반" 인 행 중 basis === "도우" 만 사용)
 */
export function getDoughBaseRowsFromGeneralBom(
  baseProductName: string,
  bomList: BomRowRef[]
): BomRowRef[] {
  return bomList.filter(
    (b) =>
      bomProductMatchesBase(b.productName, baseProductName) && b.basis === "도우"
  );
}

/**
 * 제품명 + 제품 기준으로 BOM 행 조회.
 * productStandardName이 있으면 "baseProductName - productStandardName" 형태로도 매칭,
 * 없으면 baseProductName만 매칭.
 */
export function getBomRowsForProductAndStandard(
  baseProductName: string,
  productStandardName: string,
  bomList: BomRowRef[]
): BomRowRef[] {
  const base = (baseProductName ?? "").trim();
  const standard = (productStandardName ?? "").trim();
  return bomList.filter((b) => {
    const p = (b.productName ?? "").trim();
    if (standard) return p === `${base} - ${standard}` || p === base;
    return p === base || p === `${base} - 일반`;
  });
}
