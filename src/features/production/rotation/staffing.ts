import {
  PERIODS,
  type PeriodId,
  type PeriodStaffRange,
  type PositionDef,
  type PositionStaffing,
  type ProcessId,
  type SavedPositionStaffing,
} from "./types";

/** 인원수(최소~최대 명)를 두는 공정 */
export function processNeedsStaffing(process: ProcessId): boolean {
  return process !== "heating" && process !== "rnd";
}

/**
 * 자리당 1명이라 인원수 대신 시간대별 필수·선택만 두는 공정.
 * 저장 칸은 같은 min·max를 쓰고 min 1이면 필수, 0이면 선택으로 읽는다.
 */
export function isSeatProcess(process: ProcessId): boolean {
  return process === "heating";
}

/** 자리 설정을 저장·정규화하는 공정 (인원수 또는 필수 여부) */
export function processStoresStaffing(process: ProcessId): boolean {
  return processNeedsStaffing(process) || isSeatProcess(process);
}

function clampStaff(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(20, Math.round(n));
}

export function emptyPositionStaffing(): PositionStaffing {
  const out = {} as PositionStaffing;
  for (const period of PERIODS) out[period.id] = { min: 0, max: 0 };
  return out;
}

function staffingOf(rows: Partial<Record<PeriodId, PeriodStaffRange>>): PositionStaffing {
  const out = emptyPositionStaffing();
  for (const period of PERIODS) out[period.id] = rows[period.id] ?? { min: 0, max: 0 };
  return out;
}

/** 가열 자리 기본값: 생산 구간은 전부 필수, 마감 구간은 자리를 세우지 않는다 */
function defaultSeatStaffing(): PositionStaffing {
  const out = emptyPositionStaffing();
  for (const period of PERIODS) {
    const produces = period.production !== false;
    out[period.id] = { min: produces ? 1 : 0, max: produces ? 1 : 0 };
  }
  return out;
}

/** 저장값이 없으면 필수. 예전 데이터는 값이 없으므로 지금까지와 똑같이 동작한다 */
function normalizeSeatStaffing(saved: SavedPositionStaffing | undefined): PositionStaffing {
  const fallback = defaultSeatStaffing();
  const next = emptyPositionStaffing();
  for (const period of PERIODS) {
    const inherit = INHERIT_PERIOD[period.id];
    const src = saved?.[period.id] ?? (inherit ? saved?.[inherit] : undefined);
    const seatExists = fallback[period.id].max > 0;
    const required = src ? src.min > 0 : fallback[period.id].min > 0;
    next[period.id] = { min: seatExists && required ? 1 : 0, max: seatExists ? 1 : 0 };
  }
  return next;
}

export function defaultStaffingForProcess(process: ProcessId): PositionStaffing | undefined {
  if (isSeatProcess(process)) return defaultSeatStaffing();
  if (!processNeedsStaffing(process)) return undefined;
  // 08~09는 9시 출근자가 아직 없다. 자리는 열어 두되 최소인원은 걸지 않는다
  if (process === "inner") {
    return staffingOf({
      early: { min: 0, max: 4 },
      start: { min: 4, max: 4 },
      lunch1: { min: 3, max: 3 },
      lunch2: { min: 3, max: 3 },
      after: { min: 4, max: 5 },
      late: { min: 4, max: 5 },
      evening: { min: 4, max: 5 },
      closing: { min: 3, max: 4 },
    });
  }
  if (process === "outer") {
    return staffingOf({
      early: { min: 0, max: 4 },
      start: { min: 4, max: 4 },
      lunch1: { min: 2, max: 2 },
      lunch2: { min: 2, max: 2 },
      after: { min: 4, max: 4 },
      late: { min: 4, max: 4 },
      evening: { min: 4, max: 4 },
      closing: { min: 2, max: 3 },
    });
  }
  if (process === "topping") {
    // max가 목표 인원, min은 이 밑으로 떨어지면 경고할 선. 점심에는 최소만 남기고 나머지는 식사·백업으로 돌린다
    return staffingOf({
      early: { min: 0, max: 2 },
      start: { min: 4, max: 6 },
      // 점심 구간은 가열 자리 유지가 먼저다. 토핑은 상한만 두고 남는 인원으로 돌린다
      lunch1: { min: 0, max: 3 },
      lunch2: { min: 0, max: 4 },
      after: { min: 4, max: 6 },
      late: { min: 4, max: 6 },
      evening: { min: 4, max: 6 },
      // 18시 이후는 후행공정만 남고 토핑 생산은 끝난다
      closing: { min: 0, max: 0 },
    });
  }
  if (process === "dough") {
    // 09~11만 고정조 3명 + 보조 1명. 보조 자리는 일반 후보 중에서 채운다
    return staffingOf({
      early: { min: 3, max: 3 },
      start: { min: 3, max: 4 },
    });
  }
  if (process === "cleanup") {
    // 13시 복귀 인원만큼 자동으로 최소인원이 잡힌다. 기본은 자리만 열어 둔다
    return staffingOf({ after: { min: 0, max: 3 } });
  }
  if (process === "heatingClose") {
    // 가열실 설비 정리·세척. 생산이 끝난 18시 이후에만 둔다
    return staffingOf({ closing: { min: 4, max: 4 } });
  }
  return emptyPositionStaffing();
}

