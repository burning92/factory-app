"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useMasterStore } from "@/store/useMasterStore";
import { bomRowsToRefs, materialsToMeta } from "@/features/dashboard/bomMaterialAdapters";
import { loadProductionBundle } from "@/features/dashboard/loadProductionBundle";
import {
  rollupYtdProduction,
  type DayProductionMetrics,
  type YtdProductionRollup,
} from "@/features/dashboard/aggregateProductionFromSnapshots";
import { DashboardBackLink } from "../DashboardBackLink";
import { ExecutivePortalTooltip } from "../ExecutivePortalTooltip";
import { executiveTooltipHostRowClass } from "../executiveTooltipStyles";
import type { ProductionBundle } from "@/features/dashboard/loadProductionBundle";

function totalFinishedFromRollup(r: YtdProductionRollup): number {
  return (
    r.lightPizza +
    r.heavyPizza +
    r.bread +
    r.other +
    r.astronautParbake +
    r.saleParbake
  );
}

function numericCellClass(n: number, opts?: { totalCol?: boolean }): string {
  const dim = n === 0;
  const base = "px-2 md:px-3 py-2 text-right tabular-nums";
  const weight = opts?.totalCol ? "font-semibold" : "";
  const bg = opts?.totalCol ? "bg-slate-800/30" : "";
  const color = dim ? "text-slate-600" : opts?.totalCol ? "text-slate-100" : "text-slate-200";
  return `${base} ${weight} ${bg} ${color}`.trim();
}

