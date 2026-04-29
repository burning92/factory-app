import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadPlanActualByProductForMonth,
  loadPlanActualDashboardMetrics,
  majorCategoryForPlanActualProduct,
  planActualSparklineWindowMonths,
  type PlanActualDashboardMetrics,
} from "@/features/dashboard/planVsActual";

export type PlanningVsActualMetrics = {
  periodLabel?: string;
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

export type PlanningRangeParams = {
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  periodLabel: string;
  periodKey: "week" | "month" | "ytd";
};

function monthFromDate(date: string): number {
  return Number(String(date).slice(5, 7));
}

function monthSpan(startDate: string, endDate: string): number[] {
  const ys = Number(startDate.slice(0, 4));
  const ye = Number(endDate.slice(0, 4));
  if (ys !== ye) return [];
  const s = monthFromDate(startDate);
  const e = monthFromDate(endDate);
  const out: number[] = [];
  for (let m = s; m <= e; m++) out.push(m);
  return out;
}

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
  params: PlanningRangeParams
): Promise<PlanningVsActualMetrics> {
  const { year, month, startDate, endDate, periodLabel, periodKey } = params;
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

  const targetMonths = monthSpan(startDate, endDate);
  const monthRowsForRange = await Promise.all(targetMonths.map((m) => loadPlanActualByProductForMonth(supabase, year, m)));
  const planByCat: Record<"pizza" | "bread" | "parbake", number> = { pizza: 0, bread: 0, parbake: 0 };
  const actualByCat: Record<"pizza" | "bread" | "parbake", number> = { pizza: 0, bread: 0, parbake: 0 };
  for (const mm of monthRowsForRange) {
    for (const row of mm.rows) {
      const cat = majorCategoryForPlanActualProduct(row.productName);
      const actualInRange = row.actualDailyBreakdown
        .filter((d) => d.date >= startDate && d.date <= endDate)
        .reduce((s, d) => s + d.qty, 0);
      actualByCat[cat] += actualInRange;
    }
  }

  const [{ data: legacyPlanRows }, { data: processedPlanRows }] = await Promise.all([
    supabase
      .from("production_plan_rows")
      .select("plan_date, product_name, qty, source_sheet_name")
      .gte("plan_date", startDate)
      .lte("plan_date", endDate),
    supabase
      .from("production_plan_processed_rows")
      .select("plan_date, product_name, qty")
      .gte("plan_date", startDate)
      .lte("plan_date", endDate),
  ]);
  const planningBoardDates = new Set(
    (legacyPlanRows ?? [])
      .filter((r) => String((r as { source_sheet_name?: string | null }).source_sheet_name ?? "") === "planning_board")
      .map((r) => String((r as { plan_date?: string | null }).plan_date ?? "").slice(0, 10))
      .filter(Boolean)
  );
  const mergedPlanRows = [
    ...((legacyPlanRows ?? []).filter((r) => {
      const rr = r as { plan_date?: string | null; source_sheet_name?: string | null };
      const d = String(rr.plan_date ?? "").slice(0, 10);
      if (!planningBoardDates.has(d)) return true;
      return String(rr.source_sheet_name ?? "") === "planning_board";
    }) as Array<{ product_name?: string | null; qty?: unknown }>),
    ...((processedPlanRows ?? []).filter((r) => {
      const d = String((r as { plan_date?: string | null }).plan_date ?? "").slice(0, 10);
      return !planningBoardDates.has(d);
    }) as Array<{ product_name?: string | null; qty?: unknown }>),
  ];
  for (const row of mergedPlanRows) {
    const qty = Number(row.qty ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const cat = majorCategoryForPlanActualProduct(String(row.product_name ?? "").trim());
    planByCat[cat] += qty;
  }

  const rangePlanTotal = planByCat.pizza + planByCat.bread + planByCat.parbake;
  const rangeActualTotal = actualByCat.pizza + actualByCat.bread + actualByCat.parbake;
  const toBucket = (plan: number, actual: number) => ({
    plan,
    actual,
    achievementPct: plan > 0 ? (actual / plan) * 100 : null,
  });
  const rangeBuckets = {
    pizza: toBucket(planByCat.pizza, actualByCat.pizza),
    bread: toBucket(planByCat.bread, actualByCat.bread),
    parbake: toBucket(planByCat.parbake, actualByCat.parbake),
  } as PlanActualDashboardMetrics["buckets"];

  return {
    periodLabel,
    currentMonth: month,
    planTotal: rangePlanTotal,
    actualTotal: rangeActualTotal,
    achievementRate: rangePlanTotal > 0 ? (rangeActualTotal / rangePlanTotal) * 100 : null,
    achievementPct: rangePlanTotal > 0 ? (rangeActualTotal / rangePlanTotal) * 100 : null,
    monthlyTrend,
    categoryRates: [
      { key: "pizza", rate: rangeBuckets.pizza.achievementPct },
      { key: "bread", rate: rangeBuckets.bread.achievementPct },
      { key: "parbake", rate: rangeBuckets.parbake.achievementPct },
    ],
    categoryPlanTotals: [
      { key: "pizza", qty: rangeBuckets.pizza.plan },
      { key: "bread", qty: rangeBuckets.bread.plan },
      { key: "parbake", qty: rangeBuckets.parbake.plan },
    ],
    categoryActualTotals: [
      { key: "pizza", qty: rangeBuckets.pizza.actual },
      { key: "bread", qty: rangeBuckets.bread.actual },
      { key: "parbake", qty: rangeBuckets.parbake.actual },
    ],
    year: current.year,
    month: current.month,
    buckets: rangeBuckets,
    planFromProcessedSheet: current.planFromProcessedSheet || periodKey !== "month",
    sparklineAchievementByMonth,
  };
}