/** 저장본에 없는 새 구간은 가장 가까운 기존 구간에서 물려받는다 */
const INHERIT_PERIOD: Partial<Record<PeriodId, PeriodId>> = {
  early: "start",
  late: "after",
  evening: "after",
};

/** 전 구간 min·max가 0이면 정원 미설정으로 본다 */
export function staffingHasCapacity(staffing: SavedPositionStaffing | undefined): boolean {
  if (!staffing) return false;
  return PERIODS.some((period) => (staffing[period.id]?.min ?? 0) > 0 || (staffing[period.id]?.max ?? 0) > 0);
}

export function normalizePositionStaffing(
  process: ProcessId,
  staffing: SavedPositionStaffing | undefined
): PositionStaffing | undefined {
  if (isSeatProcess(process)) return normalizeSeatStaffing(staffing);
  if (!processNeedsStaffing(process)) return undefined;
  const fallback = defaultStaffingForProcess(process) ?? emptyPositionStaffing();
  // 토핑이 예전에 0/0으로만 저장돼 표에서 사라진 경우 → 기본 정원으로 복구 (숙련·인원은 유지)
  const useSaved =
    process === "topping" && !staffingHasCapacity(staffing) ? undefined : staffing;
  const next = emptyPositionStaffing();
  for (const period of PERIODS) {
    const inherit = INHERIT_PERIOD[period.id];
    const src = useSaved?.[period.id] ?? (inherit ? useSaved?.[inherit] : undefined) ?? fallback[period.id];
    const min = clampStaff(src?.min, fallback[period.id].min);
    const max = Math.max(min, clampStaff(src?.max, fallback[period.id].max));
    next[period.id] = { min, max };
  }
  return next;
}

/** 저장된 키만 담아 돌려준다. 없는 구간은 정규화 때 가까운 구간에서 물려받는다 */
export function parsePeriodStaffJson(value: unknown): SavedPositionStaffing | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, { min?: unknown; max?: unknown } | number>;
  const next: SavedPositionStaffing = {};
  let any = false;
  for (const period of PERIODS) {
    const cell = raw[period.id];
    if (cell == null) continue;
    any = true;
    if (typeof cell === "number") {
      const n = clampStaff(cell, 0);
      next[period.id] = { min: n, max: n };
      continue;
    }
    next[period.id] = {
      min: clampStaff(cell.min, 0),
      max: clampStaff(cell.max, clampStaff(cell.min, 0)),
    };
  }
  return any ? next : undefined;
}

export function staffingForPosition(position: PositionDef, period: PeriodId): { min: number; max: number } {
  if (!processStoresStaffing(position.process)) return { min: 0, max: 99 };
  const range = normalizePositionStaffing(position.process, position.staffing)?.[period];
  return range ?? { min: 0, max: 0 };
}

/** 이 시간대에 반드시 채워야 하는 가열 자리인지 */
export function seatRequiredIn(position: PositionDef, period: PeriodId): boolean {
  return staffingForPosition(position, period).min > 0;
}

export function withDefaultStaffing(position: PositionDef): PositionDef {
  return {
    ...position,
    staffing: normalizePositionStaffing(position.process, position.staffing),
  };
}

export function patchPositionStaffing(
  process: ProcessId,
  staffing: SavedPositionStaffing | undefined,
  period: PeriodId,
  field: "min" | "max",
  value: number
): PositionStaffing {
  const next = normalizePositionStaffing(process, staffing) ?? emptyPositionStaffing();
  const n = clampStaff(value, 0);
  const cell = { ...next[period] };
  cell[field] = n;
  if (cell.max < cell.min) {
    if (field === "min") cell.max = cell.min;
    else cell.min = cell.max;
  }
  const patched = { ...next, [period]: cell };
  // 가열은 자리당 1명·필수여부만 남기고, 자리를 세우지 않는 구간은 그대로 둔다
  return isSeatProcess(process) ? normalizeSeatStaffing(patched) : patched;
}

export function staffingRangeLabel(min: number, max: number): string {
  if (min === max) return `${min}명`;
  return `${min}~${max}명`;
}
