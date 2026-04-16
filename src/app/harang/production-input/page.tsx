"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { HarangProductionHeader } from "@/features/harang/types";

function authorLabel(header: HarangProductionHeader): string {
  const profile = Array.isArray(header.profiles) ? header.profiles[0] : header.profiles;
  return profile?.display_name || profile?.login_id || "-";
}

export default function HarangProductionInputListPage() {
  const [rows, setRows] = useState<HarangProductionHeader[]>([]);
  const [yearFilter, setYearFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [dayFilter, setDayFilter] = useState("");
  const [keyword, setKeyword] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({ year: "", month: "", day: "", keyword: "" });
  const [loading, setLoading] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("harang_production_headers")
      .select(
        `
        id,
        production_date,
        production_no,
        product_name,
        finished_qty,
        note,
        created_by,
        created_at,
        profiles:created_by(display_name, login_id)
      `,
      )
      .order("production_date", { ascending: false })
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }
    setRows((data ?? []) as HarangProductionHeader[]);
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const [rowYear = "", rowMonth = "", rowDay = ""] = row.production_date.split("-");
      const normalizedMonth = appliedFilters.month.trim().padStart(2, "0");
      const normalizedDay = appliedFilters.day.trim().padStart(2, "0");

      if (appliedFilters.year.trim() && rowYear !== appliedFilters.year.trim()) return false;
      if (appliedFilters.month.trim() && rowMonth !== normalizedMonth) return false;
      if (appliedFilters.day.trim() && rowDay !== normalizedDay) return false;
      if (appliedFilters.keyword.trim()) {
        const q = appliedFilters.keyword.trim().toLowerCase();
        const name = row.product_name.toLowerCase();
        const note = (row.note ?? "").toLowerCase();
        if (!name.includes(q) && !note.includes(q)) return false;
      }
      return true;
    });
  }, [rows, appliedFilters]);

  const yearOptions = useMemo(() => {
    const years = Array.from(new Set(rows.map((row) => row.production_date.slice(0, 4)))).sort((a, b) =>
      b.localeCompare(a),
    );
    return years;
  }, [rows]);

  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => String(i + 1)), []);
  const dayOptions = useMemo(() => Array.from({ length: 31 }, (_, i) => String(i + 1)), []);

  const applySearch = () => {
    setAppliedFilters({
      year: yearFilter,
      month: monthFilter,
      day: dayFilter,
      keyword,
    });
  };

  const resetFilters = () => {
    setYearFilter("");
    setMonthFilter("");
    setDayFilter("");
    setKeyword("");
    setAppliedFilters({ year: "", month: "", day: "", keyword: "" });
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">하랑 생산입력</h1>
            <p className="text-sm text-slate-600 mt-1">생산입고 내역 조회 및 등록</p>
          </div>
          <Link
            href="/harang/production-input/new"
            className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400"
          >
            생산입고
          </Link>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            >
              <option value="">년도 전체</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}년
                </option>
              ))}
            </select>
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            >
              <option value="">월 전체</option>
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {month}월
                </option>
              ))}
            </select>
            <select
              value={dayFilter}
              onChange={(e) => setDayFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            >
              <option value="">일 전체</option>
              {dayOptions.map((day) => (
                <option key={day} value={day}>
                  {day}일
                </option>
              ))}
            </select>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="제품명/비고 검색"
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            />
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white"
            >
              초기화
            </button>
            <button
              type="button"
              onClick={applySearch}
              className="px-4 py-2 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-600"
            >
              검색
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left">일자-No.</th>
                  <th className="px-3 py-2 text-left">제품명</th>
                  <th className="px-3 py-2 text-right">수량</th>
                  <th className="px-3 py-2 text-left">등록일시</th>
                  <th className="px-3 py-2 text-left">등록자</th>
                  <th className="px-3 py-2 text-left">내역</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      불러오는 중...
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      내역이 없습니다.
                    </td>
                  </tr>
                )}
                {!loading &&
                  filtered.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 text-slate-900">
                      <td className="px-3 py-2">{row.production_no}</td>
                      <td className="px-3 py-2">{row.product_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Number(row.finished_qty).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                      </td>
                      <td className="px-3 py-2">{new Date(row.created_at).toLocaleString("ko-KR")}</td>
                      <td className="px-3 py-2">{authorLabel(row)}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/harang/production-input/${row.id}`}
                          className="rounded border border-cyan-700/70 px-2 py-1 text-xs text-cyan-300 hover:bg-cyan-950/20"
                        >
                          내역보기
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
