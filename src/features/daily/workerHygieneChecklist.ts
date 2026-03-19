/**
 * 작업자 위생점검일지 — 고정 체크리스트
 * 조직·점검일자당 헤더 1건: 담당자가 현장 작업자 전체를 기준으로 종합 판정 (개인별 행 아님)
 * 저장: 적합=O, 부적합=X
 */
export type WorkerHygieneCategory = {
  title: string;
  questions: string[];
};

/** 예전 구분명으로 저장된 행·이탈내용 자동문구 호환 */
export const WORKER_HYGIENE_LEGACY_CATEGORY_TITLE = "작업자 개인위생";

export const WORKER_HYGIENE_PRIMARY_CATEGORY_TITLE = "현장 작업자 위생";

export function normalizeWorkerHygieneCategoryTitle(stored: string): string {
  if (stored === WORKER_HYGIENE_LEGACY_CATEGORY_TITLE) {
    return WORKER_HYGIENE_PRIMARY_CATEGORY_TITLE;
  }
  return stored;
}

export const WORKER_HYGIENE_CHECKLIST: WorkerHygieneCategory[] = [
  {
    title: WORKER_HYGIENE_PRIMARY_CATEGORY_TITLE,
    questions: [
      "작업복장 착용상태는 양호한가? (위생복, 위생모, 위생화, 마스크, 앞치마 등)",
      "작업자 청결상태는 양호한가? (손톱청결, 매니큐어 금지, 머리 청결상태)",
      "지정된 작업자 외 개인소지품을 소지하고 있지 아니한가? (담배, 볼펜, 휴대폰, 개인소지품)",
      "작업중 불필요한 잡담이나 행동을 하지 않는가?",
      "작업자가 별도의 위생처리 없이 다른 구역으로 이동하고 있지 않는가?",
      "작업장 출입시 작업장 입출입 요령을 지키고 있는가?",
    ],
  },
];
