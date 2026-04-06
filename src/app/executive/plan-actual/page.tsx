"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  loadPlanActualByProductForMonth,
  majorCategoryForPlanActualProduct,
} from "@/features/dashboard/planVsActual";
import { DashboardBackLink } from "../DashboardBackLink";
import { executiveTooltipHostRowClass, executiveTooltipPanelClass } from "../executiveTooltipStyles";
import type { PlanActualProductRow } from "@/features/dashboard/planVsActual";

type PlanCategoryKey = "pizza" | "bread" | "parbake";

const PLAN_ACTUAL_CATEGORY_SECTIONS: { key: PlanCategoryKey; label: string }[] = [
  { key: "pizza", label: "피자" },
  { key: "bread", label: "브레드" },
  { key: "parbake", label: "파베이크" },
];

function planActualAchievementPct(plan: number, actual: number): number | null {
  if (plan <= 0) return null;
  const v = (actual / plan) * 100;
  return Number.isFinite(v) ? v : null;
}

function formatAchievementPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

/** 달성률 미니 바 폭(%) — 100% 달성 시 막대 가득 */
function achievementBarWidthPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return "0%";
  return `${Math.min(100, pct)}%`;
}

function diffCellClass(sum: number, opts?: { header?: boolean }): string {
  const base = opts?.header ? "text-sm font-bold tabular-nums" : "tabular-nums";
  if (sum < 0) return `${base} text-red-400`;
  if (sum > 0) return `${base} text-emerald-400/95`;
  return `${base} text-slate-400`;
}

export default function ExecutivePlanActualDetailPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const canView = profile?.role === "admin" || profile?.role === "manager";

  const { y, m } = useMemo(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }, []);
  const [month, setMonth] = useState(m);

  const [rows, setRows] = useState<PlanActualProductRow[]>([]);
  const [planFromProcessedSheet, setPlanFromProcessedSheet] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!canView) router.replace("/");
  }, [authLoading, canView, router]);

  useEffect(() => {
    if (!canView) return;
    let c = false;
    (async () => {
      try {
        const data = await loadPlanActualByProductForMonth(supabase, y, month);
        if (!c) {
          setRows(data.rows);
          setPlanFromProcessedSheet(data.planFromProcessedSheet);
          setErr(null);
        }
      } catch (e) {
        if (!c) setErr(e instanceof Error ? e.message : "조회 실패");
      }
    })();
    return () => {
      c = true;
    };
  }, [canView, y, month]);

  const groupedSections = useMemo(() => {
    const buckets: Record<PlanCategoryKey, PlanActualProductRow[]> = {
      pizza: [],
      bread: [],
      parbake: [],
    };
    for (const r of rows) {
      buckets[majorCategoryForPlanActualProduct(r.productName)].push(r);
    }
    return PLAN_ACTUAL_CATEGORY_SECTIONS.map(({ key, label }) => {
      const list = buckets[key];
      const planSum = list.reduce((s, r) => s + r.planQty, 0);
      const actualSum = list.reduce((s, r) => s + r.actualQty, 0);
      const diffSum = list.reduce((s, r) => s + r.diff, 0);
      const achievementPct = planActualAchievementPct(planSum, actualSum);
      return { key, label, rows: list, planSum, actualSum, diffSum, achievementPct };
    });
  }, [rows]);

  if (!canView) return null;

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-4 md:p-6 max-w-5xl mx-auto pb-24 md:pb-8">
      <DashboardBackLink />
      <div className={`mb-3 flex flex-wrap items-center gap-2 ${executiveTooltipHostRowClass}`}>
        <h1 className="text-lg font-semibold text-slate-100">계획 대비 실적 상세</h1>
        <span className="group relative inline-flex">
          <button
            type="button"
            className="rounded p-0.5 text-cyan-500/80 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
            aria-label="계획 대비 실적 집계 기준 안내"
          >
            <Info className="w-4 h-4" strokeWidth={2} aria-hidden />
          </button>
          <span
            role="tooltip"
            className={`${executiveTooltipPanelClass} left-0 w-[min(22rem,calc(100vw-2rem))]`}
          >
            {y}년 {month}월 · 계획 ={" "}
            {planFromProcessedSheet ? "생산계획가공 시트 합계" : "생산계획 시트 합계"}, 실적 = 2차 마감
            스냅샷 완제품 합계(품목명 매칭). 표는 피자·브레드·파베이크 대분류로 묶어 소계를 보여 줍니다.
          </span>
        </span>
      </div>
      <div className="mb-4">
        <label className="text-xs text-slate-500 mr-2">월 선택</label>
        <select
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
            <option key={mm} value={mm}>
              {mm}월
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-slate-600 mb-6">
        2차 마감 합계와 일 수치가 다를 수 있습니다. 품목명 표기를 맞추면 근접합니다.
      </p>

      {err && <p className="text-amber-200 text-sm mb-4">{err}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-700/60">
        <table className="w-full min-w-[640px] table-fixed text-sm text-left text-slate-300">
          <colgroup>
            <col className="w-[30%] min-w-[7rem]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[22%]" />
            <col className="w-[20%]" />
          </colgroup>
          <thead className="bg-slate-800/80 text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2.5 align-bottom">품목</th>
              <th className="px-2 py-2.5 text-right align-bottom">계획</th>
              <th className="px-2 py-2.5 text-right align-bottom">실적</th>
              <th className="px-2 py-2.5 text-right align-bottom">달성률</th>
              <th className="px-3 py-2.5 text-right align-bottom">차이</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                  데이터가 없습니다.
                </td>
              </tr>
            ) : (
              groupedSections.map((section) => (
                <Fragment key={section.key}>
                <tr className="border-t border-slate-600/50 bg-slate-800/55">
                  <td className="px-3 py-2.5 text-sm font-bold text-slate-100">{section.label}</td>
                  <td className="px-2 py-2.5 text-right text-sm font-bold tabular-nums text-slate-200">
                    {section.planSum.toLocaleString("ko-KR")}
                  </td>
                  <td className="px-2 py-2.5 text-right text-sm font-bold tabular-nums text-slate-200">
                    {section.actualSum.toLocaleString("ko-KR")}
                  </td>
                  <td className="px-2 py-2.5 align-middle">
                    <div className="flex flex-col items-end gap-1.5 pr-0">
                      <span className="text-sm font-bold tabular-nums text-cyan-200">
                        {formatAchievementPct(section.achievementPct)}
                      </span>
                      <div className="h-1 w-full max-w-[7.5rem] rounded-full bg-slate-900/80">
                        <div
                          className="h-full rounded-full bg-cyan-400/85"
                          style={{ width: achievementBarWidthPct(section.achievementPct) }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className={`px-3 py-2.5 text-right ${diffCellClass(section.diffSum, { header: true })}`}>
                    {section.diffSum > 0 ? "+" : ""}
                    {section.diffSum.toLocaleString("ko-KR")}
                  </td>
                </tr>
                {section.rows.map((r) => {
                  const expanded = expandedProduct === r.productName;
                  const rowDim = r.actualQty === 0;
                  const rowMuted = rowDim ? "text-slate-500" : "text-slate-300";
                  const ach = planActualAchievementPct(r.planQty, r.actualQty);
                  return (
                    <Fragment key={`${section.key}-${r.productName}`}>
                      <tr className="border-t border-slate-700/40 bg-slate-900/25">
                        <td className={`py-2 pl-8 pr-3 ${rowMuted}`}>
                          <span
                            className={`mr-1.5 inline-block w-3 shrink-0 text-center font-mono text-[10px] select-none ${rowDim ? "text-slate-600" : "text-slate-600"}`}
                          >
                            └
                          </span>
                          {r.actualQty > 0 ? (
                            <button
                              type="button"
                              className="text-left text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                              onClick={() =>
                                setExpandedProduct((prev) => (prev === r.productName ? null : r.productName))
                              }
                            >
                              {r.productName}
                            </button>
                          ) : (
                            <span>{r.productName}</span>
                          )}
                        </td>
                        <td className={`px-2 py-2 text-right tabular-nums ${rowMuted}`}>
                          {r.planQty.toLocaleString("ko-KR")}
                        </td>
                        <td className={`px-2 py-2 text-right tabular-nums ${rowMuted}`}>
                          {r.actualQty.toLocaleString("ko-KR")}
                        </td>
                        <td className="px-2 py-2 align-middle">
                          <div className="flex flex-col items-end gap-1">
                            <span
                              className={`text-xs font-medium tabular-nums ${rowDim ? "text-slate-500" : "text-slate-400"}`}
                            >
                              {formatAchievementPct(ach)}
                            </span>
                            <div className="h-1 w-full max-w-[6.5rem] rounded-full bg-slate-800/90">
                              <div
                                className={`h-full rounded-full ${rowDim ? "bg-slate-600/50" : "bg-cyan-600/45"}`}
                                style={{ width: achievementBarWidthPct(ach) }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className={`px-3 py-2 text-right ${diffCellClass(r.diff)}`}>
                          {r.diff > 0 ? "+" : ""}
                          {r.diff.toLocaleString("ko-KR")}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-t border-slate-700/30 bg-slate-900/70">
                          <td colSpan={5} className="py-3 pl-8 pr-3">
                            <p className="mb-2 text-xs text-slate-400">{r.productName} 실적 일자</p>
                            {r.actualDailyBreakdown.length === 0 ? (
                              <p className="text-sm text-slate-500">실적 일자 데이터가 없습니다.</p>
                            ) : (
                              <ul className="space-y-1 text-sm text-slate-300">
                                {r.actualDailyBreakdown.map((d) => (
                                  <li key={`${r.productName}-${d.date}`} className="flex justify-between gap-2">
                                    <span>{d.date}</span>
                                    <span className="tabular-nums">{d.qty.toLocaleString("ko-KR")}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
