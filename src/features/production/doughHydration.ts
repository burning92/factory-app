import type { DoughLogRecord } from "@/store/useMasterStore";

/** 반죽일자 요일별 기본 수분율(%) */
export function getHydrationByDayOfWeek(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00");
  if (Number.isNaN(d.getTime())) return 61;
  const day = d.getDay();
  if (day === 5) return 60;
  if (day === 6) return 60.5;
  return 61;
}

export function resolveDoughHydration(
  record: Pick<DoughLogRecord, "수분율" | "반죽일자" | "사용일자">
): { percent: number; source: "saved" | "estimated" } {
  if (record.수분율 != null && Number.isFinite(record.수분율)) {
    return { percent: record.수분율, source: "saved" };
  }
  const dateStr = record.반죽일자 ?? record.사용일자;
  return { percent: getHydrationByDayOfWeek(dateStr), source: "estimated" };
}

export function formatDoughHydration(
  record: Pick<DoughLogRecord, "수분율" | "반죽일자" | "사용일자">
): string {
  const { percent, source } = resolveDoughHydration(record);
  return source === "estimated" ? `${percent}% (추정)` : `${percent}%`;
}
