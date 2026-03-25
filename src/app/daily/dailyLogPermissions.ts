/**
 * 데일리 일지 UI 권한 — `src/app/daily` 범위 전용.
 * 승인/반려 버튼: admin + 일지 status가 submitted 일 때만 표시.
 */

export function canShowDailyApproveReject(
  role: string | undefined | null,
  status: string | undefined | null
): boolean {
  return role === "admin" && status === "submitted";
}
