import type { Profile } from "@/types/auth";

/** 제조설비등록 — admin 전용 */
export function canManageEquipmentRegistry(role: Profile["role"] | undefined): boolean {
  return role === "admin";
}

/** 설비이력기록부 작성·수정·결과 추가 — manager / headquarters / admin */
export function canWriteEquipmentHistory(role: Profile["role"] | undefined): boolean {
  return role === "manager" || role === "headquarters" || role === "admin";
}

/** 본문 이력 삭제 — admin만 */
export function canDeleteEquipmentHistoryRecord(role: Profile["role"] | undefined): boolean {
  return role === "admin";
}

/** 결과 이력 개별 삭제 — manager·headquarters·admin */
export function canDeleteEquipmentHistoryUpdate(role: Profile["role"] | undefined): boolean {
  return role === "manager" || role === "headquarters" || role === "admin";
}
