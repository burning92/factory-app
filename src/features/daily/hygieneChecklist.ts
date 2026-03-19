/**
 * 영업장환경위생점검일지 - 고정 체크리스트 (대상별 점검사항)
 */
export type HygieneCategory = {
  title: string;
  questions: string[];
};

export const HYGIENE_CHECKLIST: HygieneCategory[] = [
  {
    title: "출입문",
    questions: [
      "작업실 출입문은 밀폐되어 있고 청결하게 관리되고 있는가?",
      "출입구의 손세척 시설 및 소독설비건조시설의 관리는 적절한가?",
      "신발장의 청소상태는 양호한가?",
    ],
  },
  {
    title: "바닥",
    questions: [
      "작업실 내부 바닥은 패이거나 물이 고인 곳은 없는가?",
      "설비/전기 공급설비가 있는 바닥에 부식된 곳이나 구멍, 거미줄 등은 없는가?",
    ],
  },
  {
    title: "내벽",
    questions: [
      "먼지가 쌓여있거나 거미줄은 없는가?",
      "파손되거나 갈라진 틈은 없는가?",
    ],
  },
  {
    title: "천정",
    questions: [
      "먼지가 쌓여있거나 거미줄은 없는가?",
      "빗물이 새거나 또는 응결수가 떨어지거나 오염된 곳은 없는가?",
      "천정에 있는 전기공급 설비 등이 부식된 곳, 도색이 벗겨진 곳은 없는가?",
      "천정에 있는 조명은 보호갓이 있는가?",
    ],
  },
  {
    title: "배관",
    questions: [
      "배관이나 패킹류는 인체에 무해한 것을 사용하고 있는가?",
      "배관등에 응결수가 발생되거나 누수되고 있는 곳은 없는가?",
    ],
  },
  {
    title: "통로",
    questions: [
      "작업장별로 구획이 되었으며 교차오염 되는 곳은 없는가?",
      "작업자 이동경로에 따라 적절하게 소독설비를 갖추고 있는가?",
    ],
  },
  {
    title: "환기시설",
    questions: [
      "환기시설에 의해 작업실 내의 악취, 먼지, 증기, 열 등은 제거되고 있는가?",
      "환기구는 청결하게 관리되고 있는가?",
      "먼지 등의 비산은 없는가?",
      "사용하다 남은 원·부자재 등은 밀봉하여 적절하게 관리되고 있는가?",
    ],
  },
  {
    title: "창문",
    questions: [
      "창문은 닫혀 있고 방충시설(방충망)은 되어 있는가?",
      "창문·방충망 등의 먼지는 제거되고 청결하게 유지되고 있는가?",
    ],
  },
  {
    title: "건물 외부 및 폐기물",
    questions: [
      "건물 외부에 틈이나 구멍 등은 없는가?",
      "건물 주위에 설비/기구, 폐기물, 쓰레기가 지정되지 않은 장소에 방치되어 있지 않은가?",
      "폐기물 처리장에 해충이나 악취등이 발생하지 않는가?",
      "배수로에 폐수가 역류되거나 퇴적물이 쌓인 곳은 없는가?",
    ],
  },
  {
    title: "방충·방서",
    questions: [
      "방충시설은 청결하며 방서시설 중 고장 또는 파손된 곳은 없는가?",
      "방충, 방제실시는 정기적으로 이뤄지고 있는가?",
      "해충 등의 서식흔적(벽, 천정, 모서리, 구석진 곳)은 없는가?",
      "출입문의 에어커튼은 전원이 켜져 있으며 잘 작동하고 있는가?",
      "포충등은 지정된 곳에 있으며 파손은 없는가?",
    ],
  },
  {
    title: "청소도구",
    questions: [
      "각 작업실별 청소도구는 지정된 장소에 보관하며 관리되고 있는가?",
      "청소도구는 청결히 관리되어 지는가?",
    ],
  },
];

export type HygieneItemResult = "O" | "X" | "";

/** 항목별 결과 맵: "categoryIndex-questionIndex" -> "O" | "X" */
export type HygieneFormResults = Record<string, HygieneItemResult>;

export interface HygieneCorrectiveInput {
  content: string;
  datetime: string;
  deviation: string;
  detail: string;
  actor: string;
  approver: string;
}
