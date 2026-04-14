/** 플래닝 보드 → production_plan_rows 미러 및 /production/plan 조회 소스 정책 */

export const PLANNING_CUTOVER_DATE = "2026-05-01";

/** 2026년 4월 한정: 5월 컷오버 전에도 플래닝 저장분을 조회 화면에 반영 */
export const PLANNING_APRIL_2026_START = "2026-04-01";
export const PLANNING_APRIL_2026_END = "2026-04-30";

export function shouldMirrorPlanningToProductionPlanRows(planDate: string): boolean {
  if (planDate >= PLANNING_CUTOVER_DATE) return true;
  if (planDate >= PLANNING_APRIL_2026_START && planDate <= PLANNING_APRIL_2026_END) return true;
  return false;
}

/** 조회 화면에서 시트 동기화 행을 숨기고 플래닝만 보일 구간 */
export function shouldShowOnlyPlanningBoardInPlanView(planDate: string): boolean {
  return shouldMirrorPlanningToProductionPlanRows(planDate);
}
