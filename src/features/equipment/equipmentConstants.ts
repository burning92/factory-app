/** DB CHECK 및 UI 드롭다운과 동일한 값 */
export const LIFECYCLE_STATUSES = ["운영중", "예비", "사용중지", "철거"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

/**
 * 설비유형/대시보드그룹은 옵션 마스터 테이블에서 불러온다.
 * 아래 상수는 마이그레이션 전/초기 상태에서의 fallback 용도만 유지.
 */
export const DEFAULT_EQUIPMENT_TYPES = ["화덕", "호이스트", "반죽기", "에어컴프레셔", "기타"] as const;
export const DEFAULT_DASHBOARD_GROUPS = ["화덕", "호이스트", "반죽기", "제조설비"] as const;

export type EquipmentType = string;
export type DashboardGroup = string;

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
export function suggestDisplayName(equipmentType: string, unitNo: number | null | undefined): string {
  const t = String(equipmentType ?? "").trim();
  if (!t) return "";
  if (unitNo != null && Number.isFinite(unitNo) && unitNo > 0) return `${t} ${unitNo}호기`;
  return t;
}
