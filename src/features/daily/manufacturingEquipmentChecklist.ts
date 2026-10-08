/**
 * 제조설비 점검표 — 고정 체크리스트
 * 저장: 적합=O, 부적합=X (daily_manufacturing_equipment_log_items.result)
 * 항목 매칭은 (category, question_text) 기준. question_index는 표시 순서일 뿐이며 과거 일지와 다를 수 있음.
 * 2층 분류는 과거 일지와 호환되도록 층 접두어 없이 저장한다.
 */
export type ManufacturingEquipmentCategory = {
  /** DB category 값 */
  key: string;
  /** 화면 표시용 분류명 */
  title: string;
  questions: string[];
};

export type ManufacturingEquipmentFloor = {
  floor: string;
  categories: ManufacturingEquipmentCategory[];
};

function floorCategories(prefix: string, defs: { title: string; questions: string[] }[]): ManufacturingEquipmentCategory[] {
  return defs.map((d) => ({ key: prefix ? `${prefix} ${d.title}` : d.title, title: d.title, questions: d.questions }));
}

export const MANUFACTURING_EQUIPMENT_FLOORS: ManufacturingEquipmentFloor[] = [
  {
    floor: "2층",
    categories: floorCategories("", [
      { title: "원료반입실", questions: ["전동자키"] },
      { title: "도우룸", questions: ["반죽기 1", "반죽기 2", "분할기", "라운더기", "L카"] },
      { title: "성형실", questions: ["도우성형기(스트레쳐)", "컨베이어 1호기 (스트레쳐 앞)"] },
      {
        title: "가열실",
        questions: [
          "컨베이어 2호기 (소스기계쪽 꺾인)",
          "소스분사기",
          "컨베이어 3호기 (화덕 입구)",
          "터널오븐(화덕)",
          "컨베이어 4호기 (화덕 토출구)",
          "컨베이어 5호기 (화덕 토출 후 긴)",
          "데크오븐",
          "후드1",
          "피자삽",
          "타공판",
          "피자카트",
        ],
      },
      { title: "토핑실", questions: ["원료보관용기"] },
      { title: "내포장실", questions: ["진공포장기1", "진공포장기2", "금속검출기1"] },
      { title: "외포장실", questions: ["지게차"] },
      { title: "공통", questions: ["락카", "신발장"] },
    ]),
  },
  {
    floor: "3층",
    categories: floorCategories("3층", [
      { title: "도우룸", questions: ["L카"] },
      { title: "성형실", questions: ["스피너", "컨베이어 6호기 (스피너 앞 꺾인)"] },
      {
        title: "가열실",
        questions: [
          "컨베이어 7호기 (화덕 투입 전)",
          "컨베이어 8호기 (화덕 입구)",
          "터널오븐(화덕)",
          "컨베이어 9호기 (화덕 토출구)",
          "컨베이어 10호기 (화덕 토출 후 긴)",
          "피자삽",
        ],
      },
      { title: "내포장실", questions: ["삼면포장기", "금속검출기2", "피자카트"] },
      { title: "부자재창고", questions: ["전동자키", "스태커"] },
      { title: "공통", questions: ["락카", "신발장"] },
    ]),
  },
];

export const MANUFACTURING_EQUIPMENT_CHECKLIST: ManufacturingEquipmentCategory[] = MANUFACTURING_EQUIPMENT_FLOORS.flatMap(
  (f) => f.categories
);

export function manufacturingItemKey(category: string, question: string): string {
  return `${category}::${question}`;
}
