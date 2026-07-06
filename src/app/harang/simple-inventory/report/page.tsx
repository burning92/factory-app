"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  SurveyConsumptionReportRow,
  SurveyMonthlyItemRow,
} from "@/features/harang/simpleInventorySurvey";
import { formatYmdDot } from "@/features/harang/simpleInventorySurvey";

type Tab = "period" | "monthly";

export default function HarangSimpleInventoryReportPage() {
  const [tab, setTab] = useState<Tab>("period");
  const [monthFilter, setMonthFilter] = useState("");
  const [periodRows, setPeriodRows] = useState<SurveyConsumptionReportRow[]>([]);
  const [monthlyRows, setMonthlyRows] = useState<SurveyMonthlyItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const monthArg = monthFilter.trim() || null;
    const [periodRes, monthlyRes] = await Promise.all([
      supabase.rpc("harang_list_survey_consumption_report", {
        p_month: monthArg,
        p_item_id: null,
      }),
      tab === "monthly"
        ? supabase.rpc("harang_list_survey_monthly_item_summary", { p_month: monthArg })
        : Promise.resolve({ data: null, error: null }),
    ]);
    setLoading(false);
    if (periodRes.error) {
      setError(periodRes.error.message);
      setPeriodRows([]);
      setMonthlyRows([]);
      return;
    }
    setPeriodRows((periodRes.data ?? []) as SurveyConsumptionReportRow[]);
    if (monthlyRes.error) {
      setMonthlyRows([]);
    } else if (monthlyRes.data) {
      setMonthlyRows((monthlyRes.data ?? []) as SurveyMonthlyItemRow[]);
    }
  }, [monthFilter, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of periodRows) {
      set.add(r.curr_survey_date.slice(0, 7));
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [periodRows]);

  const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 3 });

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto space-y-5">
        <div>
          <Link href="/harang/simple-inventory" className="text-sm text-slate-600 hover:text-slate-900">
            ← 간편 재고
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">소모량 리포트</h1>
          <p className="mt-1 text-sm text-slate-600">
            계산 소모량 = 전 조사 재고 + 기간 중 입고 − 현 조사 재고. 제품별 BOM·생산건별 사용량이 아닙니다.
          </p>
        </div>

        <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-950">
          <p>
            기간 중 입고는 <code className="text-xs">tx_type = inbound</code>만 집계합니다. usage·adjustment·disposal·
            production은 포함하지 않습니다. 첫 번째 확정 조사(기준선) 구간은 리포트에 나오지 않습니다.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-wrap gap-3 items-end">
          <label className="block text-xs text-slate-600">
            월 필터 (YYYY-MM)
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="mt-1 block px-3 py-2 rounded-lg border border-slate-300 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => setMonthFilter("")}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 hover:bg-slate-50"
          >
            전체
          </button>
          <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setTab("period")}
              className={`px-4 py-2 ${tab === "period" ? "bg-cyan-600 text-white" : "bg-white text-slate-700"}`}
            >
              조사 구간별
            </button>
            <button
              type="button"
              onClick={() => setTab("monthly")}
              className={`px-4 py-2 ${tab === "monthly" ? "bg-cyan-600 text-white" : "bg-white text-slate-700"}`}
            >
              월별 품목
            </button>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-900"
          >
            새로고침
          </button>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {error.includes("Could not find") || error.includes("schema cache")
              ? "마이그레이션이 아직 적용되지 않았습니다. 20260706120000_harang_simple_inventory_survey.sql 을 적용하세요."
              : error}
          </div>
        ) : null}

        {periodRows.length === 0 && !loading && !error ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">
            확정된 재고조사가 <strong className="font-medium">2건 이상</strong> 있어야 구간별 소모량이 계산됩니다.
            첫 번째 조사는 기준선입니다.{" "}
            <Link href="/harang/simple-inventory/surveys/new" className="text-cyan-700 underline">
              재고조사 등록
            </Link>
          </div>
        ) : null}

        {tab === "period" && periodRows.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">기간</th>
                  <th className="px-3 py-2 text-left">품목</th>
                  <th className="px-3 py-2 text-left">소비기한</th>
                  <th className="px-3 py-2 text-right">전 조사 재고</th>
                  <th className="px-3 py-2 text-right">기간 중 입고</th>
                  <th className="px-3 py-2 text-right">현 조사 재고</th>
                  <th className="px-3 py-2 text-right font-semibold">계산 소모량</th>
                  <th className="px-3 py-2 text-left">단위</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                      불러오는 중…
                    </td>
                  </tr>
                )}
                {!loading &&
                  periodRows.map((row, i) => (
                    <tr key={`${row.curr_survey_id}-${row.item_id}-${row.lot_date}-${i}`} className="border-b border-slate-100">
                      <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{row.period_label}</td>
                      <td className="px-3 py-2">{row.item_name}</td>
                      <td className="px-3 py-2 tabular-nums">{formatYmdDot(row.lot_date)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(row.prev_physical))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                        {fmt(Number(row.period_inbound))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(row.curr_physical))}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                        {fmt(Number(row.calculated_consumption))}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.unit}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "monthly" && (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">월</th>
                  <th className="px-3 py-2 text-left">품목</th>
                  <th className="px-3 py-2 text-right">월간 계산 소모량</th>
                  <th className="px-3 py-2 text-right">월말 재고(실사)</th>
                  <th className="px-3 py-2 text-left">마지막 조사일</th>
                  <th className="px-3 py-2 text-left">단위</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                      불러오는 중…
                    </td>
                  </tr>
                )}
                {!loading && monthlyRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                      데이터 없음
                    </td>
                  </tr>
                )}
                {!loading &&
                  monthlyRows.map((row) => (
                    <tr key={`${row.month_label}-${row.item_id}`} className="border-b border-slate-100">
                      <td className="px-3 py-2 tabular-nums">{row.month_label}</td>
                      <td className="px-3 py-2">{row.item_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {fmt(Number(row.total_consumption))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(row.month_end_stock))}</td>
                      <td className="px-3 py-2 tabular-nums">{formatYmdDot(row.last_survey_date)}</td>
                      <td className="px-3 py-2">{row.unit}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {monthOptions.length > 0 && (
          <p className="text-xs text-slate-500">리포트에 포함된 월: {monthOptions.join(", ")}</p>
        )}
      </div>
    </div>
  );
}
