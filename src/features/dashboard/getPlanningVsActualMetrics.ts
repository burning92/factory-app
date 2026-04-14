import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadPlanActualDashboardMetrics,
  planActualSparklineWindowMonths,
  type PlanActualDashboardMetrics,
} from "@/features/dashboard/planVsActual";

export type PlanningVsActualMetrics = {
  currentMonth: number;
  planTotal: number;
  actualTotal: number;
  achievementRate: number | null;
  // 기존 카드/컴포넌트 호환용 별칭
  achievementPct: number | null;
  monthlyTrend: Array<{ month: number; plan: number; actual: number; achievementRate: number | null }>;
  categoryRates: Array<{ key: "pizza" | "bread" | "parbake"; rate: number | null }>;
  categoryPlanTotals: Array<{ key: "pizza" | "bread" | "parbake"; qty: number }>;
  categoryActualTotals: Array<{ key: "pizza" | "bread" | "parbake"; qty: number }>;
  // 기존 대시보드 카드 호환용
  year: number;
  month: number;
  buckets: PlanActualDashboardMetrics["buckets"];
  planFromProcessedSheet: boolean;
  sparklineAchievementByMonth: Record<number, number | null>;
};

/**
 * 대시보드 «계획 대비 실적» 카드 전용 selector.
 *
 * 정책:
 * - 계획: production_plan_processed_rows 우선, 없으면 production_plan_rows (기존 planVsActual 재사용)
 * - 실적: 2차마감 snapshot + ecount 보정 (기존 planVsActual 재사용)
 *
 * TODO/Risk:
 * - product_name_snapshot/명칭 정규화 이슈로 계획·실적 품목 매칭 편차 가능
 * - 신규 품목명 누락 시 대분류 집계 오차 가능(분류 규칙 파일 관리 필요)
 * - 계획일/실적일의 컷오프 차이(마감 지연)로 월 경계 왜곡 가능
 */
export async function getPlanningVsActualMetrics(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<PlanningVsActualMetrics> {
  const current = await loadPlanActualDashboardMetrics(supabase, year, month);
  const monthsToLoad = Array.from({ length: month }, (_, i) => i + 1);
  const monthlyRows = await Promise.all(monthsToLoad.map((m) => loadPlanActualDashboardMetrics(supabase, year, m)));
  const monthlyTrend = monthlyRows.map((r) => ({
    month: r.month,
    plan: r.planTotal,
    actual: r.actualTotal,
    achievementRate: r.achievementPct,
  }));

  // 카드 스파크라인은 기존 4개월 창만 사용
  const sparklineMonths = planActualSparklineWindowMonths(month).filter((m) => m <= month);
  const sparklineAchievementByMonth: Record<number, number | null> = {};
  for (const m of sparklineMonths) {
    const row = monthlyRows.find((x) => x.month === m);
    sparklineAchievementByMonth[m] = row?.achievementPct ?? null;
  }

  return {
    currentMonth: month,
    planTotal: current.planTotal,
    actualTotal: current.actualTotal,
    achievementRate: current.achievementPct,
    achievementPct: current.achievementPct,
    monthlyTrend,
    categoryRates: [
      { key: "pizza", rate: current.buckets.pizza.achievementPct },
      { key: "bread", rate: current.buckets.bread.achievementPct },
      { key: "parbake", rate: current.buckets.parbake.achievementPct },
    ],
    categoryPlanTotals: [
      { key: "pizza", qty: current.buckets.pizza.plan },
      { key: "bread", qty: current.buckets.bread.plan },
      { key: "parbake", qty: current.buckets.parbake.plan },
    ],
    categoryActualTotals: [
      { key: "pizza", qty: current.buckets.pizza.actual },
      { key: "bread", qty: current.buckets.bread.actual },
      { key: "parbake", qty: current.buckets.parbake.actual },
    ],
    year: current.year,
    month: current.month,
    buckets: current.buckets,
    planFromProcessedSheet: current.planFromProcessedSheet,
    sparklineAchievementByMonth,
  };
}
