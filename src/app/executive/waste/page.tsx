"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useMasterStore } from "@/store/useMasterStore";
import { bomRowsToRefs, materialsToMeta } from "@/features/dashboard/bomMaterialAdapters";
import { loadProductionBundle } from "@/features/dashboard/loadProductionBundle";
import { rollupYtdWaste } from "@/features/dashboard/aggregateProductionFromSnapshots";
import {
  mergeBundleDaysWithManualImportsForTable,
  type ManualWasteImportSeries,
  type WasteDetailMockDayRow,
} from "@/features/dashboard/wasteDetailMockData";
import { DashboardBackLink } from "../DashboardBackLink";
import type { ProductionBundle } from "@/features/dashboard/loadProductionBundle";

function pct2(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

/** 전체% 컬럼 — 0~3.99 시안, 4~9.99 주황 굵게, 10%↑ 빨강 굵게 */
function overallDiscardCellClass(pct: number | null): string {
  if (pct == null) return "text-slate-500";
  if (pct >= 10) return "text-red-400 font-bold";
  if (pct >= 4) return "text-orange-400 font-bold";
  return "text-cyan-400";
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
  const [err, setErr] = useState<string | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [manualSeries, setManualSeries] = useState<ManualWasteImportSeries>({
    doughProductionByDate: {},
    doughWasteByDate: {},
    parbakeWasteByDate: {},
  });

  const w = useMemo(() => (bundle?.days?.length ? rollupYtdWaste(bundle.days) : null), [bundle?.days]);

  const { rows: tableRows, filledManualDates } = useMemo(() => {
    return mergeBundleDaysWithManualImportsForTable(bundle?.days ?? [], manualSeries);
  }, [bundle?.days, manualSeries]);

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
      const [bundleRes, manualRes] = await Promise.all([
        loadProductionBundle(supabase, year, bomRowsToRefs(bomList), materialsToMeta(materials)),
        fetch(`/api/internal/manual-imports/summary?year=${year}`).then(async (r) => {
          if (!r.ok) throw new Error(`manual imports ${r.status}`);
          return (await r.json()) as ManualWasteImportSeries;
        }),
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

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-4 md:p-6 max-w-5xl mx-auto pb-24 md:pb-8">
      <DashboardBackLink />
      <h1 className="text-lg font-semibold text-slate-100 mb-1">폐기율 상세</h1>
      <p className="text-slate-500 text-sm mb-6">
        일별 비율 후 올해 가중 평균(Σ폐기÷Σ분모). 파베이크 분모는 당일 파베이크 생산량과 동일(도우 사용량).
      </p>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <label htmlFor="waste-year-filter" className="text-xs text-slate-500">
          연도
        </label>
        <select
          id="waste-year-filter"
          className="rounded-md border border-slate-600/70 bg-slate-900/80 px-2.5 py-1.5 text-sm text-slate-200 focus:border-cyan-600/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {[2024, 2025, 2026].map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
      </div>

      {filledManualDates.length > 0 && (
        <p className="text-xs text-slate-600 mb-4 rounded-md border border-slate-700/50 bg-slate-900/40 px-3 py-2">
          반죽·폐기 수치가 비어 있는 일자({filledManualDates.length}일)는 수동 JSONL(도우생산/폐기)로 표를
          보강했습니다. 상단 가중 요약은 2차 마감 스냅샷 원본만 반영합니다.
        </p>
      )}

      {err && <p className="text-amber-200 text-sm mb-4">{err}</p>}

      {w && (
        <section className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-4 mb-6 text-sm">
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-slate-300">
            <div>
              <dt className="text-slate-500 text-xs mb-1">도우 폐기율 (가중)</dt>
              <dd className="text-xl font-semibold text-cyan-200/90 tabular-nums">{pct2(w.doughDiscardRatePct)}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs mb-1">파베이크 폐기율 (가중)</dt>
              <dd className="text-xl font-semibold text-cyan-200/90 tabular-nums">{pct2(w.parbakeDiscardRatePct)}</dd>
            </div>
            <div>
              <dt className="text-slate-500 text-xs mb-1">전체 (도우~파베)</dt>
              <dd className="text-xl font-semibold text-cyan-200/90 tabular-nums">{pct2(w.overallDiscardRatePct)}</dd>
            </div>
          </dl>
          <p className="text-xs text-slate-600 mt-3">
            Σ 반죽 {w.sumDoughMix.toLocaleString("ko-KR")} · Σ 도우폐기 {w.sumDoughWaste.toLocaleString("ko-KR")} · Σ
            파베폐기 {w.sumParbakeWaste.toLocaleString("ko-KR")} · Σ 파베생산{" "}
            {w.sumSameDayParbakeProduction.toLocaleString("ko-KR")}
          </p>
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-700/60">
        <table className="w-full text-sm text-left text-slate-300">
          <thead className="bg-slate-800/80 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2">일자</th>
              <th className="px-3 py-2 text-right">반죽량</th>
              <th className="px-3 py-2 text-right">도우폐기</th>
              <th className="px-3 py-2 text-right">도우%</th>
              <th className="px-3 py-2 text-right">파베생산</th>
              <th className="px-3 py-2 text-right">파베폐기</th>
              <th className="px-3 py-2 text-right">파베%</th>
              <th className="px-3 py-2 text-right">전체%</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  데이터가 없습니다.
                </td>
              </tr>
            )}
            {tableRows.map((d: WasteDetailMockDayRow) => {
              const dim = d.doughMixQty === 0;
              const muted = dim ? "text-gray-600" : "text-slate-300";
              const doughP = d.doughDiscardRatePct;
              const parP = d.parbakeDiscardRatePct;
              const allP = d.overallDiscardRatePct;
              return (
                <tr key={d.date} className="border-t border-slate-700/50">
                  <td className={`px-3 py-2 font-mono text-xs ${muted}`}>{d.date}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${muted}`}>
                    {d.doughMixQty.toLocaleString("ko-KR")}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${muted}`}>
                    {d.doughWasteQty.toLocaleString("ko-KR")}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${muted}`}>{pct2(doughP)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${muted}`}>
                    {d.sameDayParbakeProductionQty.toLocaleString("ko-KR")}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${muted}`}>
                    {d.parbakeWasteQty.toLocaleString("ko-KR")}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${muted}`}>{pct2(parP)}</td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${dim ? "text-gray-600" : overallDiscardCellClass(allP)}`}
                  >
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
