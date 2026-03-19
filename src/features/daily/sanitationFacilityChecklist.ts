/**
 * 위생시설관리점검일지 — 고정 체크리스트 (하루 1건 입력)
 * 저장: 적합=O, 부적합=X (daily_sanitation_facility_log_items.result)
 */
export type SanitationFacilityCategory = {
  title: string;
  questions: string[];
};

export const SANITATION_FACILITY_CHECKLIST: SanitationFacilityCategory[] = [
  {
    title: "손세척/소독시설",
    questions: [
      "손세척 시설은 청결한가?",
      "냉, 온수가 공급되는가?",
      "물비누는 충분히 보충되어 있는가?",
      "손건조기는 정상작동하는가?",
      "손소독액은 충분히 보충되어 있는가?",
    ],
  },
  {
    title: "포충등/트랩",
    questions: ["유인등이 작동하는가?", "끈끈이는 청결한가?"],
  },
  {
    title: "끈끈이롤러",
    questions: ["청결히 관리되고 있는가?"],
  },
  {
    title: "도구 소독기/살균기",
    questions: ["전원은 정상적으로 들어오는가?", "UV등/온도는 작동되고 있는가?"],
  },
  {
    title: "세제·소독제 보관함",
    questions: [
      "시건장치가 있어 통제되고 있는가?",
      "보관함은 정위치에 보관되고 있는가?",
      "세제의 라벨링은 정확히 부착되어 있는가?",
    ],
  },
  {
    title: "청소도구 보관함",
    questions: [
      "파손된 청소도구는 없는가?",
      "깨끗이 정리정돈 되어있는가?",
      "청소도구에 이물이 없이 청결한가?",
      "청소도구 보관실에 비치되어있는가?",
    ],
  },
];
