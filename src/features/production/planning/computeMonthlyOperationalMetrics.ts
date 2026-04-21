import type { PlanningEntryRow } from "./types";
import { monthDays, ymd } from "./calculations";

export type MonthlyOperationalMetrics = {
  /** 기준 인원(월 헤더) */
  baselineHeadcount: number;
  /** 현장 인원 집계: 100~199조직·현장 직군, 로그인 test·admin 계열 제외 (참고) */
  totalMembers: number;
  /**
   * 해당 월에서 생산 수량이 1건이라도 있는 날짜 수.
   * TODO: 휴무만 있고 생산 없는 날은 가동에서 제외할지 정책 확정 필요.
   */
  plannedOperationDayCount: number;
  /**
   * 토·일 중 위와 동일 조건으로 계획이 잡힌 날 수.
   * TODO: '주말 근무'를 생산 행 유무만으로 볼지, 인원 투입 기준으로 볼지 확정 필요.
   */
  weekendPlannedDayCount: number;
};

function isoWeekdayKst(iso: string): number {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return 0;
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0)).getUTCDay();
}

/**
 * 월간 운영 지표(총원·가동일·주말).
 */
export function computeMonthlyOperationalMetrics(params: {
  year: number;
  month: number;
  entries: PlanningEntryRow[];
  baselineHeadcount: number;
  totalMembers: number;
}): MonthlyOperationalMetrics {
  const { year, month, entries, baselineHeadcount, totalMembers } = params;

  const datesWithProduction = new Set<string>();
  for (const e of entries) {
    const qty = Number(e.qty) || 0;
    if (qty <= 0) continue;
    datesWithProduction.add(String(e.plan_date).slice(0, 10));
  }

  let weekendPlannedDayCount = 0;
  const dim = monthDays(year, month);
  for (let day = 1; day <= dim; day += 1) {
    const iso = ymd(year, month, day);
    if (!datesWithProduction.has(iso)) continue;
    const wd = isoWeekdayKst(iso);
    if (wd === 0 || wd === 6) weekendPlannedDayCount += 1;
  }

  return {
    baselineHeadcount,
    totalMembers,
    plannedOperationDayCount: datesWithProduction.size,
    weekendPlannedDayCount,
  };
}
