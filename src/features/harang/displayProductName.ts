/**
 * 하랑 UI 표시용 제품명. BOM/DB에는 ` - 파베이크사용` 접미어가 붙을 수 있으나 화면에서는 생략합니다.
 * 조회·매칭용 원문 키는 DB 값을 그대로 쓰고, 표시할 때만 이 함수를 사용합니다.
 */
const PARBAKE_USAGE_SUFFIX = " - 파베이크사용";

export function displayHarangProductName(name: string | null | undefined): string {
  let s = String(name ?? "").trim();
  if (!s) return "";
  if (s.endsWith(PARBAKE_USAGE_SUFFIX)) {
    s = s.slice(0, -PARBAKE_USAGE_SUFFIX.length).trimEnd();
  }
  return s;
}
