export type IlluminationChecklistItem = {
  index: number;
  label: string;
  minLux: number;
};

export const ILLUMINATION_CHECKLIST: IlluminationChecklistItem[] = [
  { index: 1, label: "화장실 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 2, label: "탈의실 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 3, label: "위생전실 중앙 바닥에서 80 cm 위", minLux: 220 },
  { index: 4, label: "도우 숙성고 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 5, label: "성형실 작업대 위", minLux: 220 },
  { index: 6, label: "도우실 중앙 바닥에서 80 cm 위", minLux: 220 },
  { index: 7, label: "가열실 중앙 바닥에서 80 cm 위", minLux: 220 },
  { index: 8, label: "토핑실 작업대 위", minLux: 220 },
  { index: 9, label: "토핑 냉장고 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 10, label: "내포장실 작업대 위", minLux: 540 },
  { index: 11, label: "선별실 중앙 바닥에서 80 cm 위", minLux: 540 },
  { index: 12, label: "세척실 중앙 바닥에서 80 cm 위", minLux: 220 },
  { index: 13, label: "1층 냉장창고 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 14, label: "1층 냉동창고 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 15, label: "외포장실 중앙 바닥에서 80 cm 위", minLux: 220 },
];

export function parseLux(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function conformityFromLux(measuredLux: number | null, minLux: number): "O" | "X" | null {
  if (measuredLux == null) return null;
  return measuredLux >= minLux ? "O" : "X";
}
