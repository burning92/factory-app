/**
 * 공조설비 점검표 — 고정 체크리스트
 * 저장: 적합=O, 부적합=X (daily_air_conditioning_equipment_log_items.result)
 */
export type AirConditioningEquipmentCategory = {
  title: string;
  questions: string[];
};

export const AIR_CONDITIONING_EQUIPMENT_CHECKLIST: AirConditioningEquipmentCategory[] = [
  {
    title: "2층 통로 에어컨",
    questions: ["작동상태", "필터청소"],
  },
  {
    title: "2층 휴게실 에어컨",
    questions: ["작동상태", "필터청소"],
  },
  {
    title: "2층 도우룸 에어컨",
    questions: ["작동상태", "필터청소"],
  },
  {
    title: "2층 원료반입실 에어컨",
    questions: ["작동상태", "필터청소"],
  },
  {
    title: "1층 외포장실 에어컨",
    questions: ["작동상태", "필터청소"],
  },
  {
    title: "1층 사무실 에어컨",
    questions: ["작동상태", "필터청소"],
  },
  { title: "2층 급기 공조기", questions: ["작동상태"] },
  { title: "2층 배기설비", questions: ["작동상태"] },
  { title: "2층 현장 쿨러", questions: ["작동상태"] },
  { title: "3층 급기 공조기", questions: ["작동상태"] },
  { title: "3층 배기설비", questions: ["작동상태"] },
  { title: "3층 현장 쿨러", questions: ["작동상태"] },
  { title: "2층 에어커튼", questions: ["작동상태"] },
  { title: "3층 에어커튼", questions: ["작동상태"] },
];
