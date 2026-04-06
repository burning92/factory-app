import type { SupabaseClient } from "@supabase/supabase-js";
import type { YtdProductionRollup } from "@/features/dashboard/aggregateProductionFromSnapshots";
import {
  categorizeFinishedProduct,
  isUjuinParbakeFinishedProductLabel,
  normalizeDashboardLabel,
} from "@/features/dashboard/productCategoryRules";
import { mapEcountImportLine } from "@/features/dashboard/ecountProductCanonicalize";

/** 선인 파베이크 계열(이카운트 품목명) → 판매용 파베 생산으로 집계, 스킵하지 않음 */
export function isEcountSeoninSaleParbakeProductName(itemName: string): boolean {
  const n = normalizeDashboardLabel(itemName);
  if (!n.includes("선인")) return false;
  return n.includes("파베이크") || n.includes("파베");
}

/** 이카운트 집계에 넣지 않는 반제품·도우 라인 (완제품·파베이크 피자는 제외) */
export function shouldSkipEcountItemName(itemName: string): boolean {
  const n = normalizeDashboardLabel(itemName);
  if (isUjuinParbakeFinishedProductLabel(itemName)) return false;
  if (isEcountSeoninSaleParbakeProductName(itemName)) return false;
  if (n.includes("판매") && (n.includes("파베") || n.includes("파베이크"))) return false;
  if (n.includes("볼도우") || n.includes("미스터피자")) return true;
  if (n.includes("씬도우") || n.includes("씬 도우")) return true;
  if (n.includes("포켓형") && n.includes("도우")) return true;
  if (n.includes("화이트마르게") && n.includes("도우")) return true;
  return false;
}

/**
 * 생산입고 한 줄 → 대시보드 생산량 버킷.
 * 품목명은 이카운트 품목명/규격 컬럼 기준.
 *
 * - 우주인 화덕파베이크 도우-* 등: 보관용(우주인) 파베이크 생산 → astronautParbake
 * - 선인 * 파베이크 * 도우 등: 판매용 파베이크 생산 → saleParbake
 */
export function classifyEcountItemForDashboard(itemName: string): keyof YtdProductionRollup | "skip" {
  if (shouldSkipEcountItemName(itemName)) return "skip";
  const n = normalizeDashboardLabel(itemName);
  if (isEcountSeoninSaleParbakeProductName(itemName)) return "saleParbake";
  if (n.includes("판매") && (n.includes("파베") || n.includes("파베이크"))) return "saleParbake";
  if (isUjuinParbakeFinishedProductLabel(itemName)) return "astronautParbake";
  if (
    n.includes("우주인") &&
    n.includes("도우") &&
    (n.includes("파베이크") || n.includes("파베") || n.includes("화덕파베"))
  ) {
    return "astronautParbake";
  }
  const bucket = categorizeFinishedProduct(itemName, false);
  switch (bucket) {
    case "light_pizza":
      return "lightPizza";
    case "heavy_pizza":
      return "heavyPizza";
    case "bread":
      return "bread";
    case "other":
      return "other";
  }
}

function emptyRollup(): YtdProductionRollup {
  return {
    lightPizza: 0,
    heavyPizza: 0,
    bread: 0,
    other: 0,
    astronautParbake: 0,
    saleParbake: 0,
  };
}

export type EcountImportRollupResult = {
  rollup: YtdProductionRollup;
  /** 2차 마감이 없는 날짜만 — 일별 표 병합용 */
  byDate: Map<string, YtdProductionRollup>;
  lineCount: number;
  skippedSecondClosedDates: number;
};

const DEFAULT_RECEIPT_TYPE = "생산입고";

/**
 * 해당 연도 이카운트 행 중 생산입고만 합산. secondClosedDates에 있는 일자는 앱 2차마감과 이중계상 방지를 위해 제외.
 */
export async function rollupEcountImportsForYear(
  supabase: SupabaseClient,
  year: number,
  secondClosedDates: Set<string>
): Promise<{ result: EcountImportRollupResult; error: Error | null }> {
  const { data, error } = await supabase
    .from("ecount_production_import_lines")
    .select("movement_date, item_name, quantity, movement_type")
    .gte("movement_date", `${year}-01-01`)
    .lte("movement_date", `${year}-12-31`);

  if (error) {
    return {
      result: {
        rollup: emptyRollup(),
        byDate: new Map(),
        lineCount: 0,
        skippedSecondClosedDates: 0,
      },
      error: new Error(error.message),
    };
  }

  const rollup = emptyRollup();
  const byDate = new Map<string, YtdProductionRollup>();
  let lineCount = 0;
  let skippedSecondClosedDates = 0;

  for (const row of data ?? []) {
    const mt = String((row as { movement_type?: string }).movement_type ?? "").trim();
    if (mt !== DEFAULT_RECEIPT_TYPE) continue;

    const dateStr = String((row as { movement_date?: string }).movement_date ?? "").slice(0, 10);
    if (!dateStr) continue;

    if (secondClosedDates.has(dateStr)) {
      skippedSecondClosedDates += 1;
      continue;
    }

    const rawItemName = String((row as { item_name?: string }).item_name ?? "").trim();
    const qtyRaw = Number((row as { quantity?: unknown }).quantity);
    if (!rawItemName || !Number.isFinite(qtyRaw) || qtyRaw === 0) continue;

    if (shouldSkipEcountItemName(rawItemName)) continue;

    const mapped = mapEcountImportLine(rawItemName);
    if (!mapped.canonicalName) continue;

    const qty = qtyRaw * mapped.multiplier;
    if (qty === 0) continue;

    const key = classifyEcountItemForDashboard(mapped.canonicalName);
    if (key === "skip") continue;

    let dayRollup = byDate.get(dateStr);
    if (!dayRollup) {
      dayRollup = emptyRollup();
      byDate.set(dateStr, dayRollup);
    }
    dayRollup[key] += qty;
    rollup[key] += qty;
    lineCount += 1;
  }

  return {
    result: { rollup, byDate, lineCount, skippedSecondClosedDates },
    error: null,
  };
}
