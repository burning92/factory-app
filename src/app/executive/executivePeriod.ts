export type ExecutivePeriodKey = "week" | "month" | "ytd";

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function mondayOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

export function parseExecutivePeriodKey(raw: string | null): ExecutivePeriodKey {
  if (raw === "week" || raw === "month" || raw === "ytd") return raw;
  return "ytd";
}

export function parseExecutiveYearMonth(
  searchParams: { get(name: string): string | null },
  today = new Date()
): { refYear: number; refMonth: number } {
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const yearRaw = searchParams.get("year");
  const monthRaw = searchParams.get("month");
  const refYear = yearRaw != null && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : ty;
  const refMonth =
    monthRaw != null && /^\d{1,2}$/.test(monthRaw)
      ? Math.min(12, Math.max(1, Number(monthRaw)))
      : tm;
  return { refYear, refMonth };
}

export function computeExecutivePeriodRange(
  periodKey: ExecutivePeriodKey,
  refYear: number,
  refMonth: number,
  today = new Date()
): { start: string; end: string } {
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  const todayStr = `${ty}-${pad2(tm)}-${pad2(td)}`;

  if (periodKey === "week") {
    return { start: toYmd(mondayOfWeek(today)), end: todayStr };
  }

  const monthStart = `${refYear}-${pad2(refMonth)}-01`;
  const ld = lastDayOfMonth(refYear, refMonth);
  const monthEnd = `${refYear}-${pad2(refMonth)}-${pad2(ld)}`;

  if (periodKey === "month") {
    const isCurrentMonth = refYear === ty && refMonth === tm;
    const end = isCurrentMonth ? todayStr : monthEnd;
    return { start: monthStart, end };
  }

  const yStart = `${refYear}-01-01`;
  const isCurrentRefMonth = refYear === ty && refMonth === tm;
  const end = isCurrentRefMonth ? todayStr : monthEnd;
  return { start: yStart, end };
}

export function computeExecutivePeriodLabel(
  periodKey: ExecutivePeriodKey,
  refYear: number,
  refMonth: number,
  today = new Date()
): string {
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  const isRefCurrentMonth = refYear === ty && refMonth === tm;

  if (periodKey === "week") return "이번 주";
  if (periodKey === "month") {
    return isRefCurrentMonth ? "이번 달" : `${refYear}년 ${refMonth}월`;
  }
  if (isRefCurrentMonth) return "올해 누적";
  return `${refYear}년 1~${refMonth}월 누적`;
}

export function buildExecutiveDetailHref(
  path: string,
  opts: { periodKey: ExecutivePeriodKey; refYear: number; refMonth: number }
): string {
  const params = new URLSearchParams();
  params.set("period", opts.periodKey);
  if (opts.periodKey !== "week") {
    params.set("year", String(opts.refYear));
    params.set("month", String(opts.refMonth));
  }
  return `${path}?${params.toString()}`;
}
