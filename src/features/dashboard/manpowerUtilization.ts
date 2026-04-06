import type { SupabaseClient } from "@supabase/supabase-js";

/** 총원 100% 기준. 시트·환경과 맞추려면 상수만 조정하면 됨. */
export const DEFAULT_DASHBOARD_BASELINE_HEADCOUNT = 25;

function ymdBounds(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(year, month, 0);
  const end = `${year}-${String(month).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  return { start, end };
}

export type ManpowerMonthSummary = {
  year: number;
  month: number;
  baselineHeadcount: number;
  /** 이번 달 일자별 max(투입인원) 평균 */
  avgDailyManpower: number | null;
  /** 이번 달 일자별 max(투입인원) 평균을 baseline 대비 %로 환산 */
  avgDailyUtilizationPct: number | null;
  /** 올해(현재까지) 일자별 max(투입인원) 평균 */
  ytdAvgDailyManpower: number | null;
  /** 올해(현재까지) 일자별 max(투입인원) 평균을 baseline 대비 %로 환산 */
  ytdAvgDailyUtilizationPct: number | null;
  daysWithManpower: number;
  ytdOperatingDays: number;
  monthlyOperatingDays: { month: number; days: number }[];
  hasProcessedPlanData: boolean;
};

/**
 * 생산계획가공 동기화 행 기준: 같은 생산일에 여러 행이 있으면 투입인원은 max만 사용(하루 한 번 투입 가정).
 */
export async function loadManpowerUtilizationMonthSummary(
  supabase: SupabaseClient,
  year: number,
  month: number,
  baselineHeadcount: number = DEFAULT_DASHBOARD_BASELINE_HEADCOUNT
): Promise<ManpowerMonthSummary> {
  const { start: monthStart, end: monthEnd } = ymdBounds(year, month);
  const yearStart = `${year}-01-01`;
  const today = new Date();
  const ytdEnd =
    year === today.getFullYear()
      ? `${year}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
      : `${year}-12-31`;
  const { data, error } = await supabase
    .from("production_plan_processed_rows")
    .select("plan_date, manpower")
    .gte("plan_date", yearStart)
    .lte("plan_date", ytdEnd);

  if (error || !data?.length) {
    return {
      year,
      month,
      baselineHeadcount,
      avgDailyManpower: null,
      avgDailyUtilizationPct: null,
      ytdAvgDailyManpower: null,
      ytdAvgDailyUtilizationPct: null,
      daysWithManpower: 0,
      ytdOperatingDays: 0,
      monthlyOperatingDays: [],
      hasProcessedPlanData: false,
    };
  }

  const byDay = new Map<string, number>();
  for (const row of data) {
    const d = String((row as { plan_date?: string }).plan_date ?? "").slice(0, 10);
    const m = Number((row as { manpower?: unknown }).manpower);
    if (!d || !Number.isFinite(m) || m <= 0) continue;
    const prev = byDay.get(d) ?? 0;
    if (m > prev) byDay.set(d, m);
  }

  if (byDay.size === 0) {
    return {
      year,
      month,
      baselineHeadcount,
      avgDailyManpower: null,
      avgDailyUtilizationPct: null,
      ytdAvgDailyManpower: null,
      ytdAvgDailyUtilizationPct: null,
      daysWithManpower: 0,
      ytdOperatingDays: 0,
      monthlyOperatingDays: [],
      hasProcessedPlanData: true,
    };
  }

  const monthValues: number[] = [];
  const ytdValues: number[] = [];
  const monthlyDayCountMap = new Map<number, number>();

  for (const [day, headcount] of Array.from(byDay.entries())) {
    const mm = Number(day.slice(5, 7));
    ytdValues.push(headcount);
    monthlyDayCountMap.set(mm, (monthlyDayCountMap.get(mm) ?? 0) + 1);
    if (day >= monthStart && day <= monthEnd) monthValues.push(headcount);
  }

  const monthlyOperatingDays = Array.from(monthlyDayCountMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([m, days]) => ({ month: m, days }));

  const avg = (values: number[]): number | null =>
    values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;

  const monthAvg = avg(monthValues);
  const ytdAvg = avg(ytdValues);
  const toPct = (headcountAvg: number | null): number | null => {
    if (headcountAvg == null || baselineHeadcount <= 0) return null;
    return Math.min(100, (headcountAvg / baselineHeadcount) * 100);
  };

  return {
    year,
    month,
    baselineHeadcount,
    avgDailyManpower: monthAvg,
    avgDailyUtilizationPct: toPct(monthAvg),
    ytdAvgDailyManpower: ytdAvg,
    ytdAvgDailyUtilizationPct: toPct(ytdAvg),
    daysWithManpower: monthValues.length,
    ytdOperatingDays: ytdValues.length,
    monthlyOperatingDays,
    hasProcessedPlanData: true,
  };
}

export function formatMonthlyOperatingDays(monthly: { month: number; days: number }[]): string {
  if (!monthly.length) return "—";
  const lastMonth = monthly[monthly.length - 1]?.month;
  return monthly
    .map((x) => `${x.month}월${x.month === lastMonth ? "(현재까지)" : ""}: ${x.days}일`)
    .join(" · ");
}
