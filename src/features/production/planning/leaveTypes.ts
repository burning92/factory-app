/** 연차 / 반차. half는 오전·오후 구분 없는 기존 값. */
export const PLANNING_LEAVE_TYPES = ["annual", "half", "half_am", "half_pm"] as const;
export type PlanningLeaveType = (typeof PLANNING_LEAVE_TYPES)[number];

export const PLANNING_RANGE_ENTRY_TYPES = ["annual", "half", "half_am", "half_pm", "other"] as const;
export type PlanningRangeEntryType = (typeof PLANNING_RANGE_ENTRY_TYPES)[number];

/** 반차(오전출근) = 오전 근무·오후 휴무, 반차(오후출근) = 오후 근무·오전 휴무 */
export const HALF_DAY_LEAVE_TYPES = ["half", "half_am", "half_pm"] as const;

export function isHalfDayLeaveType(value: string): boolean {
  return value === "half" || value === "half_am" || value === "half_pm";
}

export function parsePlanningLeaveType(value: unknown): PlanningLeaveType {
  const raw = String(value ?? "");
  if (raw === "half" || raw === "half_am" || raw === "half_pm" || raw === "annual") return raw;
  return "annual";
}

export function parsePlanningRangeEntryType(value: unknown): PlanningRangeEntryType {
  const raw = String(value ?? "");
  if (raw === "other") return "other";
  return parsePlanningLeaveType(raw);
}

export function planningLeaveTypeLabel(type: PlanningLeaveType): string {
  switch (type) {
    case "half_am":
      return "반차(오전출근)";
    case "half_pm":
      return "반차(오후출근)";
    case "half":
      return "반차";
    default:
      return "연차";
  }
}

export function planningLeaveTypeShortLabel(type: PlanningLeaveType): string {
  switch (type) {
    case "half_am":
      return "반(오전)";
    case "half_pm":
      return "반(오후)";
    case "half":
      return "반";
    default:
      return "휴";
  }
}

export function planningLeaveDeductionDays(type: PlanningLeaveType): number {
  return isHalfDayLeaveType(type) ? 0.5 : 1;
}

export function planningLeaveMirrorCategory(type: PlanningLeaveType): string {
  return planningLeaveTypeLabel(type);
}
