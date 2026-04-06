import type { SupabaseClient } from "@supabase/supabase-js";
import type { BomRowRef } from "@/features/production/history/types";
import type { MaterialMeta } from "@/features/production/history/calculations";
import {
  processSnapshotRows,
  rollupYtdProduction,
  rollupYtdWaste,
  addYtdProductionRollups,
  type DayProductionSnapshotRow,
  type DayProductionMetrics,
  type YtdProductionRollup,
} from "@/features/dashboard/aggregateProductionFromSnapshots";
import { rollupEcountImportsForYear } from "@/features/dashboard/ecountProductionImport";

function dayMetricsFromEcountRollup(date: string, r: YtdProductionRollup): DayProductionMetrics {
  const total =
    r.lightPizza + r.heavyPizza + r.bread + r.other + r.astronautParbake + r.saleParbake;
  return {
    date,
    totalFinishedQty: total,
    doughMixQty: 0,
    doughWasteQty: 0,
    parbakeWasteQty: 0,
    sameDayParbakeProductionQty: 0,
    astronautParbakeQty: r.astronautParbake,
    saleParbakeQty: r.saleParbake,
    finishedLightPizza: r.lightPizza,
    finishedHeavyPizza: r.heavyPizza,
    finishedBread: r.bread,
    finishedOther: r.other,
  };
}

/** 2차 마감 일은 스냅샷만, 그 밖의 날은 이카운트 일별 행을 같은 열 형식으로 채움 */
function mergeSnapshotDaysWithEcountByDate(
  snapshotDays: DayProductionMetrics[],
  ecountByDate: Map<string, YtdProductionRollup>
): DayProductionMetrics[] {
  const snapshotByDate = new Map<string, DayProductionMetrics>();
  for (const d of snapshotDays) snapshotByDate.set(d.date, d);

  const allDates = new Set<string>();
  for (const k of Array.from(snapshotByDate.keys())) allDates.add(k);
  for (const k of Array.from(ecountByDate.keys())) allDates.add(k);

  return Array.from(allDates)
    .sort()
    .map((date) => {
      const snap = snapshotByDate.get(date);
      if (snap) return snap;
      const er = ecountByDate.get(date);
      if (er) return dayMetricsFromEcountRollup(date, er);
      return dayMetricsFromEcountRollup(date, {
        lightPizza: 0,
        heavyPizza: 0,
        bread: 0,
        other: 0,
        astronautParbake: 0,
        saleParbake: 0,
      });
    });
}

export async function fetchSecondClosedSnapshotsForYear(
  supabase: SupabaseClient,
  year: number
): Promise<{ rows: DayProductionSnapshotRow[]; error: Error | null }> {
  const { data, error } = await supabase
    .from("production_history_date_state")
    .select("production_date, second_closed_at, state_snapshot")
    .gte("production_date", `${year}-01-01`)
    .lte("production_date", `${year}-12-31`)
    .not("second_closed_at", "is", null)
    .order("production_date", { ascending: true });

  if (error) {
    return { rows: [], error: new Error(error.message) };
  }
  return {
    rows: (data ?? []) as DayProductionSnapshotRow[],
    error: null,
  };
}

export function buildDayMetrics(
  rows: DayProductionSnapshotRow[],
  bomRefs: BomRowRef[],
  materialsMeta: MaterialMeta[]
): DayProductionMetrics[] {
  return processSnapshotRows(rows, bomRefs, materialsMeta);
}

export type ProductionEcountMergeInfo = {
  /** 이카운트 생산입고로 합산된 행 수 (2차마감 일 제외) */
  linesCounted: number;
  /** 2차마감이 있어 제외한 행 수 (중복 방지) */
  skippedBecauseSecondClosed: number;
  /** 이카운트에서 더한 분량만 */
  supplementalRollup: YtdProductionRollup;
  error: string | null;
};

export type ProductionBundle = {
  year: number;
  days: DayProductionMetrics[];
  /** 2차 마감 스냅샷 + 이카운트 보정(있을 때) */
  ytdProduction: ReturnType<typeof rollupYtdProduction>;
  ytdWaste: ReturnType<typeof rollupYtdWaste>;
  ecountMerge: ProductionEcountMergeInfo | null;
};

export async function loadProductionBundle(
  supabase: SupabaseClient,
  year: number,
  bomRefs: BomRowRef[],
  materialsMeta: MaterialMeta[]
): Promise<{ bundle: ProductionBundle | null; error: Error | null }> {
  const { rows, error } = await fetchSecondClosedSnapshotsForYear(supabase, year);
  if (error) return { bundle: null, error };
  const days = buildDayMetrics(rows, bomRefs, materialsMeta);
  const snapshotRollup = rollupYtdProduction(days);
  const secondClosedDates = new Set(
    rows.map((r) => String(r.production_date ?? "").slice(0, 10)).filter(Boolean)
  );

  const { result: ecountResult, error: ecountError } = await rollupEcountImportsForYear(
    supabase,
    year,
    secondClosedDates
  );

  const supplementalRollup = ecountResult.rollup;
  const ytdProduction = addYtdProductionRollups(snapshotRollup, supplementalRollup);

  const hasEcountActivity =
    ecountResult.lineCount > 0 ||
    ecountResult.skippedSecondClosedDates > 0 ||
    !!ecountError;

  const ecountMerge: ProductionEcountMergeInfo | null = hasEcountActivity
    ? {
        linesCounted: ecountResult.lineCount,
        skippedBecauseSecondClosed: ecountResult.skippedSecondClosedDates,
        supplementalRollup,
        error: ecountError?.message ?? null,
      }
    : null;

  const displayDays = mergeSnapshotDaysWithEcountByDate(days, ecountResult.byDate);

  return {
    bundle: {
      year,
      days: displayDays,
      ytdProduction,
      ytdWaste: rollupYtdWaste(days),
      ecountMerge,
    },
    error: null,
  };
}
