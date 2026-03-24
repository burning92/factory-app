export type ThawingResult = "O" | "X";

export function parseOptionalNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

export function calcTotalWeightG(
  boxQty: string,
  unitQty: string,
  remainderG: string,
  boxWeightG: number,
  unitWeightG: number
): number {
  const bq = parseOptionalNum(boxQty) ?? 0;
  const uq = parseOptionalNum(unitQty) ?? 0;
  const rg = parseOptionalNum(remainderG) ?? 0;
  return Math.round((bq * boxWeightG + uq * unitWeightG + rg) * 10) / 10;
}

export function buildRawThawingAutoDeviationText(input: {
  tempC: string;
  odor: ThawingResult | "";
  color: ThawingResult | "";
  foreign: ThawingResult | "";
}): string {
  const lines: string[] = [];
  const t = parseOptionalNum(input.tempC);
  if (t != null && t > 10) {
    lines.push(`해동 창고 온도: ${t.toFixed(1)}℃ / 기준 10℃ 이하`);
  }
  if (input.odor === "X") lines.push("관능검사(이취): 부적합");
  if (input.color === "X") lines.push("관능검사(색깔): 부적합");
  if (input.foreign === "X") lines.push("이물오염 여부 확인: 부적합");
  return lines.join("\n");
}

export function hasRawThawingIssue(input: {
  tempC: string;
  odor: ThawingResult | "";
  color: ThawingResult | "";
  foreign: ThawingResult | "";
}): boolean {
  const t = parseOptionalNum(input.tempC);
  return (t != null && t > 10) || input.odor === "X" || input.color === "X" || input.foreign === "X";
}
