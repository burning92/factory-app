import type { DateGroupInput } from "@/features/production/history/types";
import type { BomRowRef } from "@/features/production/history/types";
import type { MaterialMeta } from "@/features/production/history/calculations";
import { calculateUsageSummary } from "@/features/production/history/calculations";
import {
  categorizeFinishedProduct,
  isUjuinParbakeFinishedProductLabel,
} from "@/features/dashboard/productCategoryRules";

export type DayProductionSnapshotRow = {
  production_date: string;
  second_closed_at: string | null;
  state_snapshot: unknown;
};

export type DayProductionMetrics = {
  date: string;
  totalFinishedQty: number;
  doughMixQty: number;
  doughWasteQty: number;
  parbakeWasteQty: number;
  sameDayParbakeProductionQty: number;
  astronautParbakeQty: number;
  saleParbakeQty: number;
  finishedLightPizza: number;
  finishedHeavyPizza: number;
  finishedBread: number;
  finishedOther: number;
};

export type YtdWasteRollup = {
  /** 가중: Σ폐기 / Σ분모 × 100 */
  doughDiscardRatePct: number | null;
  parbakeDiscardRatePct: number | null;
  overallDiscardRatePct: number | null;
  sumDoughMix: number;
  sumDoughWaste: number;
  sumParbakeWaste: number;
  sumSameDayParbakeProduction: number;
  closedDayCount: number;
};

export type YtdProductionRollup = {
  lightPizza: number;
  heavyPizza: number;
  bread: number;
  other: number;
  astronautParbake: number;
  saleParbake: number;
};

export function addYtdProductionRollups(a: YtdProductionRollup, b: YtdProductionRollup): YtdProductionRollup {
  return {
    lightPizza: a.lightPizza + b.lightPizza,
    heavyPizza: a.heavyPizza + b.heavyPizza,
    bread: a.bread + b.bread,
    other: a.other + b.other,
    astronautParbake: a.astronautParbake + b.astronautParbake,
    saleParbake: a.saleParbake + b.saleParbake,
  };
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 2차 마감 스냅샷 1건 → 일별 지표. 계산 실패 시 null.
 */
export function metricsFromSnapshot(
  productionDate: string,
  stateSnapshot: unknown,
  bomRefs: BomRowRef[],
  materialsMeta: MaterialMeta[]
): DayProductionMetrics | null {
  if (!stateSnapshot || typeof stateSnapshot !== "object") return null;
  const input = stateSnapshot as DateGroupInput;
  if (!input.date || !input.secondClosure) return null;
  let computed;
  try {
    computed = calculateUsageSummary(input, bomRefs, materialsMeta);
  } catch {
    return null;
  }

  let finishedLightPizza = 0;
  let finishedHeavyPizza = 0;
  let finishedBread = 0;
  let finishedOther = 0;
  let ujuinParbakeFromFinished = 0;
  for (const p of computed.productSummaries) {
    const qty = safeNum(p.finishedQty);
    if (qty <= 0) continue;
    if (isUjuinParbakeFinishedProductLabel(p.displayProductLabel)) {
      ujuinParbakeFromFinished += qty;
      continue;
    }
    const bucket = categorizeFinishedProduct(p.displayProductLabel, p.isBreadProduct);
    switch (bucket) {
      case "light_pizza":
        finishedLightPizza += qty;
        break;
      case "heavy_pizza":
        finishedHeavyPizza += qty;
        break;
      case "bread":
        finishedBread += qty;
        break;
      default:
        finishedOther += qty;
    }
  }

  return {
    date: productionDate.slice(0, 10),
    totalFinishedQty: safeNum(computed.totalFinishedQty),
    doughMixQty: safeNum(computed.doughMixQty),
    doughWasteQty: safeNum(computed.doughWasteQty),
    parbakeWasteQty: safeNum(computed.parbakeWasteQty),
    sameDayParbakeProductionQty: safeNum(computed.sameDayParbakeProductionQty),
    astronautParbakeQty:
      safeNum(computed.astronautParbakeQty) + ujuinParbakeFromFinished,
    saleParbakeQty: safeNum(computed.saleParbakeQty),
    finishedLightPizza,
    finishedHeavyPizza,
    finishedBread,
    finishedOther,
  };
}

export function rollupYtdProduction(days: DayProductionMetrics[]): YtdProductionRollup {
  const r: YtdProductionRollup = {
    lightPizza: 0,
    heavyPizza: 0,
    bread: 0,
    other: 0,
    astronautParbake: 0,
    saleParbake: 0,
  };
  for (const d of days) {
    r.lightPizza += d.finishedLightPizza;
    r.heavyPizza += d.finishedHeavyPizza;
    r.bread += d.finishedBread;
    r.other += d.finishedOther;
    r.astronautParbake += d.astronautParbakeQty;
    r.saleParbake += d.saleParbakeQty;
  }
  return r;
}

export function rollupYtdWaste(days: DayProductionMetrics[]): YtdWasteRollup {
  let sumDoughMix = 0;
  let sumDoughWaste = 0;
  let sumParbakeWaste = 0;
  let sumSameDayParbakeProduction = 0;
  for (const d of days) {
    sumDoughMix += d.doughMixQty;
    sumDoughWaste += d.doughWasteQty;
    sumParbakeWaste += d.parbakeWasteQty;
    sumSameDayParbakeProduction += d.sameDayParbakeProductionQty;
  }
  const closedDayCount = days.length;
  return {
    closedDayCount,
    sumDoughMix,
    sumDoughWaste,
    sumParbakeWaste,
    sumSameDayParbakeProduction,
    doughDiscardRatePct:
      sumDoughMix > 0 ? (sumDoughWaste / sumDoughMix) * 100 : null,
    parbakeDiscardRatePct:
      sumSameDayParbakeProduction > 0
        ? (sumParbakeWaste / sumSameDayParbakeProduction) * 100
        : null,
    overallDiscardRatePct:
      sumDoughMix > 0
        ? ((sumDoughWaste + sumParbakeWaste) / sumDoughMix) * 100
        : null,
  };
}

export function processSnapshotRows(
  rows: DayProductionSnapshotRow[],
  bomRefs: BomRowRef[],
  materialsMeta: MaterialMeta[]
): DayProductionMetrics[] {
  const out: DayProductionMetrics[] = [];
  for (const row of rows) {
    if (!row.second_closed_at) continue;
    const m = metricsFromSnapshot(row.production_date, row.state_snapshot, bomRefs, materialsMeta);
    if (m) out.push(m);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
