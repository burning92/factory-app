/** 마감 state_snapshot.materials → 원료별 잔량 반납(g) */

export type FirstCloseLotInput = {
  currentDayUnitCount?: number | "" | null;
  currentDayRemainderG?: number | "" | null;
  carryoverDisposition?: "keep_2f" | "move_1f" | string | null;
};

export type FirstCloseMaterialCardInput = {
  materialName?: string | null;
  lots?: FirstCloseLotInput[] | null;
};

export type MaterialWeightMeta = {
  materialName: string;
  unitWeightG: number;
  boxWeightG: number;
};

function toNum(x: unknown): number {
  if (x === "" || x === null || x === undefined) return 0;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** 전날/당일 재고를 낱개+잔량(g)에서 총 g로 환산 (생산일지 calculations와 동일) */
export function stockLotToG(
  unitCount: number | "" | null | undefined,
  remainderG: number | "" | null | undefined,
  meta: MaterialWeightMeta | undefined
): number {
  const u = toNum(unitCount);
  const r = toNum(remainderG);
  if (!meta) return r;
  const isGOnly = meta.boxWeightG === 0 && meta.unitWeightG === 0;
  if (isGOnly || meta.unitWeightG <= 0) return r;
  return u * meta.unitWeightG + r;
}

function parseMaterialsFromSnapshot(stateSnapshot: unknown): FirstCloseMaterialCardInput[] {
  if (!stateSnapshot || typeof stateSnapshot !== "object") return [];
  const materials = (stateSnapshot as { materials?: unknown }).materials;
  if (!Array.isArray(materials)) return [];
  return materials as FirstCloseMaterialCardInput[];
}

/** 전량 사용(당일 재고 0·LOT 상태 미선택) — Lab 반납 제외 */
export function isFirstCloseLotConsumed(lot: FirstCloseLotInput, meta: MaterialWeightMeta | undefined): boolean {
  const disposition = lot.carryoverDisposition;
  if (disposition === "keep_2f" || disposition === "move_1f") return false;
  const isGOnly = meta ? meta.boxWeightG === 0 && meta.unitWeightG === 0 : true;
  const units = !isGOnly && typeof lot.currentDayUnitCount === "number" ? lot.currentDayUnitCount : 0;
  const grams = typeof lot.currentDayRemainderG === "number" ? lot.currentDayRemainderG : 0;
  return units === 0 && grams === 0;
}

/**
 * 2층 유지·1층 이관 모두 당일 잔량 반납으로 집계 (보관 위치만 다름).
 * 전량 사용(소모)만 제외.
 */
export function computeFirstCloseReturnGByMaterial(
  materials: FirstCloseMaterialCardInput[],
  materialsMeta: MaterialWeightMeta[]
): Map<string, number> {
  const metaByName = new Map<string, MaterialWeightMeta>();
  for (const m of materialsMeta) {
    const name = String(m.materialName ?? "").trim();
    if (name) metaByName.set(name, m);
  }

  const byName = new Map<string, number>();
  for (const card of materials) {
    const materialName = String(card.materialName ?? "").trim();
    if (!materialName) continue;
    const meta = metaByName.get(materialName);
    let sum = 0;
    for (const lot of card.lots ?? []) {
      if (isFirstCloseLotConsumed(lot, meta)) continue;
      const g = stockLotToG(lot.currentDayUnitCount, lot.currentDayRemainderG, meta);
      if (g > 0) sum += g;
    }
    if (sum > 0) {
      byName.set(materialName, (byName.get(materialName) ?? 0) + sum);
    }
  }
  return byName;
}

export function computeFirstCloseReturnGByMaterialFromSnapshot(
  stateSnapshot: unknown,
  materialsMeta: MaterialWeightMeta[]
): Map<string, number> {
  return computeFirstCloseReturnGByMaterial(parseMaterialsFromSnapshot(stateSnapshot), materialsMeta);
}
