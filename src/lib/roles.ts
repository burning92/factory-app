import type { Profile } from "@/types/auth";

export type AppRole = Profile["role"];

/** admin과 동등한 운영 권한 (품질팀장 포함) */
export const ADMIN_LIKE_ROLES = ["admin", "quality_manager"] as const;

export function isAdminLikeRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "quality_manager";
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
