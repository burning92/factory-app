/** 1차 마감 state_snapshot → 출고 입력용 2층 유지(keep_2f) 재고 참고 */

export type Keep2fLotLine = {
  expiryDate: string;
  unitCount: number;
  remainderG: number;
  /** 마감 생산일자 */
  fromDate: string;
};

export type Keep2fMaterialStock = {
  materialName: string;
  lots: Keep2fLotLine[];
  totalG: number;
};

type LotSnapshot = {
  expiryDate?: string;
  currentDayUnitCount?: number | "" | null;
  currentDayRemainderG?: number | "" | null;
  carryoverDisposition?: string | null;
};

type MaterialSnapshot = {
  materialName?: string;
  lots?: LotSnapshot[];
};

type DateGroupSnapshot = {
  materials?: MaterialSnapshot[];
};

type MaterialWeightMeta = {
  materialName: string;
  boxWeightG: number;
  unitWeightG: number;
};

function toNum(x: number | "" | null | undefined): number {
  if (x === "" || x === null || x === undefined) return 0;
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function hasPositiveCurrentStock(lot: LotSnapshot): boolean {
  return toNum(lot.currentDayUnitCount) > 0 || toNum(lot.currentDayRemainderG) > 0;
}

function stockLotToG(
  unitCount: number,
  remainderG: number,
  material?: MaterialWeightMeta
): number {
  if (!material) return remainderG;
  const box = material.boxWeightG ?? 0;
  const ea = material.unitWeightG ?? 0;
  if (box === 0 && ea === 0) return remainderG;
  const unitG = ea > 0 ? ea : box;
  return unitCount * unitG + remainderG;
}

/**
 * 생산일자 직전 1차 마감 스냅샷에서 keep_2f + 당일재고 > 0 인 LOT만 집계.
 * LOT별로 가장 최근 마감일 상태를 사용한다.
 */
export function buildKeep2fStockByMaterial(
  productionDate: string,
  dateStates: Record<string, { state_snapshot?: unknown }> | undefined,
  materials: MaterialWeightMeta[]
): Map<string, Keep2fMaterialStock> {
  const dateKey = productionDate.slice(0, 10);
  const prevDates = Object.keys(dateStates ?? {})
    .map((d) => d.slice(0, 10))
    .filter((d) => d < dateKey)
    .sort((a, b) => b.localeCompare(a));

  const latestByMaterialExpiry = new Map<
    string,
    Map<string, { lot: LotSnapshot; fromDate: string }>
  >();

  for (const d of prevDates) {
    const row = dateStates?.[d] ?? dateStates?.[`${d}T00:00:00`];
    const snap = row?.state_snapshot;
    if (!snap || typeof snap !== "object") continue;
    const cards = (snap as DateGroupSnapshot).materials ?? [];
    for (const card of cards) {
      const matName = (card.materialName ?? "").trim();
      if (!matName) continue;
      let byExpiry = latestByMaterialExpiry.get(matName);
      if (!byExpiry) {
        byExpiry = new Map();
        latestByMaterialExpiry.set(matName, byExpiry);
      }
      for (const lot of card.lots ?? []) {
        const expiry = (lot.expiryDate ?? "").trim();
        if (!expiry || byExpiry.has(expiry)) continue;
        byExpiry.set(expiry, { lot, fromDate: d });
      }
    }
  }

  const metaByName = new Map(materials.map((m) => [m.materialName, m]));
  const result = new Map<string, Keep2fMaterialStock>();

  for (const [matName, byExpiry] of Array.from(latestByMaterialExpiry.entries())) {
    const lots: Keep2fLotLine[] = [];
    for (const { lot, fromDate } of Array.from(byExpiry.values())) {
      if (lot.carryoverDisposition !== "keep_2f") continue;
      if (!hasPositiveCurrentStock(lot)) continue;
      lots.push({
        expiryDate: (lot.expiryDate ?? "").trim(),
        unitCount: toNum(lot.currentDayUnitCount),
        remainderG: toNum(lot.currentDayRemainderG),
        fromDate,
      });
    }
    if (lots.length === 0) continue;
    lots.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    const meta = metaByName.get(matName);
    let totalG = 0;
    for (const lot of lots) {
      totalG += stockLotToG(lot.unitCount, lot.remainderG, meta);
    }
    result.set(matName, { materialName: matName, lots, totalG });
  }

  return result;
}

/** 화면·출력용: 원료별 2층 유지 총량 (소비기한 제외) */
export function formatKeep2fTotalHint(
  stock: Keep2fMaterialStock,
  material?: Pick<MaterialWeightMeta, "boxWeightG" | "unitWeightG">
): string {
  return `2층 ${formatKeep2fTotalQtyText(stock, material)}`;
}

/** LOT 합산 낱개·잔량 → 표시 문자열 */
export function formatKeep2fTotalQtyText(
  stock: Keep2fMaterialStock,
  material?: Pick<MaterialWeightMeta, "boxWeightG" | "unitWeightG">
): string {
  let totalUnits = 0;
  let totalRemG = 0;
  for (const lot of stock.lots) {
    totalUnits += lot.unitCount;
    totalRemG += lot.remainderG;
  }
  const parts: string[] = [];
  const box = material?.boxWeightG ?? 0;
  const ea = material?.unitWeightG ?? 0;
  const gOnly = box === 0 && ea === 0;
  if (!gOnly && totalUnits > 0) parts.push(`${totalUnits.toLocaleString()}개`);
  if (totalRemG > 0) parts.push(`${totalRemG.toLocaleString()}g`);
  if (parts.length > 0) return parts.join(" ");
  if (stock.totalG > 0) return `${stock.totalG.toLocaleString()}g`;
  return "—";
}

/** 출고 입력 모달용 LOT 1줄 (소비기한 포함) */
export function formatKeep2fLotLine(
  lot: Keep2fLotLine,
  material?: Pick<MaterialWeightMeta, "boxWeightG" | "unitWeightG">
): string {
  const qty = formatKeep2fLotQtyText(lot, material);
  return `${qty} · ${lot.expiryDate}`;
}

export function formatKeep2fLotQtyText(
  lot: Pick<Keep2fLotLine, "unitCount" | "remainderG">,
  material?: Pick<MaterialWeightMeta, "boxWeightG" | "unitWeightG">
): string {
  const parts: string[] = [];
  const box = material?.boxWeightG ?? 0;
  const ea = material?.unitWeightG ?? 0;
  const gOnly = box === 0 && ea === 0;
  if (!gOnly && lot.unitCount > 0) parts.push(`${lot.unitCount}개`);
  if (lot.remainderG > 0) parts.push(`${lot.remainderG.toLocaleString()}g`);
  return parts.length > 0 ? parts.join(" ") : "—";
}

/** @deprecated formatKeep2fTotalHint 사용 */
export function formatKeep2fPrintHint(
  stock: Keep2fMaterialStock,
  material?: Pick<MaterialWeightMeta, "boxWeightG" | "unitWeightG">
): string {
  return formatKeep2fTotalHint(stock, material);
}
