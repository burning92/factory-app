"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useMasterStore } from "@/store/useMasterStore";
import { bomRowsToRefs, materialsToMeta } from "@/features/dashboard/bomMaterialAdapters";
import { loadProductionBundle } from "@/features/dashboard/loadProductionBundle";
import {
  mergeBundleDaysWithManualImportsForTable,
  rollupWasteMockFromDayRows,
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

export default function ExecutiveWasteDetailPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const canView = profile?.role === "admin" || profile?.role === "manager";

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
          <p className="mt-1 text-sm text-slate-500">
            일별 폐기율을 연도 누적으로 가중 평균한 값입니다.
            <button
              type="button"
              onClick={() => setShowCriteria((v) => !v)}
              className="ml-2 text-xs text-slate-500 underline decoration-slate-600 underline-offset-2 hover:text-slate-400"
            >
              {showCriteria ? "집계 기준 접기" : "집계 기준 보기"}
            </button>
          </p>
          {showCriteria && (
            <div className="mt-2 rounded-md border border-slate-700/40 bg-slate-900/35 px-3 py-2.5 text-xs leading-relaxed text-slate-500">
              Σ폐기÷Σ분모로 일별 비율 후 합산합니다. 파베이크 분모는 해당 연도에 수동 파베 생산 집계가 있으면 그
              수치를 쓰고, 없으면 스냅샷의 도우 사용량(수동 도우만 있을 때는 반죽량)을 씁니다. 상단 요약·표는
              스냅샷·이카운트 번들과 수동 JSONL을 합친 결과입니다.
              {filledManualDates.length > 0 && (
                <span className="mt-2 block text-slate-600">
                  반죽·폐기가 비었거나 번들에 없는 일자 {filledManualDates.length}일은 수동 JSONL로 보강했습니다.
                </span>
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
              <span className="rounded border border-slate-600/35 bg-slate-800/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                수동 보강 포함
              </span>
            )}
            {ecountLines > 0 && (
              <span className="rounded border border-slate-600/35 bg-slate-800/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                이카운트 생산 반영
              </span>
            )}
            {hasSnapshotActivity && (
              <span className="rounded border border-slate-600/35 bg-slate-800/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                실입력 포함
              </span>
            )}
          </div>
        </div>
      </div>

      {err && <p className="text-amber-200/90 text-sm mb-4">{err}</p>}

      {w && (
        <section className="rounded-lg border border-slate-700/45 bg-slate-800/35 p-5 mb-6">
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
                Σ 반죽 {w.sumDoughMix.toLocaleString("ko-KR")} · Σ 도우폐기 {w.sumDoughWaste.toLocaleString("ko-KR")} · Σ
                파베폐기 {w.sumParbakeWaste.toLocaleString("ko-KR")} · Σ 파베생산{" "}
                {w.sumSameDayParbakeProduction.toLocaleString("ko-KR")}
              </p>
            </div>
          </div>
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-700/40">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-slate-700/30 bg-slate-800/50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <th rowSpan={2} className="align-bottom px-4 py-3 font-medium">
                일자
              </th>
              <th colSpan={3} className="border-l border-slate-700/25 px-4 py-2 text-center font-medium text-slate-500">
                도우
              </th>
              <th colSpan={3} className="border-l border-slate-700/25 px-4 py-2 text-center font-medium text-slate-500">
                파베이크
              </th>
              <th rowSpan={2} className="border-l border-slate-700/25 px-4 py-3 text-right align-bottom font-medium">
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
            {tableRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  데이터가 없습니다.
                </td>
              </tr>
            )}
            {tableRows.map((d: WasteDetailMockDayRow) => {
              const dim = d.doughMixQty === 0;
              const doughP = d.doughDiscardRatePct;
              const parP = d.parbakeDiscardRatePct;
              const allP = d.overallDiscardRatePct;
              const rowBorder = "border-b border-slate-700/20";
              return (
                <tr key={d.date} className={rowBorder}>
                  <td className={`px-4 py-3 font-mono text-xs ${dim ? "text-slate-600" : "text-slate-500"}`}>
                    {d.date}
                  </td>
                  <td className={`border-l border-slate-700/20 px-4 py-3 text-right tabular-nums ${dim ? "text-slate-600" : "text-slate-400"}`}>
                    {d.doughMixQty.toLocaleString("ko-KR")}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${dim ? "text-slate-600" : "text-slate-400"}`}>
                    {d.doughWasteQty.toLocaleString("ko-KR")}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${rateCellClass(doughP, dim)}`}>{pct2(doughP)}</td>
                  <td className={`border-l border-slate-700/20 px-4 py-3 text-right tabular-nums ${dim ? "text-slate-600" : "text-slate-400"}`}>
                    {d.sameDayParbakeProductionQty.toLocaleString("ko-KR")}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${dim ? "text-slate-600" : "text-slate-400"}`}>
                    {d.parbakeWasteQty.toLocaleString("ko-KR")}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${rateCellClass(parP, dim)}`}>{pct2(parP)}</td>
                  <td className={`border-l border-slate-700/20 px-4 py-3 text-right tabular-nums ${overallColClass(allP, dim)}`}>
                    {pct2(allP)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
