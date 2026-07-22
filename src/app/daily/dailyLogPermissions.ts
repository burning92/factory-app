import { isAdminLikeRole } from "@/lib/roles";

/**
 * 데일리 일지 UI 권한 — `src/app/daily` 범위 전용.
 * 승인/반려 버튼: admin급(품질팀장 포함) + 일지 status가 submitted 일 때만 표시.
 */

export function canShowDailyApproveReject(
  role: string | undefined | null,
  status: string | undefined | null
): boolean {
  return isAdminLikeRole(role) && status === "submitted";
}
