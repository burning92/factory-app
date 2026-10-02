import type { Profile } from "@/types/auth";

export type AppRole = Profile["role"];

/** admin과 동등한 운영 권한 (품질팀장 포함) */
export const ADMIN_LIKE_ROLES = ["admin", "quality_manager"] as const;

export function isAdminLikeRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "quality_manager";
}

/** 연월차 관리 화면 접근: admin급 전체, 그 외는 can_manage_leave 지정자(자기 조직 한정) */
export function canAccessLeaveManagement(
  profile: { role?: string | null; can_manage_leave?: boolean | null } | null | undefined
): boolean {
  if (!profile) return false;
  return isAdminLikeRole(profile.role) || profile.can_manage_leave === true;
}

/** 플래닝·구매·조직 전환 등 매니저급 이상 (admin-like 포함) */
export function isManagerOrAbove(role: string | null | undefined): boolean {
  return (
    role === "admin" ||
    role === "quality_manager" ||
    role === "manager" ||
    role === "headquarters"
  );
}
