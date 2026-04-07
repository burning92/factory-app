/**
 * 제조설비 점검표 — 고정 체크리스트
 * 저장: 적합=O, 부적합=X (daily_manufacturing_equipment_log_items.result)
 */
export type ManufacturingEquipmentCategory = {
  title: string;
  questions: string[];
};

export const MANUFACTURING_EQUIPMENT_CHECKLIST: ManufacturingEquipmentCategory[] = [
  {
    title: "도우룸",
    questions: ["반죽기 1", "반죽기 2", "분할기", "라운더기"],
  },
  {
    title: "성형실",
    questions: ["도우성형기(스트레쳐)", "컨베이어", "호이스트"],
  },
  {
    title: "가열실",
    questions: [
      "컨베이어",
      "소스분사기",
      "터널오븐(화덕)",
      "데크오븐",
      "후드1",
      "피자삽",
      "타공판",
      "피자카트",
    ],
  },
  {
    title: "토핑실",
    questions: ["후드2", "원료보관용기"],
  },
  {
    title: "내포장실",
    questions: ["진공포장기1", "진공포장기2", "금속검출기1", "금속검출기2", "나무솔"],
  },
  {
    title: "외포장실",
    questions: ["지게차"],
  },
  {
    title: "공통",
    questions: ["유니트쿨러", "손건조기", "손세정대", "신발장", "에어커튼"],
  },
];
