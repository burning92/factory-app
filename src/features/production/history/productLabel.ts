/**
 * 출고현황 제품명 표시값 파싱 (마지막 " - " 구분자 기준)
 * - displayProductLabel: 화면 표시용 그대로 (예: "마르게리따 - 파베이크사용")
 * - baseProductName / productStandardName: 계산·BOM 조회용
 */

export type ParsedProductLabel = {
  displayProductLabel: string;
  baseProductName: string;
  productStandardName: string;
};

const SEP = " - ";

/**
 * 마지막 " - " 구분자 기준으로 분리.
 * "마르게리따 - 파베이크사용" → baseProductName "마르게리따", productStandardName "파베이크사용"
 * "포노부오노 시그니처 화덕 브레드 - 브레드" → base "포노부오노 시그니처 화덕 브레드", standard "브레드"
 * 구분자가 없으면 전체를 baseProductName으로, productStandardName은 빈 문자열.
 */
export function parseProductLabel(displayProductLabel: string): ParsedProductLabel {
  const raw = (displayProductLabel ?? "").trim();
  if (!raw) {
    return { displayProductLabel: raw, baseProductName: "", productStandardName: "" };
  }
  const lastSep = raw.lastIndexOf(SEP);
  if (lastSep === -1) {
    return {
      displayProductLabel: raw,
      baseProductName: raw,
      productStandardName: "",
    };
  }
  const baseProductName = raw.slice(0, lastSep).trim();
  const productStandardName = raw.slice(lastSep + SEP.length).trim();
  return {
    displayProductLabel: raw,
    baseProductName,
    productStandardName,
  };
}
