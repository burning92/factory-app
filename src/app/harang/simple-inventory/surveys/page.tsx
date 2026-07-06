"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { InventorySurveyRow } from "@/features/harang/simpleInventorySurvey";
import { formatYmdDot } from "@/features/harang/simpleInventorySurvey";

const STATUS_LABEL = { draft: "작성중", confirmed: "확정" } as const;

export default function HarangInventorySurveysPage() {
  const [rows, setRows] = useState<InventorySurveyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("harang_inventory_surveys")
      .select("id, survey_date, title, status, note, created_at, confirmed_at")
      .order("survey_date", { ascending: false })
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }
    setRows((data ?? []) as InventorySurveyRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/harang/simple-inventory" className="text-sm text-slate-600 hover:text-slate-900">
              ← 간편 재고
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">재고조사</h1>
            <p className="mt-1 text-sm text-slate-600">
              확정 조사는 실사 스냅샷만 저장합니다. 소모량 리포트는{" "}
              <strong className="font-medium text-slate-800">두 번째 확정 조사부터</strong> 생성됩니다.
            </p>
          </div>
          <Link
            href="/harang/simple-inventory/surveys/new"
            className="px-4 py-2 rounded-lg bg-cyan-600 text-white text-sm font-medium hover:bg-cyan-700"
          >
            새 재고조사
          </Link>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 text-left">조사일</th>
                <th className="px-4 py-2.5 text-left">제목</th>
                <th className="px-4 py-2.5 text-left">상태</th>
                <th className="px-4 py-2.5 text-left">확정일</th>
                <th className="px-4 py-2.5 text-right"> </th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    재고조사가 없습니다.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="px-4 py-2.5 tabular-nums">{formatYmdDot(row.survey_date)}</td>
                    <td className="px-4 py-2.5">{row.title?.trim() || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                          row.status === "confirmed"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-600">
                      {row.confirmed_at ? formatYmdDot(row.confirmed_at) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/harang/simple-inventory/surveys/${row.id}`}
                        className="text-cyan-700 hover:underline text-xs font-medium"
                      >
                        {row.status === "draft" ? "입력/확정" : "상세"}
                      </Link>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
