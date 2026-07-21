/**
 * 데일리 일지 UI 권한 — `src/app/daily` 범위 전용.
 * 승인/반려 버튼: admin·품질팀장(quality_manager) + 일지 status가 submitted 일 때만 표시.
 */

const DAILY_APPROVE_ROLES = new Set(["admin", "quality_manager"]);

export function canShowDailyApproveReject(
  role: string | undefined | null,
  status: string | undefined | null
): boolean {
  return !!role && DAILY_APPROVE_ROLES.has(role) && status === "submitted";
}
