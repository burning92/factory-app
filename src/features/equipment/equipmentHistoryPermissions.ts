import type { Profile } from "@/types/auth";
import { isAdminLikeRole, isManagerOrAbove } from "@/lib/roles";

/** 제조설비등록 — admin급(품질팀장 포함) */
export function canManageEquipmentRegistry(role: Profile["role"] | undefined): boolean {
  return isAdminLikeRole(role);
}

/** 설비이력기록부 작성·수정·결과 추가 — manager / headquarters / admin급 */
export function canWriteEquipmentHistory(role: Profile["role"] | undefined): boolean {
  return isManagerOrAbove(role);
}

/** 본문 이력 삭제 — admin급 */
export function canDeleteEquipmentHistoryRecord(role: Profile["role"] | undefined): boolean {
  return isAdminLikeRole(role);
}

/** 결과 이력 개별 삭제 — manager·headquarters·admin급 */
export function canDeleteEquipmentHistoryUpdate(role: Profile["role"] | undefined): boolean {
  return isManagerOrAbove(role);
}
