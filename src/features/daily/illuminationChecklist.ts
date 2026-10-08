export type IlluminationChecklistItem = {
  index: number;
  label: string;
  minLux: number;
};

/** index = DB item_index. 기존 일지와 호환되도록 번호를 바꾸지 말고 새 항목은 끝에 추가할 것 */
export const ILLUMINATION_CHECKLIST: IlluminationChecklistItem[] = [
  { index: 1, label: "화장실 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 2, label: "탈의실 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 3, label: "2층 위생전실 중앙 바닥에서 80 cm 위", minLux: 220 },
  { index: 4, label: "2층 도우 숙성고 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 5, label: "2층 성형실 작업대 위", minLux: 220 },
  { index: 6, label: "2층 도우실 중앙 바닥에서 80 cm 위", minLux: 220 },
  { index: 7, label: "가열실 중앙 바닥에서 80 cm 위", minLux: 220 },
  { index: 8, label: "토핑실 작업대 위", minLux: 220 },
  { index: 9, label: "토핑 냉장고 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 10, label: "2층 내포장실 작업대 위", minLux: 540 },
  { index: 11, label: "선별실 중앙 바닥에서 80 cm 위", minLux: 540 },
  { index: 12, label: "2층 세척실 중앙 바닥에서 80 cm 위", minLux: 220 },
  { index: 13, label: "1층 냉장창고 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 14, label: "1층 냉동창고 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 15, label: "외포장실 중앙 바닥에서 80 cm 위", minLux: 220 },
  { index: 16, label: "3층 위생전실 중앙 바닥에서 80 cm 위", minLux: 220 },
  { index: 17, label: "3층 도우 숙성고 구역1 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 18, label: "3층 도우 숙성고 구역2 중앙 바닥에서 80 cm 위", minLux: 110 },
  { index: 19, label: "3층 성형실 작업대 위", minLux: 220 },
  { index: 20, label: "3층 도우실 중앙 바닥에서 80 cm 위", minLux: 220 },
  { index: 21, label: "3층 내포장실 작업대 위", minLux: 540 },
  { index: 22, label: "3층 세척실 중앙 바닥에서 80 cm 위", minLux: 220 },
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
