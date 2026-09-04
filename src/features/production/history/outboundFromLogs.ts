import type { OutboundLine, ProductionLog } from "@/store/useMasterStore";
import { computeOutboundTotalG } from "@/features/production/outbound/computeOutboundTotalG";

export type MaterialWeightLike = {
  materialName: string;
  boxWeightG: number;
  unitWeightG: number;
};

/** production_log → 출고 라인 배열 (추가 출고 append 포함) */
export function getOutboundLinesFromLog(log: ProductionLog): OutboundLine[] {
  if (Array.isArray(log.출고_라인) && log.출고_라인.length > 0) {
    return log.출고_라인;
  }
  return [
    {
      소비기한: log.소비기한 ?? "",
      박스: log.출고_박스 ?? 0,
      낱개: log.출고_낱개 ?? 0,
      g: log.출고_g ?? 0,
    },
  ];
}

export type OutboundQtyByMaterialExpiry = Map<
  string,
  { materialName: string; expiryDate: string; outboundQty: number }
>;

/**
 * production_logs → (원료명, 소비기한)별 출고량(g) 합산.
 * 추가 출고(출고_라인 append·신규 log)도 동일 경로로 사용량 계산에 반영된다.
 */
export function aggregateOutboundQtyByMaterialAndExpiry(
  logs: ProductionLog[],
  materials: MaterialWeightLike[]
): OutboundQtyByMaterialExpiry {
  const byKey = new Map<string, { materialName: string; expiryDate: string; outboundQty: number }>();

  for (const log of logs) {
    const materialName = (log.원료명 ?? "").trim();
    if (!materialName) continue;
    const mat = materials.find((m) => m.materialName === materialName);
    const meta = mat ? { boxWeightG: mat.boxWeightG, unitWeightG: mat.unitWeightG } : null;

    for (const line of getOutboundLinesFromLog(log)) {
      const expiryDate = (line.소비기한 ?? "").trim();
      const key = `${materialName}\t${expiryDate}`;
      const lineG = computeOutboundTotalG(
        [{ 박스: line.박스 ?? 0, 낱개: line.낱개 ?? 0, g: line.g ?? 0 }],
        meta
      );
      const existing = byKey.get(key);
      if (existing) {
        existing.outboundQty += lineG;
      } else {
        byKey.set(key, { materialName, expiryDate, outboundQty: lineG });
      }
    }
  }

  return byKey;
}

/** mergeOutboundFromLogsForDate: 기존 from-log LOT 출고량 갱신 */
export function syncFromLogOutboundQty(
  existingOutboundQty: number,
  sourceType: "from-log" | "manual",
  freshOutboundQty: number | undefined
): number {
  if (sourceType === "manual") return existingOutboundQty;
  if (freshOutboundQty === undefined) return 0;
  return freshOutboundQty;
}
