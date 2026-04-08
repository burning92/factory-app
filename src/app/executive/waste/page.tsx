"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useMasterStore } from "@/store/useMasterStore";
import { bomRowsToRefs, materialsToMeta } from "@/features/dashboard/bomMaterialAdapters";
import { loadProductionBundle } from "@/features/dashboard/loadProductionBundle";
import {
  mergeBundleDaysWithManualImportsForTable,
  rollupWasteMockFromDayRows,
  rollupWasteMockByMonthFromDayRows,
  computeWasteYoySamePeriod,
  wasteYoYCompareBadgeClass,
  wasteYoYCompareStatusFromDelta,
  wasteYoYCompareStatusLabel,
  wasteYoYDeltaPlainPhrase,
  wasteYoYSecondLineMeta,
  type ManualWasteImportSeries,
  type WasteDetailMockDayRow,
} from "@/features/dashboard/wasteDetailMockData";
import { DashboardBackLink } from "../DashboardBackLink";
import type { ProductionBundle } from "@/features/dashboard/loadProductionBundle";

const WASTE_WARN_PCT = 4;
const WASTE_DANGER_PCT = 10;

function pct2(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

function emptyManual(): ManualWasteImportSeries {
  return {
    doughProductionByDate: {},
    doughWasteByDate: {},
    parbakeWasteByDate: {},
    parbakeProductionByDate: {},
  };
}

function normManual(raw: Partial<ManualWasteImportSeries>): ManualWasteImportSeries {
  return {
    doughProductionByDate: raw.doughProductionByDate ?? {},
    doughWasteByDate: raw.doughWasteByDate ?? {},
    parbakeWasteByDate: raw.parbakeWasteByDate ?? {},
    parbakeProductionByDate: raw.parbakeProductionByDate ?? {},
  };
}

/** 일별 % 셀 — 임계만 강조(상세 페이지 기존 기준과 동일: 4%·10%) */
function rateCellClass(pct: number | null, dim: boolean): string {
  if (dim) return "text-slate-600";
  if (pct == null) return "text-slate-500";
  if (pct >= WASTE_DANGER_PCT) return "text-red-400/95 font-semibold";
  if (pct >= WASTE_WARN_PCT) return "text-amber-400/85 font-medium";
  return "text-slate-400";
}

/** 전체% 열 — 기존 overallDiscardCellClass와 동일 임계 */
function overallColClass(pct: number | null, dim: boolean): string {
  if (dim) return "text-slate-600";
  if (pct == null) return "text-slate-500";
  if (pct >= WASTE_DANGER_PCT) return "text-red-400 font-bold";
  if (pct >= WASTE_WARN_PCT) return "text-orange-400 font-semibold";
  return "text-slate-300";
}

/** 반죽·폐기·파베 생산이 모두 0이면 일별 표에서 제외 */
function wasteDayRowHasData(d: WasteDetailMockDayRow): boolean {
  return (
    d.doughMixQty > 0 ||
    d.doughWasteQty > 0 ||
    d.parbakeWasteQty > 0 ||
    d.sameDayParbakeProductionQty > 0
  );
}

function groupWasteDayRowsByMonth(rows: WasteDetailMockDayRow[], year: number): { month: number; dayRows: WasteDetailMockDayRow[] }[] {
  const map = new Map<number, WasteDetailMockDayRow[]>();
  const prefix = `${year}-`;
  for (const r of rows) {
    if (!r.date.startsWith(prefix)) continue;
    const parsed = /^(\d{4})-(\d{2})-\d{2}$/.exec(r.date);
    if (!parsed) continue;
    const month = Number(parsed[2]);
    if (month < 1 || month > 12) continue;
    const list = map.get(month) ?? [];
    list.push(r);
    map.set(month, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([month, dayRows]) => ({
      month,
      dayRows: dayRows.sort((a, b) => a.date.localeCompare(b.date)),
    }));
}

export default function ExecutiveWasteDetailPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const canView = !!profile;

  const materials = useMasterStore((s) => s.materials);
  const bomList = useMasterStore((s) => s.bomList);
  const materialsLoading = useMasterStore((s) => s.materialsLoading);
  const bomLoading = useMasterStore((s) => s.bomLoading);
  const fetchMaterials = useMasterStore((s) => s.fetchMaterials);
  const fetchBom = useMasterStore((s) => s.fetchBom);

  const [bundle, setBundle] = useState<ProductionBundle | null>(null);
  const [prevBundle, setPrevBundle] = useState<ProductionBundle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [manualSeries, setManualSeries] = useState<ManualWasteImportSeries>(emptyManual());
  const [prevManualSeries, setPrevManualSeries] = useState<ManualWasteImportSeries>(emptyManual());
  const [showCriteria, setShowCriteria] = useState(false);
  const [activeChartMonth, setActiveChartMonth] = useState<number | null>(null);

  const { rows: tableRows, filledManualDates } = useMemo(() => {
    return mergeBundleDaysWithManualImportsForTable(bundle?.days ?? [], manualSeries);
  }, [bundle?.days, manualSeries]);

  const prevTableRows = useMemo(() => {
    return mergeBundleDaysWithManualImportsForTable(prevBundle?.days ?? [], prevManualSeries).rows;
  }, [prevBundle?.days, prevManualSeries]);

  const w = useMemo(() => {
    if (tableRows.length === 0) return null;
    return rollupWasteMockFromDayRows(tableRows);
  }, [tableRows]);

  const monthlyRows = useMemo(
    () => rollupWasteMockByMonthFromDayRows(tableRows, year),
    [tableRows, year]
  );

  const monthlyRowsWithData = useMemo(
    () => monthlyRows.filter((r) => r.dayCount > 0),
    [monthlyRows]
  );

  const monthlyRowsForChart = useMemo(
    () =>
      monthlyRowsWithData.filter(
        (r) => r.overallDiscardRatePct != null && Number.isFinite(r.overallDiscardRatePct)
      ),
    [monthlyRowsWithData]
  );

  const monthlyChartMaxPct = useMemo(() => {
    const rates = monthlyRowsForChart.map((r) => r.overallDiscardRatePct!);
    if (rates.length === 0) return 4;
    return Math.max(4, ...rates);
  }, [monthlyRowsForChart]);

  useEffect(() => {
    if (monthlyRowsForChart.length === 0) {
      setActiveChartMonth(null);
      return;
    }
    const exists = monthlyRowsForChart.some((r) => r.month === activeChartMonth);
    if (!exists) setActiveChartMonth(monthlyRowsForChart[monthlyRowsForChart.length - 1]!.month);
  }, [monthlyRowsForChart, activeChartMonth]);

  const dailyRowsForYear = useMemo(() => {
    return tableRows.filter((r) => r.date.startsWith(`${year}-`)).filter(wasteDayRowHasData);
  }, [tableRows, year]);

  const dailyGroupsByMonth = useMemo(
    () => groupWasteDayRowsByMonth(dailyRowsForYear, year),
    [dailyRowsForYear, year]
  );

  const yoy = useMemo(() => computeWasteYoySamePeriod(tableRows, prevTableRows, year), [tableRows, prevTableRows, year]);
  const yoyCompareUi = useMemo(() => {
    if (!yoy.periodEndDate) return null;
    const baseSecond = wasteYoYSecondLineMeta(yoy.prevSamePeriodRate, yoy.currentRate);
    const secondLine = baseSecond ? `${baseSecond} · ~${yoy.periodEndDate} 동기` : `~${yoy.periodEndDate} 동기`;
    return {
      status: wasteYoYCompareStatusFromDelta(yoy.deltaPctPoint),
      primaryPhrase: wasteYoYDeltaPlainPhrase(yoy.deltaPctPoint),
      secondLine,
    };
  }, [yoy]);

  useEffect(() => {
    if (authLoading) return;
    if (!canView) router.replace("/");
  }, [authLoading, canView, router]);

  useEffect(() => {
    fetchMaterials();
    fetchBom();
  }, [fetchMaterials, fetchBom]);

  useEffect(() => {
    if (!canView || materialsLoading || bomLoading) return;
    let c = false;
    (async () => {
      const fetchManual = async (y: number) => {
        const r = await fetch(`/api/internal/manual-imports/summary?year=${y}`);
        if (!r.ok) return emptyManual();
        return normManual((await r.json()) as Partial<ManualWasteImportSeries>);
      };
      const py = year - 1;
      const [bundleRes, prevRes, manualRes, prevManualRes] = await Promise.all([
        loadProductionBundle(supabase, year, bomRowsToRefs(bomList), materialsToMeta(materials)),
        loadProductionBundle(supabase, py, bomRowsToRefs(bomList), materialsToMeta(materials)),
        fetchManual(year),
        fetchManual(py),
      ]);
      if (c) return;
      if (bundleRes.error) {
        setErr(bundleRes.error.message);
        setBundle(null);
      } else {
        setErr(null);
        setBundle(bundleRes.bundle);
      }
      setManualSeries(manualRes);
      setPrevManualSeries(prevManualRes);
      setPrevBundle(prevRes.error ? null : prevRes.bundle);
    })();
    return () => {
      c = true;
    };
  }, [canView, materialsLoading, bomLoading, materials, bomList, year]);

  if (authLoading || !profile) {
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] flex items-center justify-center p-6">
        <p className="text-slate-500 text-sm">로딩 중…</p>
      </div>
    );
  }

  if (!canView) return null;

  const ecountLines = bundle?.ecountMerge?.linesCounted ?? 0;
  const hasSnapshotActivity =
    (bundle?.days ?? []).some((d) => d.totalFinishedQty > 0 || d.doughMixQty > 0) ?? false;

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-4 md:p-6 max-w-5xl mx-auto pb-24 md:pb-8">
      <DashboardBackLink />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-100">폐기율 상세</h1>
          <p className="mt-1 text-[15px] font-medium leading-relaxed text-slate-400">
            도우와 파베이크 공정의 폐기율을 연도 누적으로 집계한 값입니다.
            <button
              type="button"
              onClick={() => setShowCriteria((v) => !v)}
              className="ml-2 text-[13px] font-medium text-slate-400 underline decoration-slate-600 underline-offset-2 hover:text-slate-300"
            >
              {showCriteria ? "설명 접기" : "설명 보기"}
            </button>
          </p>
          {showCriteria && (
            <div className="mt-2 space-y-2 rounded-md border border-slate-700/40 bg-slate-900/35 px-3 py-2.5 text-[13px] leading-relaxed text-slate-400">
              <p>폐기율은 생산수량 대비 폐기수량 비율을 기준으로 계산했습니다.</p>
              <p>
                파베이크는 해당 연도에 확보된 생산실적을 우선 반영하고, 실적이 없는 경우에는 공정 기록을 기준으로
                계산했습니다.
              </p>
              <p>상단 요약과 표는 시스템 기록과 보완 입력 데이터를 함께 반영한 결과입니다.</p>
              {filledManualDates.length > 0 && (
                <p className="text-slate-500">
                  기록이 누락된 {filledManualDates.length}일은 별도 생산기록으로 보완했습니다.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          <label htmlFor="waste-year-filter" className="sr-only">
            연도
          </label>
          <select
            id="waste-year-filter"
            className="rounded-md border border-slate-600/50 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 focus:border-cyan-600/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {[2024, 2025, 2026].map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <div className="flex flex-wrap justify-end gap-1.5">
            {filledManualDates.length > 0 && (
              <span className="rounded border border-slate-600/35 bg-slate-800/40 px-2 py-0.5 text-[11px] font-medium tracking-wide text-slate-400">
                누락 데이터 보완
              </span>
            )}
            {ecountLines > 0 && (
              <span className="rounded border border-slate-600/35 bg-slate-800/40 px-2 py-0.5 text-[11px] font-medium tracking-wide text-slate-400">
                생산실적 반영
              </span>
            )}
            {hasSnapshotActivity && (
              <span className="rounded border border-slate-600/35 bg-slate-800/40 px-2 py-0.5 text-[11px] font-medium tracking-wide text-slate-400">
                현장 입력 반영
              </span>
            )}
          </div>
        </div>
      </div>

      {err && <p className="text-amber-200/90 text-sm mb-4">{err}</p>}

      {w && (
        <section className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-slate-200">연간 누적 요약</h2>
          <div className="rounded-lg border border-slate-700/45 bg-slate-800/35 p-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-6">
            <div className="sm:col-span-3 rounded-md border border-slate-700/30 bg-slate-900/25 px-4 py-3">
              <dt className="text-xs font-medium text-slate-500">전체 (도우~파베)</dt>
              <dd className="mt-1 text-3xl font-bold tabular-nums text-cyan-200/90">{pct2(w.overallDiscardRatePct)}</dd>
              {yoyCompareUi && (
                <div className="mt-2 space-y-1">
                  {(yoyCompareUi.status || yoyCompareUi.primaryPhrase) && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {yoyCompareUi.status && yoyCompareUi.status !== "about_same" ? (
                        <span
                          className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold tabular-nums leading-tight ${wasteYoYCompareBadgeClass(yoyCompareUi.status)}`}
                        >
                          {wasteYoYCompareStatusLabel(yoyCompareUi.status)}
                        </span>
                      ) : null}
                      {yoyCompareUi.primaryPhrase ? (
                        <span className="min-w-0 text-xs tabular-nums text-slate-400">{yoyCompareUi.primaryPhrase}</span>
                      ) : null}
                    </div>
                  )}
                  <p className="text-[11px] leading-snug tabular-nums text-slate-600">{yoyCompareUi.secondLine}</p>
                </div>
              )}
            </div>
            <div>
              <dt className="text-xs text-slate-500">도우 폐기율 (가중)</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-300">{pct2(w.doughDiscardRatePct)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">파베이크 폐기율 (가중)</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-300">{pct2(w.parbakeDiscardRatePct)}</dd>
            </div>
            <div className="sm:col-span-3 border-t border-slate-700/35 pt-3">
              <p className="text-[11px] leading-relaxed text-slate-600">
                반죽 합계 {w.sumDoughMix.toLocaleString("ko-KR")} · 도우 폐기 합계 {w.sumDoughWaste.toLocaleString("ko-KR")}{" "}
                · 파베 폐기 합계 {w.sumParbakeWaste.toLocaleString("ko-KR")} · 파베 생산 합계{" "}
                {w.sumSameDayParbakeProduction.toLocaleString("ko-KR")}
              </p>
            </div>
          </div>
          </div>
        </section>
      )}

      <section className="mb-8">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-slate-200">월별 폐기율 요약</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            월 단위로 반죽·파베 생산·폐기를 합산한 뒤, 연간 요약과 같은 가중 방식(Σ폐기 ÷ Σ분모)으로 계산했습니다. 아래
            일별 표와 동일한 병합 데이터를 사용합니다.
          </p>
        </div>

        <div className="mb-4 rounded-lg border border-slate-700/35 bg-slate-900/20 px-3 py-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-600">월별 전체 폐기율 추이</p>
          {monthlyRowsForChart.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">막대로 표시할 월별 전체 폐기율이 없습니다.</p>
          ) : (
            <div className="max-w-full overflow-x-auto">
              <div
                className="flex h-28 min-w-[26rem] items-end justify-start gap-2 sm:min-w-0 sm:justify-between sm:gap-3"
                role="img"
                aria-label="월별 전체 폐기율 막대 그래프"
              >
                {monthlyRowsForChart.map((m) => {
                const pct = m.overallDiscardRatePct!;
                const hPct = Math.min(100, (pct / monthlyChartMaxPct) * 100);
                const selected = activeChartMonth === m.month;
                const barTone =
                  pct >= WASTE_DANGER_PCT
                    ? "bg-red-500/55"
                    : pct >= WASTE_WARN_PCT
                      ? "bg-amber-500/45"
                      : "bg-cyan-600/40";
                return (
                  <div key={m.month} className="group/bar flex min-w-[2rem] flex-1 flex-col items-center gap-1">
                    <div className="relative flex h-24 w-full min-w-[1.75rem] max-w-[2.5rem] flex-col items-center justify-end">
                      <div
                        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 rounded-md border border-slate-600/55 bg-slate-900/95 px-2 py-1.5 text-center opacity-0 shadow-lg ring-1 ring-black/20 transition-opacity duration-150 group-hover/bar:opacity-100"
                        role="tooltip"
                      >
                        <div className="text-[11px] font-medium text-slate-200">{m.month}월</div>
                        <div className="mt-0.5 text-xs tabular-nums text-cyan-200/95">전체 {pct.toFixed(2)}%</div>
                        <div className="mt-1 space-y-0.5 border-t border-slate-700/50 pt-1 text-[10px] tabular-nums text-slate-500">
                          <div>도우 {m.doughDiscardRatePct != null ? `${m.doughDiscardRatePct.toFixed(2)}%` : "—"}</div>
                          <div>파베 {m.parbakeDiscardRatePct != null ? `${m.parbakeDiscardRatePct.toFixed(2)}%` : "—"}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveChartMonth(m.month)}
                        className={`w-full max-w-[2.25rem] rounded-t-sm transition-[height] duration-300 ${barTone} ${
                          selected ? "ring-2 ring-cyan-300/70 ring-offset-1 ring-offset-slate-900/60" : ""
                        }`}
                        style={{ height: `${Math.max(hPct, 8)}%` }}
                        aria-label={`${m.month}월 전체 폐기율 ${pct.toFixed(2)}%`}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-slate-500">{m.month}월</span>
                  </div>
                );
                })}
              </div>
            </div>
          )}
          {activeChartMonth != null && (
            <div className="mt-2 rounded-md border border-slate-700/45 bg-slate-900/45 px-2.5 py-2 text-[11px] tabular-nums text-slate-400 sm:hidden">
              {(() => {
                const m = monthlyRowsForChart.find((row) => row.month === activeChartMonth);
                if (!m || m.overallDiscardRatePct == null) return null;
                return (
                  <p>
                    {m.month}월 · 전체 {m.overallDiscardRatePct.toFixed(2)}% · 도우{" "}
                    {m.doughDiscardRatePct != null ? `${m.doughDiscardRatePct.toFixed(2)}%` : "—"} · 파베{" "}
                    {m.parbakeDiscardRatePct != null ? `${m.parbakeDiscardRatePct.toFixed(2)}%` : "—"}
                  </p>
                );
              })()}
            </div>
          )}
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-700/40">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-700/30 bg-slate-800/50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 text-left font-medium text-slate-500">월</th>
                <th className="px-4 py-3 text-right font-medium">반죽량 합계</th>
                <th className="px-4 py-3 text-right font-medium">파베생산 합계</th>
                <th className="px-4 py-3 text-right font-medium">도우 폐기율</th>
                <th className="px-4 py-3 text-right font-medium">파베이크 폐기율</th>
                <th className="px-4 py-3 text-right font-medium text-slate-300">전체 폐기율</th>
              </tr>
            </thead>
            <tbody className="text-slate-400">
              {monthlyRowsWithData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    해당 연도에 월별 요약 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                monthlyRowsWithData.map((row) => {
                  const dim = row.sumDoughMix === 0;
                  return (
                    <tr key={row.month} className="border-b border-slate-700/20">
                      <td className={`px-4 py-2.5 font-medium ${dim ? "text-slate-600" : "text-slate-400"}`}>
                        {row.month}월
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums ${dim ? "text-slate-600" : "text-slate-400"}`}
                      >
                        {row.sumDoughMix.toLocaleString("ko-KR")}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums ${dim ? "text-slate-600" : "text-slate-400"}`}
                      >
                        {row.sumSameDayParbakeProduction.toLocaleString("ko-KR")}
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${rateCellClass(row.doughDiscardRatePct, dim)}`}>
                        {pct2(row.doughDiscardRatePct)}
                      </td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${rateCellClass(row.parbakeDiscardRatePct, dim)}`}>
                        {pct2(row.parbakeDiscardRatePct)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums text-[15px] font-semibold ${overallColClass(row.overallDiscardRatePct, dim)}`}
                      >
                        {pct2(row.overallDiscardRatePct)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mb-2">
        <h2 className="text-base font-semibold text-slate-200">일별 상세</h2>
        <p className="mt-1 text-xs text-slate-500">
          {year}년 기준, 반죽·폐기·파베 생산 중 하나라도 있는 날만 표시합니다. 월을 누르면 해당 월 일자를 펼칩니다.
        </p>
      </div>

      {dailyGroupsByMonth.length === 0 ? (
        <div className="rounded-lg border border-slate-700/40 px-4 py-10 text-center text-sm text-slate-500">
          표시할 일별 데이터가 없습니다.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-700/40">
          {dailyGroupsByMonth.map(({ month, dayRows }) => (
            <details
              key={month}
              className="open:[&>summary_svg]:rotate-90 border-b border-slate-700/25 last:border-b-0"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 bg-slate-800/30 px-4 py-3 text-sm text-slate-200 transition-colors hover:bg-slate-800/50 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200" aria-hidden />
                <span className="font-medium">
                  {year}년 {month}월
                </span>
                <span className="text-slate-500">· {dayRows.length}일</span>
              </summary>
              <div className="overflow-x-auto border-t border-slate-700/30 bg-slate-900/20">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-slate-700/30 bg-slate-800/50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      <th rowSpan={2} className="align-bottom px-4 py-3 font-medium">
                        일자
                      </th>
                      <th
                        colSpan={3}
                        className="border-l border-slate-700/25 px-4 py-2 text-center font-medium text-slate-500"
                      >
                        도우
                      </th>
                      <th
                        colSpan={3}
                        className="border-l border-slate-700/25 px-4 py-2 text-center font-medium text-slate-500"
                      >
                        파베이크
                      </th>
                      <th
                        rowSpan={2}
                        className="border-l border-slate-700/25 px-4 py-3 text-right align-bottom font-medium"
                      >
                        전체%
                      </th>
                    </tr>
                    <tr className="border-b border-slate-700/30 bg-slate-800/40 text-[10px] uppercase tracking-wide text-slate-600">
                      <th className="border-l border-slate-700/25 px-4 py-2.5 text-right font-normal">반죽량</th>
                      <th className="px-4 py-2.5 text-right font-normal">도우폐기</th>
                      <th className="px-4 py-2.5 text-right font-normal">도우%</th>
                      <th className="border-l border-slate-700/25 px-4 py-2.5 text-right font-normal">파베생산</th>
                      <th className="px-4 py-2.5 text-right font-normal">파베폐기</th>
                      <th className="px-4 py-2.5 text-right font-normal">파베%</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-400">
                    {dayRows.map((d: WasteDetailMockDayRow) => {
                      const dim = d.doughMixQty === 0;
                      const doughP = d.doughDiscardRatePct;
                      const parP = d.parbakeDiscardRatePct;
                      const allP = d.overallDiscardRatePct;
                      return (
                        <tr key={d.date} className="border-b border-slate-700/20">
                          <td className={`px-4 py-3 font-mono text-xs ${dim ? "text-slate-600" : "text-slate-500"}`}>
                            {d.date}
                          </td>
                          <td
                            className={`border-l border-slate-700/20 px-4 py-3 text-right tabular-nums ${dim ? "text-slate-600" : "text-slate-400"}`}
                          >
                            {d.doughMixQty.toLocaleString("ko-KR")}
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums ${dim ? "text-slate-600" : "text-slate-400"}`}>
                            {d.doughWasteQty.toLocaleString("ko-KR")}
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums ${rateCellClass(doughP, dim)}`}>
                            {pct2(doughP)}
                          </td>
                          <td
                            className={`border-l border-slate-700/20 px-4 py-3 text-right tabular-nums ${dim ? "text-slate-600" : "text-slate-400"}`}
                          >
                            {d.sameDayParbakeProductionQty.toLocaleString("ko-KR")}
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums ${dim ? "text-slate-600" : "text-slate-400"}`}>
                            {d.parbakeWasteQty.toLocaleString("ko-KR")}
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums ${rateCellClass(parP, dim)}`}>
                            {pct2(parP)}
                          </td>
                          <td
                            className={`border-l border-slate-700/20 px-4 py-3 text-right tabular-nums ${overallColClass(allP, dim)}`}
                          >
                            {pct2(allP)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
