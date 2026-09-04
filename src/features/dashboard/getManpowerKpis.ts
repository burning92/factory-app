import type { SupabaseClient } from "@supabase/supabase-js";
import { computeActualManpower } from "@/features/production/planning/calculations";
import { isFactoryFieldHeadcountProfile } from "@/features/production/planning/countFactoryFieldHeadcount";

export type ManpowerKpis = {
  periodLabel?: string;
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

export type ManpowerRangeParams = {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  periodLabel: string;
  periodActualTotal: number;
};

/**
 * 대시보드 «인력 가동 현황» 카드 전용 selector.
 *
 * 정책(고정):
 * - 총원 기준: 공장(100) + 총원 포함 지정 활성 계정 (test·admin 로그인 제외)
 * - 일자별 투입: 총원 − 연차 − 반차×0.5 − 기타
 * - 가동일 기준: 재계산 투입 인원 > 0 인 날짜
 * - 평균 투입 인원: 가동일의 투입 인원 평균
 * - 평균 투입률: 평균 투입 인원 / 총원
 * - 생산성(개/인·일): 월 실제 총생산량 / (가동일 * 평균 투입 인원)
 */
export async function getManpowerKpis(
  supabase: SupabaseClient,
  params: ManpowerRangeParams
): Promise<ManpowerKpis> {
  const { year, startDate, endDate, periodLabel, periodActualTotal } = params;
  const yearStart = `${year}-01-01`;
  const today = new Date();
  const ytdEnd =
    year === today.getFullYear()
      ? `${year}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
      : `${year}-12-31`;

  const [{ data: months, error: monthErr }, { data: profileRows, error: memberErr }] = await Promise.all([
    supabase
      .from("production_plan_months")
      .select("id,plan_month")
      .eq("plan_year", year)
      .eq("version_type", "master"),
    supabase
      .from("profiles")
      .select("id,login_id,is_active,include_in_field_headcount,organizations(organization_code)")
      .eq("is_active", true),
  ]);
  if (monthErr) throw monthErr;
  if (memberErr) throw memberErr;

  const totalMembers = ((profileRows ?? []) as Parameters<typeof isFactoryFieldHeadcountProfile>[0][]).filter(
    isFactoryFieldHeadcountProfile
  ).length;
  const baselineHeadcount = totalMembers;
  const monthRows = (months ?? []) as Array<{ id: string; plan_month: number }>;
  const monthIds = monthRows.map((m) => String(m.id)).filter(Boolean);
  if (monthIds.length === 0) {
    return {
      periodLabel,
      baselineHeadcount,
      totalMembers,
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
    .select("month_id,plan_date,annual_leave_count,half_day_count,other_count")
    .in("month_id", monthIds)
    .gte("plan_date", yearStart)
    .lte("plan_date", ytdEnd);
  if (manpowerErr) throw manpowerErr;

  const periodValues: number[] = [];
  const periodDaySet = new Set<string>();
  const ytdSpanDaySet = new Set<string>();
  const periodUtilValues: number[] = [];
  const monthlyDayCountMap = new Map<number, number>();

  for (const row of (manpowerRows ?? []) as Array<{
    month_id: string | null;
    plan_date: string | null;
    annual_leave_count: number | null;
    half_day_count: number | null;
    other_count: number | null;
  }>) {
    const date = String(row.plan_date ?? "").slice(0, 10);
    const actual = computeActualManpower(
      totalMembers,
      Number(row.annual_leave_count) || 0,
      Number(row.half_day_count) || 0,
      Number(row.other_count) || 0
    );
    if (!date || actual <= 0) continue;
    const mm = Number(date.slice(5, 7));
    monthlyDayCountMap.set(mm, (monthlyDayCountMap.get(mm) ?? 0) + 1);
    if (date >= startDate && date <= endDate) {
      periodValues.push(actual);
      periodDaySet.add(date);
      if (baselineHeadcount > 0) periodUtilValues.push((actual / baselineHeadcount) * 100);
    }
    if (date >= yearStart && date <= endDate) {
      ytdSpanDaySet.add(date);
    }
  }

  const avg = (vals: number[]): number | null => (vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null);
  const avgActualManpowerThisMonth = avg(periodValues);
  const avgUtilizationThisMonth =
    avgActualManpowerThisMonth != null && baselineHeadcount > 0 ? (avgActualManpowerThisMonth / baselineHeadcount) * 100 : null;
  const yearlyAvgUtilization = avg(periodUtilValues);

  const monthlyOperatingDays = Array.from(monthlyDayCountMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([m, days]) => ({ month: m, days }));

  const productivityPerPersonDay =
    periodValues.length > 0 && (avgActualManpowerThisMonth ?? 0) > 0
      ? periodActualTotal / (periodValues.length * (avgActualManpowerThisMonth as number))
      : null;

  return {
    periodLabel,
    baselineHeadcount,
    totalMembers,
    operatingDaysThisMonth: periodDaySet.size,
    operatingDaysYearToDate: ytdSpanDaySet.size,
    avgActualManpowerThisMonth,
    avgUtilizationThisMonth,
    productivityPerPersonDay,
    yearlyAvgUtilization,
    monthlyOperatingDays,
    hasData: periodValues.length > 0,
  };
}
