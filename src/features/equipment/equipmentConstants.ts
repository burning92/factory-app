/** DB CHECK 및 UI 드롭다운과 동일한 값 */
export const EQUIPMENT_TYPES = ["화덕", "호이스트", "반죽기", "에어컴프레셔", "기타"] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export const LIFECYCLE_STATUSES = ["운영중", "예비", "사용중지", "철거"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

/** null = 대시보드 그룹 없음 */
export const DASHBOARD_GROUPS = ["화덕", "호이스트", "반죽기"] as const;
export type DashboardGroup = (typeof DASHBOARD_GROUPS)[number];

export function lifecycleToIsActive(status: LifecycleStatus): boolean {
  return status === "운영중" || status === "예비";
}

/** 이력 등록 드롭다운 기본 노출: 운영중·예비 (마이그레이션 전에는 is_active) */
export function isEquipmentSelectableForHistory(row: {
  lifecycle_status?: LifecycleStatus | null;
  is_active?: boolean;
}): boolean {
  if (row.lifecycle_status) {
    return row.lifecycle_status === "운영중" || row.lifecycle_status === "예비";
  }
  return row.is_active !== false;
}

/** 설비유형 + 호기로 표시명 제안 */
export function suggestDisplayName(equipmentType: EquipmentType, unitNo: number | null | undefined): string {
  if (equipmentType === "기타") {
    return "";
  }
  if (unitNo != null && Number.isFinite(unitNo) && unitNo > 0) {
    return `${equipmentType} ${unitNo}호기`;
  }
  return equipmentType;
}
