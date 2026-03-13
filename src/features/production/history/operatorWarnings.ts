/**
 * Step 4: 작업자용 안내 문구로 기술 경고 변환
 * - 디버그 숫자 노출 금지
 * - 0개 추가 파베이크 관련 문구 제거
 * - 중복 제거, 짧고 쉬운 문장만
 */

import type { ComputedResult } from "./types";

const ZERO_EXTRA_PATTERNS = [
  /0개.*파베이크/i,
  /추가 파베이크.*0/i,
  /extra.*0/i,
];

function isZeroQtyExtraMessage(msg: string): boolean {
  const t = (msg ?? "").trim();
  return ZERO_EXTRA_PATTERNS.some((re) => re.test(t));
}

/** 0개 추가 파베이크 관련 문구 제거 */
export function filterZeroQtyMessages(messages: string[]): string[] {
  return messages.filter((m) => !isZeroQtyExtraMessage(m));
}

/** 중복 제거 (순서 유지) */
export function dedupeMessages(messages: string[]): string[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    const n = (m ?? "").trim().toLowerCase();
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

/** 기술 메시지를 작업자용 짧은 문장으로 매핑 (수식/변수명 노출 금지) */
function mapOneMessage(msg: string): string {
  const m = (msg ?? "").trim();
  if (!m) return "";

  if (/도우 흐름|doughUsageQty|expectedDirectDoughFlowQty|directDoughBalanceQty|차이\s*=/i.test(m)) {
    return "입력한 도우 수량과 생산 수량이 맞지 않습니다. 1차/2차 마감 입력값을 다시 확인해 주세요.";
  }
  if (/혼합 생산일|브레드.*파베이크사용/i.test(m)) {
    return "브레드 제품과 파베이크사용 제품이 함께 있어 계산 기준이 나뉩니다.";
  }
  if (/추가 파베이크.*제품 귀속|productCandidates|종류만 확정/i.test(m)) {
    return "추가 파베이크는 종류는 확인되었지만, 어떤 제품에 사용됐는지는 자동 구분되지 않았습니다.";
  }
  if (/파베이크 종류가 2종 이상/i.test(m)) {
    return "당일 파베이크가 2종 이상이라 자동 계산이 제한됩니다.";
  }
  if (/BOM.*없습니다|일반\+도우/i.test(m)) {
    return "해당 제품의 원료 기준표(BOM)가 없거나 불완전합니다. 관리자 확인이 필요합니다.";
  }
  if (/도우 소스가 여러 종류/i.test(m)) {
    return "해당 제품의 도우 소스가 여러 종류라 자동 판별이 되지 않습니다.";
  }
  if (/실제 사용량이 음수/i.test(m)) {
    return "원료별 전날재고·출고·당일재고 입력을 확인해 주세요.";
  }
  if (/폐기량이 음수|도우 사용량이 음수/i.test(m)) {
    return "도우·파베이크 관련 입력값을 확인해 주세요.";
  }
  if (/베이스 폐기량.*실제 사용량/i.test(m)) {
    return "베이스 소스 폐기량이 사용량보다 큽니다. 입력을 확인해 주세요.";
  }
  if (/원료 배정|배정값 확인/i.test(m)) {
    return "원료 배정값 확인이 필요할 수 있습니다.";
  }

  return m;
}

/**
 * computedResult.warnings를 작업자용 안내 문구로 변환.
 * - 0개 extra parbake 제거
 * - 기술 수식/변수명 숨기고 짧은 문장으로 변환
 * - 중복 제거
 * @param computedResult 계산 결과
 * @param options.ponoApplicable true이면 도우 불일치·베이스 폐기>사용 경고 제외 (혼합 생산일에서 오해 방지)
 */
export function mapTechnicalWarningsToOperatorMessages(
  computedResult: ComputedResult,
  options?: { ponoApplicable?: boolean }
): string[] {
  const raw = computedResult.warnings ?? [];
  const filtered = filterZeroQtyMessages(raw);
  let mapped = filtered
    .map(mapOneMessage)
    .filter((s) => s.length > 0);
  if (options?.ponoApplicable) {
    mapped = mapped.filter(
      (m) =>
        m !== "입력한 도우 수량과 생산 수량이 맞지 않습니다. 1차/2차 마감 입력값을 다시 확인해 주세요." &&
        m !== "베이스 소스 폐기량이 사용량보다 큽니다. 입력을 확인해 주세요."
    );
  }
  return dedupeMessages(mapped);
}