export default function ExecutiveProductionDetailPage() {
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
  /** null = 연간 전체 */
  const [tableMonth, setTableMonth] = useState<number | null>(null);

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
      const { bundle: b, error } = await loadProductionBundle(
        supabase,
        year,
        bomRowsToRefs(bomList),
        materialsToMeta(materials)
      );
      if (c) return;
      if (error) setErr(error.message);
      else {
        setErr(null);
        setBundle(b);
      }
    })();
    return () => {
      c = true;
    };
  }, [canView, materialsLoading, bomLoading, materials, bomList, year]);

  const filteredDays = useMemo(() => {
    const days = bundle?.days ?? [];
    if (tableMonth == null) return days;
    const prefix = `${year}-${String(tableMonth).padStart(2, "0")}`;
    return days.filter((d) => d.date.startsWith(prefix));
  }, [bundle?.days, year, tableMonth]);

  const scoreRollup: YtdProductionRollup | null = useMemo(() => {
    if (!bundle) return null;
    if (tableMonth == null) return bundle.ytdProduction;
    return rollupYtdProduction(filteredDays);
  }, [bundle, tableMonth, filteredDays]);

  const scoreCards = useMemo(() => {
    if (!scoreRollup) return null;
    const total = totalFinishedFromRollup(scoreRollup);
    const pizza = scoreRollup.lightPizza + scoreRollup.heavyPizza;
    const bread = scoreRollup.bread;
    const parbake = scoreRollup.astronautParbake + scoreRollup.saleParbake;
    return { total, pizza, bread, parbake };
  }, [scoreRollup]);

  if (!canView) return null;

  const ytd = bundle?.ytdProduction ?? null;
  const ecount = bundle?.ecountMerge;

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-4 md:p-6 max-w-6xl mx-auto pb-24 md:pb-8">
      <DashboardBackLink />
      <div className={`mb-4 flex flex-wrap items-center gap-2 ${executiveTooltipHostRowClass}`}>
        <h1 className="text-lg font-semibold text-slate-100">생산량 상세</h1>
        <ExecutivePortalTooltip
          trigger={
            <button
              type="button"
              className="rounded p-0.5 text-cyan-500/80 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
              aria-label="생산량 집계 안내"
            >
              <Info className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          }
        >
          <span className="block">
            올해 누적 생산량입니다. 일별 생산기록을 기준으로 집계했으며, 일부 누락 구간은 생산실적 자료를
            반영했습니다.
          </span>
          <span className="mt-2 block text-slate-300">이 페이지에서 일자별 기준을 확인할 수 있습니다.</span>
        </ExecutivePortalTooltip>
      </div>

      {err && <p className="mb-4 text-sm text-amber-200">{err}</p>}

      {ecount && (
        <p className="mb-4 rounded-md border border-slate-700/40 bg-slate-800/50 px-2.5 py-1.5 text-xs leading-snug text-slate-400">
          생산실적 자료 {ecount.linesCounted.toLocaleString("ko-KR")}건을 반영했습니다. 이미 마감 처리된 날은
          중복 없이 {ecount.skippedBecauseSecondClosed.toLocaleString("ko-KR")}건 제외
          {ecount.error ? ` · ${ecount.error}` : ""}.
        </p>
      )}

      {ytd && scoreCards && (
        <section className="mb-6">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {tableMonth == null ? "올해 누적 요약" : `${tableMonth}월 요약`}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-cyan-900/40 bg-gradient-to-br from-slate-800/90 to-slate-900/80 p-4 shadow-sm ring-1 ring-cyan-500/15">
              <p className="text-[11px] font-medium uppercase tracking-wide text-cyan-500/90">
                전체 완제품 총합
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-slate-50 sm:text-4xl">
                {scoreCards.total.toLocaleString("ko-KR")}
              </p>
            </div>
            <div className="rounded-xl border border-slate-700/55 bg-slate-800/45 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">피자류 합계</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">
                {scoreCards.pizza.toLocaleString("ko-KR")}
              </p>
            </div>
            <div className="rounded-xl border border-slate-700/55 bg-slate-800/45 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">브레드 합계</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">
                {scoreCards.bread.toLocaleString("ko-KR")}
              </p>
            </div>
            <div className="rounded-xl border border-slate-700/55 bg-slate-800/45 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">파베이크 합계</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-100">
                {scoreCards.parbake.toLocaleString("ko-KR")}
              </p>
            </div>
          </div>
        </section>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
        <label htmlFor="prod-year-filter" className="text-xs text-slate-500">
          연도
        </label>
        <select
          id="prod-year-filter"
          className="rounded-md border border-slate-600/70 bg-slate-900/80 px-2.5 py-1.5 text-sm text-slate-200 focus:border-cyan-600/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
          value={year}
          onChange={(e) => {
            setYear(Number(e.target.value));
            setTableMonth(null);
          }}
        >
          {[2024, 2025, 2026].map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>

        <label htmlFor="prod-month-filter" className="text-xs text-slate-500">
          기간
        </label>
        <select
          id="prod-month-filter"
          className="rounded-md border border-slate-600/70 bg-slate-900/80 px-2.5 py-1.5 text-sm text-slate-200 focus:border-cyan-600/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
          value={tableMonth ?? "all"}
          onChange={(e) => {
            const v = e.target.value;
            setTableMonth(v === "all" ? null : Number(v));
          }}
        >
          <option value="all">연간 전체</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}월
            </option>
          ))}
        </select>
      </div>

      <div className="max-h-[min(72vh,calc(100dvh-14rem))] overflow-auto rounded-lg border border-slate-700/60">
        <table className="w-full min-w-[640px] text-sm text-left text-slate-300">
          <thead className="border-b border-slate-600/40 text-xs uppercase text-slate-500">
            <tr>
              <th className="sticky top-0 z-10 bg-slate-800/95 px-2 py-2.5 shadow-[0_1px_0_0_rgba(15,23,42,0.65)] backdrop-blur-sm md:px-3">
                일자
              </th>
              <th className="sticky top-0 z-10 bg-slate-800/95 px-2 py-2.5 text-right shadow-[0_1px_0_0_rgba(15,23,42,0.65)] backdrop-blur-sm md:px-3">
                완제품 합계
              </th>
              <th className="sticky top-0 z-10 bg-slate-800/95 px-2 py-2.5 text-right shadow-[0_1px_0_0_rgba(15,23,42,0.65)] backdrop-blur-sm md:px-3">
                라이트
              </th>
              <th className="sticky top-0 z-10 bg-slate-800/95 px-2 py-2.5 text-right shadow-[0_1px_0_0_rgba(15,23,42,0.65)] backdrop-blur-sm md:px-3">
                헤비
              </th>
              <th className="sticky top-0 z-10 bg-slate-800/95 px-2 py-2.5 text-right shadow-[0_1px_0_0_rgba(15,23,42,0.65)] backdrop-blur-sm md:px-3">
                브레드
              </th>
              <th className="sticky top-0 z-10 bg-slate-800/95 px-2 py-2.5 text-right shadow-[0_1px_0_0_rgba(15,23,42,0.65)] backdrop-blur-sm md:px-3">
                우주인
              </th>
              <th className="sticky top-0 z-10 bg-slate-800/95 px-2 py-2.5 text-right shadow-[0_1px_0_0_rgba(15,23,42,0.65)] backdrop-blur-sm md:px-3">
                판매
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredDays.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                  데이터가 없습니다.
                </td>
              </tr>
            )}
            {filteredDays.map((d: DayProductionMetrics) => (
              <tr key={d.date} className="border-t border-slate-700/50">
                <td className="px-2 py-2 font-mono text-xs text-slate-400 md:px-3">{d.date}</td>
                <td className={numericCellClass(d.totalFinishedQty, { totalCol: true })}>
                  {d.totalFinishedQty.toLocaleString("ko-KR")}
                </td>
                <td className={numericCellClass(d.finishedLightPizza)}>{d.finishedLightPizza.toLocaleString("ko-KR")}</td>
                <td className={numericCellClass(d.finishedHeavyPizza)}>{d.finishedHeavyPizza.toLocaleString("ko-KR")}</td>
                <td className={numericCellClass(d.finishedBread)}>{d.finishedBread.toLocaleString("ko-KR")}</td>
                <td className={numericCellClass(d.astronautParbakeQty)}>{d.astronautParbakeQty.toLocaleString("ko-KR")}</td>
                <td className={numericCellClass(d.saleParbakeQty)}>{d.saleParbakeQty.toLocaleString("ko-KR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
