import Link from "next/link";
import { getProductionPlanPageData } from "@/features/production/plan/getProductionPlanPageData";
import { formatDateTimeKorea } from "@/lib/formatDateTimeKorea";
import MobilePlanList from "./MobilePlanList";
import AutoScrollToToday from "./AutoScrollToToday";

export const dynamic = "force-dynamic";

function formatQty(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("ko-KR");
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function formatMonthTitle(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}

function getCategoryClass(category: string | null): string {
  switch (category) {
    case "생산":
      return "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40";
    case "공휴일":
      return "bg-rose-500/20 text-rose-300 border border-rose-500/40";
    case "연차":
      return "bg-amber-500/20 text-amber-300 border border-amber-500/40";
    case "반차":
      return "bg-violet-500/20 text-violet-300 border border-violet-500/40";
    case "기타":
      return "bg-slate-500/20 text-slate-300 border border-slate-500/40";
    case "메모":
      return "bg-amber-500/15 text-amber-200 border border-amber-500/35";
    default:
      return "bg-slate-700/60 text-slate-300 border border-slate-600/60";
  }
}

function getProductionClassByName(productName: string): string {
  if (productName.includes("포노브레드")) {
    return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";
  }
  if (productName.includes("파베이크")) {
    return "bg-sky-500/20 text-sky-300 border border-sky-500/40";
  }
  return "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40";
}

function getRowClass(category: string | null, productName: string): string {
  if (category === "메모") return getCategoryClass(category);
  if (category === "생산") return getProductionClassByName(productName);
  return getCategoryClass(category);
}

function getDisplayName(category: string | null, productName: string, note: string | null): string {
  if (category === "메모" && note && note.trim()) return `(${note.trim()})`;
  if (category === "연차") return `휴 : ${productName}`;
  if (category === "반차") return `반 : ${productName}`;
  return productName;
}

function monthKeyFromYM(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function versionLabel(v: "master" | "draft" | "end"): string {
  if (v === "end") return "END";
  if (v === "draft") return "가안";
  return "MASTER";
}

function versionBadgeClass(v: "master" | "draft" | "end"): string {
  if (v === "end") return "bg-violet-500/20 text-violet-200 border border-violet-500/40";
  if (v === "draft") return "bg-amber-500/20 text-amber-200 border border-amber-500/40";
  return "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40";
}

function getTodayIsoInKST(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function ProductionPlanPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  let data;
  try {
    data = await getProductionPlanPageData();
  } catch {
    return (
      <div className="p-4 max-w-3xl mx-auto">
        <p className="text-red-400 text-sm">
          생산계획 데이터를 불러올 수 없습니다. Supabase 마이그레이션 적용 및 환경 변수를 확인하세요.
        </p>
        <p className="text-slate-500 text-xs mt-2">
          로컬에서는 .env.local의 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 확인하세요.
        </p>
        <Link href="/production" className="inline-block mt-4 text-cyan-400 text-sm hover:underline">
          ← 생산 허브
        </Link>
      </div>
    );
  }

  const rows = data.rows;
  const monthKeys = Array.from(
    new Set(
      rows
        .filter((r) => Number.isFinite(r.plan_year) && Number.isFinite(r.plan_month))
        .map((r) => monthKeyFromYM(r.plan_year, r.plan_month))
    )
  ).sort((a, b) => a.localeCompare(b));
  const requestedMonthRaw = resolvedSearchParams.m;
  const requestedMonth =
    typeof requestedMonthRaw === "string" && /^\d{4}-\d{2}$/.test(requestedMonthRaw)
      ? requestedMonthRaw
      : null;
  const todayIso = getTodayIsoInKST();
  const todayMonthKey = todayIso.slice(0, 7);
  const monthKey =
    requestedMonth && monthKeys.includes(requestedMonth)
      ? requestedMonth
      : monthKeys.includes(todayMonthKey)
        ? todayMonthKey
        : monthKeys.length > 0
        ? monthKeys[monthKeys.length - 1]
        : null;

  const monthRows = monthKey
    ? rows.filter((r) => monthKeyFromYM(r.plan_year, r.plan_month) === monthKey)
    : [];
  const byDate = new Map<string, typeof monthRows>();
  for (const r of monthRows) {
    const list = byDate.get(r.plan_date) ?? [];
    list.push(r);
    byDate.set(r.plan_date, list);
  }
  const sortedDates = Array.from(byDate.keys()).sort((a, b) => a.localeCompare(b));
  const monthVersions = Array.from(new Set(monthRows.map((r) => r.plan_version))).sort();

  let daysInMonth = 0;
  let firstWeekday = 0;
  if (monthKey) {
    const [yearStr, monthStr] = monthKey.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const firstDate = new Date(year, month - 1, 1);
    daysInMonth = new Date(year, month, 0).getDate();
    firstWeekday = firstDate.getDay();
  }

  const dayCells = [];
  if (monthKey) {
    for (let i = 0; i < firstWeekday; i += 1) dayCells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      dayCells.push(`${monthKey}-${String(day).padStart(2, "0")}`);
    }
    while (dayCells.length % 7 !== 0) dayCells.push(null);
  }

  const selectedMonthIndex = monthKey ? monthKeys.indexOf(monthKey) : -1;
  const prevMonth = selectedMonthIndex > 0 ? monthKeys[selectedMonthIndex - 1] : null;
  const nextMonth =
    selectedMonthIndex >= 0 && selectedMonthIndex < monthKeys.length - 1
      ? monthKeys[selectedMonthIndex + 1]
      : null;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:px-8 md:py-6 xl:px-10 max-w-[1280px] mx-auto">
      <div className="mb-4">
        <Link href="/production" className="text-sm text-cyan-400 hover:underline">
          ← 생산 허브
        </Link>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">생산계획</h1>
      <p className="text-sm text-slate-500 mb-4">조회 전용 · 시트 동기화 후 반영됩니다.</p>

      {data.sync && (
        <div className="rounded-lg border border-slate-700 bg-space-800/60 px-3 py-2 text-xs text-slate-400 mb-6 space-y-1">
          <p>
            마지막 동기화:{" "}
            {data.sync.last_synced_at
              ? formatDateTimeKorea(data.sync.last_synced_at)
              : "—"}
            {data.sync.last_status ? ` · ${data.sync.last_status}` : ""}
          </p>
          {data.sync.source_refreshed_at && (
            <p>시트 갱신 시각: {formatDateTimeKorea(data.sync.source_refreshed_at)}</p>
          )}
          <p>행 수: {data.sync.row_count}</p>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-space-800/80 p-8 text-center text-slate-500">
          등록된 생산계획이 없습니다. 시트 → 동기화 후 여기에 표시됩니다.
        </div>
      ) : (
        <>
          {monthKey && (
            <section className="rounded-xl border border-slate-700 bg-space-800/60 p-3 mb-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {prevMonth ? (
                    <Link
                      href={`/production/plan?m=${prevMonth}`}
                      className="px-2.5 py-1 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/60 text-xs"
                    >
                      이전월
                    </Link>
                  ) : (
                    <span className="px-2.5 py-1 rounded-lg border border-slate-700 text-slate-600 text-xs">
                      이전월
                    </span>
                  )}
                  {nextMonth ? (
                    <Link
                      href={`/production/plan?m=${nextMonth}`}
                      className="px-2.5 py-1 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/60 text-xs"
                    >
                      다음월
                    </Link>
                  ) : (
                    <span className="px-2.5 py-1 rounded-lg border border-slate-700 text-slate-600 text-xs">
                      다음월
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {monthKeys.map((m) => (
                    <Link
                      key={m}
                      href={`/production/plan?m=${m}`}
                      className={`px-2 py-1 rounded-md text-xs border ${
                        m === monthKey
                          ? "border-cyan-500/70 bg-cyan-500/15 text-cyan-200"
                          : "border-slate-600 text-slate-300 hover:bg-slate-700/60"
                      }`}
                    >
                      {m.slice(2).replace("-", ".")}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">버전:</span>
                {monthVersions.map((v) => (
                  <span key={v} className={`px-2 py-0.5 rounded-full ${versionBadgeClass(v)}`}>
                    {versionLabel(v)}
                  </span>
                ))}
              </div>
            </section>
          )}
          {monthKey && (
            <section className="hidden md:block rounded-xl border border-slate-700 bg-space-800/50 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700/80 bg-space-900/40">
                <h2 className="text-base font-semibold text-cyan-300/90">{formatMonthTitle(monthKey)}</h2>
              </div>
              <div className="grid grid-cols-7 border-b border-slate-700/80 bg-space-900/30">
                {WEEKDAY_LABELS.map((w) => (
                  <div key={w} className="px-3 py-2 text-xs font-medium text-slate-400 border-r border-slate-700/60 last:border-r-0">
                    {w}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {dayCells.map((dateKey, idx) => {
                  const dayRows = dateKey ? (byDate.get(dateKey) ?? []) : [];
                  const dayNum = dateKey ? Number(dateKey.slice(8, 10)) : null;
                  return (
                    <div
                      key={`${dateKey ?? "empty"}-${idx}`}
                      id={dateKey ? `plan-day-${dateKey}` : undefined}
                      data-plan-today={dateKey === todayIso ? "true" : undefined}
                      className="min-h-[160px] border-r border-b border-slate-700/60 last:border-r-0 p-3"
                    >
                      {dateKey ? (
                        <>
                          <p className="text-sm font-semibold text-slate-200 mb-2">{dayNum}</p>
                          <div className="space-y-2">
                            {dayRows.map((row) => (
                              <div key={row.id} className={`rounded-md px-2 py-1 text-[11px] ${getRowClass(row.category, row.product_name)}`}>
                                <p className="leading-snug">{getDisplayName(row.category, row.product_name, row.note)}</p>
                                {row.qty != null && Number.isFinite(row.qty) ? (
                                  <p className="text-[10px] mt-0.5 tabular-nums">수량 {formatQty(row.qty)}</p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {monthKey && (
            <MobilePlanList
              monthTitle={formatMonthTitle(monthKey)}
              entries={Array.from(byDate.entries())
                .filter(([date, dayRows]) => date.startsWith(monthKey) && dayRows.length > 0)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, dayRows]) => ({
                  date,
                  rows: dayRows.map((row) => ({
                    id: row.id,
                    label: getDisplayName(row.category, row.product_name, row.note),
                    qty: row.qty,
                    note: row.category === "메모" ? null : row.note ?? null,
                    className: getRowClass(row.category, row.product_name),
                  })),
                }))}
            />
          )}
          {monthKey && (
            <AutoScrollToToday targetDate={monthKey === todayMonthKey ? todayIso : null} />
          )}
        </>
      )}
    </div>
  );
}
