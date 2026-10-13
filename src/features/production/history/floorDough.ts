/** 2층 피자 / 3층 브레드 병행 생산. 이 날짜부터 도우 반죽·폐기를 층별로 입력한다. */
export const FLOOR_SPLIT_DOUGH_FROM = "2026-10-12";

export type DoughQtyInput = number | "" | null | undefined;

export function isFloorSplitDoughDate(date: string | null | undefined): boolean {
  const d = (date ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= FLOOR_SPLIT_DOUGH_FROM;
}

export function doughQtyToNumber(value: DoughQtyInput): number {
  if (value === "" || value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 둘 다 비어 있으면 빈 값. 하나라도 숫자면 빈 칸은 0으로 더한다. */
export function sumDoughQty(a: DoughQtyInput, b: DoughQtyInput): number | "" {
  const aEmpty = a === "" || a == null;
  const bEmpty = b === "" || b == null;
  if (aEmpty && bEmpty) return "";
  return doughQtyToNumber(a) + doughQtyToNumber(b);
}
