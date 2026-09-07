import { PERIODS, type PeriodId, type PositionDef, type PositionStaffing, type ProcessId } from "./types";

export function processNeedsStaffing(process: ProcessId): boolean {
  return process !== "heating" && process !== "rnd";
}

function clampStaff(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(20, Math.round(n));
}

export function emptyPositionStaffing(): PositionStaffing {
  return {
    start: { min: 0, max: 0 },
    lunch1: { min: 0, max: 0 },
    lunch2: { min: 0, max: 0 },
    after: { min: 0, max: 0 },
  };
}

export function defaultStaffingForProcess(process: ProcessId): PositionStaffing | undefined {
  if (!processNeedsStaffing(process)) return undefined;
  if (process === "inner") {
    return {
      start: { min: 4, max: 4 },
      lunch1: { min: 3, max: 3 },
      lunch2: { min: 3, max: 3 },
      after: { min: 4, max: 5 },
    };
  }
  if (process === "outer") {
    return {
      start: { min: 3, max: 3 },
      lunch1: { min: 2, max: 2 },
      lunch2: { min: 2, max: 2 },
      after: { min: 4, max: 4 },
    };
  }
  if (process === "topping") {
    // min 0: 필수는 아님. max만 열어 표에 자리가 보이고 수동·잔여 배치가 되게 한다.
    return {
      start: { min: 0, max: 6 },
      lunch1: { min: 0, max: 2 },
      lunch2: { min: 0, max: 4 },
      after: { min: 0, max: 6 },
    };
  }
  if (process === "dough") {
    return {
      start: { min: 3, max: 3 },
      lunch1: { min: 0, max: 0 },
      lunch2: { min: 0, max: 0 },
      after: { min: 0, max: 0 },
    };
  }
  if (process === "cleanup") {
    return {
      start: { min: 0, max: 0 },
      lunch1: { min: 0, max: 0 },
      lunch2: { min: 0, max: 0 },
      after: { min: 1, max: 1 },
    };
  }
  return emptyPositionStaffing();
}

/** 전 구간 min·max가 0이면 정원 미설정으로 본다 */
export function staffingHasCapacity(staffing: PositionStaffing | undefined): boolean {
  if (!staffing) return false;
  return PERIODS.some((period) => (staffing[period.id]?.min ?? 0) > 0 || (staffing[period.id]?.max ?? 0) > 0);
}

export function normalizePositionStaffing(
  process: ProcessId,
  staffing: PositionStaffing | undefined
): PositionStaffing | undefined {
  if (!processNeedsStaffing(process)) return undefined;
  const fallback = defaultStaffingForProcess(process) ?? emptyPositionStaffing();
  // 토핑이 예전에 0/0으로만 저장돼 표에서 사라진 경우 → 기본 정원으로 복구 (숙련·인원은 유지)
  const useSaved =
    process === "topping" && !staffingHasCapacity(staffing) ? undefined : staffing;
  const next = emptyPositionStaffing();
  for (const period of PERIODS) {
    const src = useSaved?.[period.id] ?? fallback[period.id];
    const min = clampStaff(src?.min, fallback[period.id].min);
    const max = Math.max(min, clampStaff(src?.max, fallback[period.id].max));
    next[period.id] = { min, max };
  }
  return next;
}

export function parsePeriodStaffJson(value: unknown): PositionStaffing | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, { min?: unknown; max?: unknown } | number>;
  const next = emptyPositionStaffing();
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
  if (position.process === "heating") return { min: 1, max: 1 };
  if (!processNeedsStaffing(position.process)) return { min: 0, max: 99 };
  const range = normalizePositionStaffing(position.process, position.staffing)?.[period];
  return range ?? { min: 0, max: 0 };
}

export function withDefaultStaffing(position: PositionDef): PositionDef {
  return {
    ...position,
    staffing: normalizePositionStaffing(position.process, position.staffing),
  };
}

export function patchPositionStaffing(
  process: ProcessId,
  staffing: PositionStaffing | undefined,
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
  return { ...next, [period]: cell };
}

export function staffingRangeLabel(min: number, max: number): string {
  if (min === max) return `${min}명`;
  return `${min}~${max}명`;
}
