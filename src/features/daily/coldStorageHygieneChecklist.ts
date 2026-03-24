/**
 * 냉장 · 냉동온도 및 위생 점검일지 — 고정 체크리스트
 * 저장: 적합=O, 부적합=X
 */
export type ColdStorageCheckItem = {
  label: string;
  question: string;
};

export type ColdStorageHygieneCategory = {
  title: string;
  items: ColdStorageCheckItem[];
};

export const COLD_STORAGE_HYGIENE_CHECKLIST: ColdStorageHygieneCategory[] = [
  {
    title: "1. 위생 / 품질",
    items: [
      { label: "청결", question: "바닥, 내벽, 천정 등이 청결한가?" },
      { label: "정리", question: "창고 내부가 정리가 되어있는가?" },
      { label: "온도", question: "냉동고의 온도상태가 양호한가?" },
    ],
  },
  {
    title: "2. 보관",
    items: [
      { label: "적재", question: "제품의 적재상태는 양호한가?" },
      { label: "식별", question: "제품에 식별표시가 되어 있는가?" },
      { label: "선입선출", question: "선입선출이 가능한 보관상태인가?" },
      { label: "이격보관", question: "이격보관은 되어 있는가?" },
    ],
  },
  {
    title: "3. 환경",
    items: [
      { label: "시설1", question: "바닥, 내벽, 천정, 문 파손이 없는가?" },
      { label: "시설2", question: "소음, 진동, 녹, 떨림이 발생하는가?" },
    ],
  },
  {
    title: "4. 통제",
    items: [
      { label: "출입통제1", question: "담당자 이외의 출입이 통제되고 있는가?" },
      { label: "출입통제2", question: "출입시 복장상태는 청결한가?" },
    ],
  },
];

export function coldStorageQuestionText(item: ColdStorageCheckItem): string {
  return `${item.label}: ${item.question}`;
}
