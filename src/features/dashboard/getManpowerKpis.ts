import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPlanActualDashboardMetrics } from "@/features/dashboard/planVsActual";

export type ManpowerKpis = {
  baselineHeadcount: number;
  totalMembers: number;
  operatingDaysThisMonth: number;
  operatingDaysYearToDate: number;
  avgActualManpowerThisMonth: number | null;
  avgUtilizationThisMonth: number | null;
  productivityPerPersonDay: number | null;
  yearlyAvgUtilization: number | null;
  monthlyOperatingDays: { month: number; days: number }[];
  hasData: boolean;
};

/**
 * 대시보드 «인력 가동 현황» 카드 전용 selector.
 *
 * 정책(고정):
 * - 총원 기준: production_plan_months.baseline_headcount 우선
 * - 가동일 기준: actual_manpower > 0 인 날짜
 * - 평균 투입 인원: 가동일의 actual_manpower 평균
 * - 평균 투입률: 평균 투입 인원 / baseline_headcount
 * - 생산성(개/인·일): 월 실제 총생산량 / (가동일 * 평균 투입 인원)
 *
 * TODO/Risk:
 * - actual_manpower는 계획 입력 기준이라 실제 출근 데이터와 차이 가능
 * - 월별 baseline 변경 시 연간 평균은 일자별로 각 월 baseline을 반영
 */
export async function getManpowerKpis(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<ManpowerKpis> {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  const yearStart = `${year}-01-01`;
  const today = new Date();
  const ytdEnd =
    year === today.getFullYear()
      ? `${year}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
      : `${year}-12-31`;

  const [{ data: months, error: monthErr }, { count: totalMembers, error: memberErr }] = await Promise.all([
    supabase
      .from("production_plan_months")
      .select("id,plan_month,baseline_headcount")
      .eq("plan_year", year)
      .eq("version_type", "master"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);
  if (monthErr) throw monthErr;
  if (memberErr) throw memberErr;

  const monthRows = (months ?? []) as Array<{ id: string; plan_month: number; baseline_headcount: number | null }>;
  const currentMonthRow = monthRows.find((m) => Number(m.plan_month) === month);
  const baselineHeadcount = Math.max(1, Number(currentMonthRow?.baseline_headcount ?? 25) || 25);
  const monthIds = monthRows.map((m) => String(m.id)).filter(Boolean);
  if (monthIds.length === 0) {
    return {
      baselineHeadcount,
      totalMembers: totalMembers ?? 0,
      operatingDaysThisMonth: 0,
      operatingDaysYearToDate: 0,
      avgActualManpowerThisMonth: null,
      avgUtilizationThisMonth: null,
      productivityPerPersonDay: null,
      yearlyAvgUtilization: null,
      monthlyOperatingDays: [],
      hasData: false,
    };
  }

  const { data: manpowerRows, error: manpowerErr } = await supabase
    .from("production_plan_manpower")
    .select("month_id,plan_date,actual_manpower")
    .in("month_id", monthIds)
    .gte("plan_date", yearStart)
    .lte("plan_date", ytdEnd);
  if (manpowerErr) throw manpowerErr;

  const baselineByMonthId = new Map<string, number>();
  for (const m of monthRows) baselineByMonthId.set(String(m.id), Math.max(1, Number(m.baseline_headcount ?? 25) || 25));

  const monthValues: number[] = [];
  const ytdValues: number[] = [];
  const ytdUtilValues: number[] = [];
  const monthlyDayCountMap = new Map<number, number>();

  for (const row of (manpowerRows ?? []) as Array<{ month_id: string | null; plan_date: string | null; actual_manpower: number | null }>) {
    const date = String(row.plan_date ?? "").slice(0, 10);
    const actual = Number(row.actual_manpower ?? 0);
    if (!date || actual <= 0) continue;
    ytdValues.push(actual);
    const mm = Number(date.slice(5, 7));
    monthlyDayCountMap.set(mm, (monthlyDayCountMap.get(mm) ?? 0) + 1);
    if (date >= monthStart && date <= monthEnd) monthValues.push(actual);
    const perDayBase = baselineByMonthId.get(String(row.month_id ?? "")) ?? baselineHeadcount;
    ytdUtilValues.push((actual / perDayBase) * 100);
  }

  const avg = (vals: number[]): number | null => (vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null);
  const avgActualManpowerThisMonth = avg(monthValues);
  const avgUtilizationThisMonth =
    avgActualManpowerThisMonth != null && baselineHeadcount > 0 ? (avgActualManpowerThisMonth / baselineHeadcount) * 100 : null;
  const yearlyAvgUtilization = avg(ytdUtilValues);

  const monthlyOperatingDays = Array.from(monthlyDayCountMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([m, days]) => ({ month: m, days }));

  const planActualMonth = await loadPlanActualDashboardMetrics(supabase, year, month);
  const productivityPerPersonDay =
    monthValues.length > 0 && (avgActualManpowerThisMonth ?? 0) > 0
      ? planActualMonth.actualTotal / (monthValues.length * (avgActualManpowerThisMonth as number))
      : null;

  return {
    baselineHeadcount,
    totalMembers: totalMembers ?? 0,
    operatingDaysThisMonth: monthValues.length,
    operatingDaysYearToDate: ytdValues.length,
    avgActualManpowerThisMonth,
    avgUtilizationThisMonth,
    productivityPerPersonDay,
    yearlyAvgUtilization,
    monthlyOperatingDays,
    hasData: ytdValues.length > 0,
  };
}
