/** DB 빈 문자열을 Excel에서 NULL과 구분하기 위한 셀 문자. 원본 빈 문자열 자체가 아니다. */
export const EMPTY_STRING_MARK = '""';

export const EXCEL_CELL_MAX = 32767;

const TIMESTAMPTZ_NAMES = new Set(["corrective_datetime", "inspected_at"]);

export function isTimestamptzColumn(name: string): boolean {
  return name.endsWith("_at") || TIMESTAMPTZ_NAMES.has(name);
}

export function toExcelValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (value === "") return EMPTY_STRING_MARK;
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  return JSON.stringify(value);
}

export function addKstDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function kstDayStartIso(ymd: string): string {
  return `${ymd}T00:00:00+09:00`;
}

export function kstDayEndExclusiveIso(ymd: string): string {
  return `${addKstDays(ymd, 1)}T00:00:00+09:00`;
}

/** 표시용. 원본 시각 열을 대체하지 않는다. */
export function formatKstDisplay(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(dt);
  const ms = String(dt.getMilliseconds()).padStart(3, "0");
  return `${parts.replace(" ", "T")}.${ms}+09:00`;
}

export function kstCalendarDate(value: unknown): string | null {
  const shown = formatKstDisplay(value);
  return shown ? shown.slice(0, 10) : null;
}

export function orderedKeys(rows: Record<string, unknown>[], preferred: string[]): string[] {
  const present = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) present.add(key);
  }
  const head = preferred.filter((key) => present.has(key));
  const rest = Array.from(present)
    .filter((key) => !head.includes(key))
    .sort();
  return [...head, ...rest];
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function asId(value: unknown): string {
  return value == null ? "" : String(value);
}
