/**
 * 호이스트 점검기록 — 고정 체크리스트
 * 저장: 적합=O, 부적합=X (daily_hoist_inspection_log_items.result)
 */
export type HoistInspectionCategory = {
  title: string;
  questions: string[];
};

export const HOIST_INSPECTION_CHECKLIST: HoistInspectionCategory[] = [
  {
    title: "외관 및 구조",
    questions: [
      "와이어로프의 마모, 풀림, 손상 여부",
      "도르래의 파손, 유격 여부",
      "프레임 및 박스의 변형, 균열 여부",
      "설비 내 이물, 분진, 결로 발생 여부",
    ],
  },
  {
    title: "운행 상태",
    questions: [
      "상·하강 시 이상 소음 발생 여부",
      "운행 중 흔들림 또는 편심 발생 여부",
      "정지 위치가 정상 위치에 정확히 정지하는지",
      "운행 중 주변 설비 또는 구조물과 간섭이 없는지",
    ],
  },
  {
    title: "조작 및 안전장치",
    questions: [
      "버튼 조작이 지연 없이 정상 작동하는지",
      "비상정지 스위치가 정상 작동하는지",
      "문 열림 시 정지 센서가 정상 작동하는지",
      "추락방지장치의 고정 상태가 양호한지",
    ],
  },
];

export type HoistOverallAssessment = "normal" | "observe" | "issue";

export const HOIST_OVERALL_ASSESSMENT_OPTIONS: Array<{
  value: HoistOverallAssessment;
  label: string;
}> = [
  { value: "normal", label: "이상없음" },
  { value: "observe", label: "관찰필요" },
  { value: "issue", label: "이상있음" },
];

