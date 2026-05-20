/** 출고 라인 → 총 출고량(g). 박스·낱개는 materials 중량으로 환산. */
export type OutboundLineWeightInput = {
  박스?: number;
  낱개?: number;
  g?: number;
};

export type MaterialWeightMeta = {
  boxWeightG: number;
  unitWeightG: number;
};

/**
 * 총 출고량(g) = (박스 × 박스중량) + (낱개 × 낱개중량) + 잔량(g)
 * g전용(box/unit 0)이면 잔량(g)만 합산.
 */
export function computeOutboundTotalG(
  lines: OutboundLineWeightInput[],
  material: MaterialWeightMeta | undefined | null
): number {
  if (!lines.length) return 0;
  const boxG = Number(material?.boxWeightG) || 0;
  const unitG = Number(material?.unitWeightG) || 0;
  const isGOnly = boxG === 0 && unitG === 0;
  let total = 0;
  for (const line of lines) {
    const box = Number(line.박스) || 0;
    const bag = Number(line.낱개) || 0;
    const g = Number(line.g) || 0;
    if (isGOnly) {
      total += g;
    } else {
      const unitW = unitG > 0 ? unitG : boxG;
      total += box * boxG + bag * unitW + g;
    }
  }
  return total;
}
