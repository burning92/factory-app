import { PERIODS, type PeriodId, type Person, type ShiftId } from "./types";

export type WorkWindow = {
  /** 자정 기준 분 */
  startMin: number;
  endMin: number;
};

export const DEFAULT_WORK_WINDOW: WorkWindow = { startMin: 8 * 60, endMin: 18 * 60 };

/**
 * 설정에서 고르는 근무조. 새 조는 여기에 문자열만 추가하면 엔진은 그대로 동작한다.
 * 다만 퇴근 시각이 구간 경계와 어긋나면(예: 17:00) 그 구간 전체 근무자로 잡히므로,
 * 경계에 없는 퇴근 시각을 넣으려면 PERIODS를 먼저 그 시각에서 나눠야 한다.
 */
export const SHIFT_OPTIONS: { id: ShiftId; label: string }[] = [
  { id: "0600-1530", label: "06–15:30" },
  { id: "0800-1700", label: "08–17" },
  { id: "0800-1800", label: "08–18" },
  { id: "0900-1900", label: "09–19" },
];

function toMinutes(raw: string): number | null {
  const t = raw.trim();
  const withColon = /^(\d{1,2}):(\d{2})$/.exec(t);
  const compact = /^(\d{3,4})$/.exec(t);
  const hh = withColon ? Number(withColon[1]) : compact ? Number(compact[1].slice(0, -2)) : NaN;
  const mm = withColon ? Number(withColon[2]) : compact ? Number(compact[1].slice(-2)) : NaN;
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 30 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

/** "0800-1800", "06:00-15:30" 모두 받는다. 못 읽으면 08–18로 본다 */
export function parseWorkWindow(shift: string | null | undefined): WorkWindow {
  if (!shift) return DEFAULT_WORK_WINDOW;
  const parts = String(shift).split(/[-~–]/);
  if (parts.length !== 2) return DEFAULT_WORK_WINDOW;
  const startMin = toMinutes(parts[0]);
  const endMin = toMinutes(parts[1]);
  if (startMin == null || endMin == null) return DEFAULT_WORK_WINDOW;
  return { startMin, endMin: endMin > startMin ? endMin : endMin + 24 * 60 };
}

/** 09~19 대체근무를 확정하면 이 값이 들어간다 */
export const NIGHT_SHIFT: ShiftId = "0900-1900";

/** 그날 실제로 적용되는 근무조. 기본 shift는 그대로 두고 override만 얹는다 */
export function effectiveShift(person: Person): ShiftId {
  return person.shiftOverride ?? person.shift;
}

export function hasShiftOverride(person: Person): boolean {
  return Boolean(person.shiftOverride && person.shiftOverride !== person.shift);
}

export function workWindowOf(person: Person): WorkWindow {
  return parseWorkWindow(effectiveShift(person));
}

export function periodWindow(period: PeriodId): WorkWindow {
  const row = PERIODS.find((p) => p.id === period);
  return row ? { startMin: row.startMin, endMin: row.endMin } : DEFAULT_WORK_WINDOW;
}

/** 근무창이 이 구간과 조금이라도 겹치면 근무 가능으로 본다 */
export function worksDuringPeriod(window: WorkWindow, period: PeriodId): boolean {
  const p = periodWindow(period);
  return window.startMin < p.endMin && window.endMin > p.startMin;
}

export function personWorksDuringPeriod(person: Person, period: PeriodId): boolean {
  return worksDuringPeriod(workWindowOf(person), period);
}

/** 이 구간이 점심 이전인지. 반차 판정에 쓴다 */
export function isMorningPeriod(period: PeriodId): boolean {
  return periodWindow(period).endMin <= 12 * 60;
}

export function isAfternoonPeriod(period: PeriodId): boolean {
  return periodWindow(period).startMin >= 12 * 60;
}

export function periodProduces(period: PeriodId): boolean {
  return PERIODS.find((p) => p.id === period)?.production !== false;
}

function hhmm(min: number): string {
  const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function workWindowLabel(window: WorkWindow): string {
  return `${hhmm(window.startMin)}–${hhmm(window.endMin)}`;
}

export function shiftLabel(shift: string | null | undefined): string {
  const known = SHIFT_OPTIONS.find((o) => o.id === shift);
  return known ? known.label : workWindowLabel(parseWorkWindow(shift));
}
