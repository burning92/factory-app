/**
 * 공정관리 점검일지(빵류) — 고정 공정 체크리스트
 */
export const PROCESS_CONTROL_BREAD_STAGES = [
  "원부재료 보관",
  "계량",
  "배합",
  "자석봉 이물제거",
  "반죽",
  "분할",
  "성형",
  "소스코팅",
  "가열",
  "냉각",
  "토핑",
  "급속냉동",
  "내포장",
  "금속검출",
  "외포장",
] as const;

export type ProcessControlBreadStage = (typeof PROCESS_CONTROL_BREAD_STAGES)[number];

export type ProcessControlBreadResult = "O" | "X";
export type ProcessControlBreadResultMap = Record<string, ProcessControlBreadResult>;

export function buildProcessControlBreadAutoDeviationText(
  results: ProcessControlBreadResultMap
): string {
  const lines: string[] = [];
  PROCESS_CONTROL_BREAD_STAGES.forEach((stage, i) => {
    const key = String(i);
    if (results[key] === "X") lines.push(`${stage}: 부적합`);
  });
  return lines.join("\n");
}

export function hasAnyProcessControlBreadFail(results: ProcessControlBreadResultMap): boolean {
  return Object.values(results).some((v) => v === "X");
}
