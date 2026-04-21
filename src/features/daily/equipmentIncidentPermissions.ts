import type { Profile } from "@/types/auth";

/** 설비 이상 직접 등록·점검표 연동 저장 — 매니저/본사/관리자 */
export function canRegisterEquipmentIncident(role: Profile["role"] | undefined): boolean {
  return role === "manager" || role === "headquarters" || role === "admin";
}
