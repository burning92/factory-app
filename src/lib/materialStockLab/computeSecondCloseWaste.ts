import { calculateUsageSummary } from "@/features/production/history/calculations";
import type { BomRowRef, DateGroupInput } from "@/features/production/history/types";
import type { MaterialWeightMeta } from "@/lib/materialStockLab/computeFirstCloseReturns";

function snapshotToDateGroupInput(stateSnapshot: unknown): DateGroupInput | null {
  if (!stateSnapshot || typeof stateSnapshot !== "object") return null;
  const s = stateSnapshot as Record<string, unknown>;
  const materials = Array.isArray(s.materials) ? s.materials : [];
  const secondClosure = s.secondClosure;
  if (!secondClosure || typeof secondClosure !== "object") return null;
  return {
    id: String(s.id ?? s.date ?? ""),
    date: String(s.date ?? "").slice(0, 10),
    doughMixQty: (s.doughMixQty as DateGroupInput["doughMixQty"]) ?? "",
    doughWasteQty: (s.doughWasteQty as DateGroupInput["doughWasteQty"]) ?? "",
    materials: materials as DateGroupInput["materials"],
    products: Array.isArray(s.products) ? (s.products as DateGroupInput["products"]) : [],
    secondClosure: secondClosure as DateGroupInput["secondClosure"],
  };
}

/**
 * 2차 마감 스냅샷 → 베이스소스(토마토·파마산 등) 폐기량(g) 원료별 합산.
 * calculateUsageSummary의 baseWasteRows 기준.
 */
export function computeSecondCloseWasteGByMaterial(
  stateSnapshot: unknown,
  bomList: BomRowRef[],
  materialsMeta: MaterialWeightMeta[]
): Map<string, number> {
  const input = snapshotToDateGroupInput(stateSnapshot);
  if (!input) return new Map();

  const result = calculateUsageSummary(input, bomList, materialsMeta);
  const byName = new Map<string, number>();

  for (const row of result.baseWasteRows) {
    if (!row.resolved || !row.baseSauceMaterialName) continue;
    const g = Math.round(Number(row.baseWasteQty) || 0);
    if (g <= 0) continue;
    const name = row.baseSauceMaterialName.trim();
    byName.set(name, (byName.get(name) ?? 0) + g);
  }

  return byName;
}
