import type { Profile } from "@/types/auth";
import { isManagerOrAbove } from "@/lib/roles";

/** 설비 이상 직접 등록·점검표 연동 저장 — 매니저/본사/관리자급 */
export function canRegisterEquipmentIncident(role: Profile["role"] | undefined): boolean {
  return isManagerOrAbove(role);
}
