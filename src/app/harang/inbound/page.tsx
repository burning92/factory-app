"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { InboundEditModal } from "@/features/harang/InboundEditModal";
import type { HarangInboundHeader } from "@/features/harang/types";

type CategoryLabel = "원재료" | "부자재" | "혼합";

function isParbakeDoughName(name: string): boolean {
  return name.replace(/\s/g, "").includes("파베이크도우");
}

function summarizeCategory(header: HarangInboundHeader): CategoryLabel {
  const categories = Array.from(new Set((header.items ?? []).map((item) => item.category)));
  if (categories.length <= 1) {
    const one = categories[0];
    if (one === "raw_material") return "원재료";
    if (one === "packaging_material") return "부자재";
  }
  return "혼합";
}

function summarizeItemName(header: HarangInboundHeader): string {
  const names = (header.items ?? []).map((item) => item.item_name).filter(Boolean);
  if (names.length === 0) return "-";
  if (names.length === 1) return names[0]!;
  return `${names[0]} 외 ${names.length - 1}건`;
}

function sumQuantity(header: HarangInboundHeader): string {
  const totals = new Map<string, number>();
  for (const item of header.items ?? []) {
    const unit =
      item.category === "packaging_material"
        ? "EA"
        : isParbakeDoughName(String(item.item_name ?? ""))
          ? "EA"
          : "g";
    const prev = totals.get(unit) ?? 0;
    totals.set(unit, prev + Number(item.quantity ?? 0));
  }
  if (totals.size === 0) return "-";
  return Array.from(totals.entries())
    .map(([unit, qty]) => `${qty.toLocaleString("ko-KR")} ${unit}`)
    .join(" / ");
}

function authorLabel(header: HarangInboundHeader): string {
  const profile = Array.isArray(header.profiles) ? header.profiles[0] : header.profiles;
  return profile?.display_name || profile?.login_id || "-";
}

const actionBtn =
  "inline-flex items-center justify-center rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";

export default function HarangInboundListPage() {
  const [rows, setRows] = useState<HarangInboundHeader[]>([]);
  const [yearFilter, setYearFilter] = useState<string>("");
  const [monthFilter, setMonthFilter] = useState<string>("");
  const [dayFilter, setDayFilter] = useState<string>("");
  const [routeFilter, setRouteFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [keyword, setKeyword] = useState<string>("");
  const [appliedFilters, setAppliedFilters] = useState({
    year: "",
    month: "",
    day: "",
    route: "",
    category: "",
    keyword: "",
  });
  const [loading, setLoading] = useState(false);
  const [modalHeaderId, setModalHeaderId] = useState<string | null>(null);
  const [modalReadOnly, setModalReadOnly] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("harang_inbound_headers")
      .select(`
        id,
        inbound_date,
        inbound_no,
        inbound_route,
        note,
        created_by,
        created_at,
        profiles:created_by(display_name, login_id),
        items:harang_inbound_items(
          id, category, item_id, item_code, item_name, lot_date, quantity, unit, note
        )
      `)
      .order("inbound_date", { ascending: false })
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }
    setRows((data ?? []) as HarangInboundHeader[]);
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const [rowYear = "", rowMonth = "", rowDay = ""] = row.inbound_date.split("-");
      const normalizedMonth = appliedFilters.month.trim().padStart(2, "0");
      const normalizedDay = appliedFilters.day.trim().padStart(2, "0");

      if (appliedFilters.year.trim() && rowYear !== appliedFilters.year.trim()) return false;
      if (appliedFilters.month.trim() && rowMonth !== normalizedMonth) return false;
      if (appliedFilters.day.trim() && rowDay !== normalizedDay) return false;
      if (appliedFilters.route && row.inbound_route !== appliedFilters.route) return false;
      const cat = summarizeCategory(row);
      if (appliedFilters.category && cat !== appliedFilters.category) return false;
      if (appliedFilters.keyword.trim()) {
        const q = appliedFilters.keyword.trim().toLowerCase();
        const itemSummary = summarizeItemName(row).toLowerCase();
        const note = (row.note ?? "").toLowerCase();
        if (!itemSummary.includes(q) && !note.includes(q)) return false;
      }
      return true;
    });
  }, [rows, appliedFilters]);

  const yearOptions = useMemo(() => {
    const years = Array.from(new Set(rows.map((row) => row.inbound_date.slice(0, 4)))).sort((a, b) =>
      b.localeCompare(a),
    );
    return years;
  }, [rows]);

  const monthOptions = useMemo(
    () => Array.from({ length: 12 }, (_, i) => String(i + 1)),
    [],
  );

  const dayOptions = useMemo(
    () => Array.from({ length: 31 }, (_, i) => String(i + 1)),
    [],
  );

  const applySearch = () => {
    setAppliedFilters({
      year: yearFilter,
      month: monthFilter,
      day: dayFilter,
      route: routeFilter,
      category: categoryFilter,
      keyword,
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 입고 내역을 삭제하시겠습니까? LOT가 생산 등에 사용된 경우 삭제할 수 없습니다.")) return;
    setDeletingId(id);
    const { error } = await supabase.rpc("delete_harang_inbound", { p_header_id: id });
    setDeletingId(null);
    if (error) return alert(error.message);
    void loadRows();
  };

  const resetFilters = () => {
    setYearFilter("");
    setMonthFilter("");
    setDayFilter("");
    setRouteFilter("");
    setCategoryFilter("");
    setKeyword("");
    setAppliedFilters({
      year: "",
      month: "",
      day: "",
      route: "",
      category: "",
      keyword: "",
    });
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <InboundEditModal
        open={modalHeaderId !== null}
        headerId={modalHeaderId}
        readonly={modalReadOnly}
        onClose={() => setModalHeaderId(null)}
        onSaved={() => {
          setModalHeaderId(null);
          void loadRows();
        }}
      />
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">하랑 입고관리</h1>
            <p className="text-sm text-slate-600 mt-1">입고내역 조회 및 신규 입고 등록</p>
          </div>
          <Link
            href="/harang/inbound/new"
            className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400"
          >
            입고입력
          </Link>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
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
            <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)} className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm">
              <option value="">입고경로 전체</option>
              <option value="AF발송">AF발송</option>
              <option value="하랑직입고">하랑직입고</option>
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm">
              <option value="">분류 전체</option>
              <option value="원재료">원재료</option>
              <option value="부자재">부자재</option>
              <option value="혼합">혼합</option>
            </select>
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="품목명/비고 검색" className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm" />
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
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left">일자-No.</th>
                  <th className="px-3 py-2 text-left">분류</th>
                  <th className="px-3 py-2 text-left">품목명(요약)</th>
                  <th className="px-3 py-2 text-left">입고경로</th>
                  <th className="px-3 py-2 text-left">합계수량</th>
                  <th className="px-3 py-2 text-left">비고</th>
                  <th className="px-3 py-2 text-left">등록일시</th>
                  <th className="px-3 py-2 text-left">등록자</th>
                  <th className="px-3 py-2 text-left">관리</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">불러오는 중...</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-500">입고내역이 없습니다.</td></tr>
                )}
                {!loading &&
                  filtered.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 text-slate-900">
                      <td className="px-3 py-2">{row.inbound_no}</td>
                      <td className="px-3 py-2">{summarizeCategory(row)}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => {
                            setModalReadOnly(true);
                            setModalHeaderId(row.id);
                          }}
                          className="text-left font-medium text-cyan-700 hover:text-cyan-900 hover:underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-sm"
                          title="입고 내역 보기"
                        >
                          {summarizeItemName(row)}
                        </button>
                      </td>
                      <td className="px-3 py-2">{row.inbound_route}</td>
                      <td className="px-3 py-2">{sumQuantity(row)}</td>
                      <td className="px-3 py-2 text-slate-600">{row.note ?? "-"}</td>
                      <td className="px-3 py-2">{new Date(row.created_at).toLocaleString("ko-KR")}</td>
                      <td className="px-3 py-2">{authorLabel(row)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setModalReadOnly(true);
                            setModalHeaderId(row.id);
                          }}
                          className={`${actionBtn} mr-2 border-cyan-200 bg-white text-cyan-800 hover:border-cyan-300 hover:bg-cyan-50/90`}
                        >
                          보기
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setModalReadOnly(false);
                            setModalHeaderId(row.id);
                          }}
                          className={`${actionBtn} mr-2 border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50`}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === row.id}
                          onClick={() => void handleDelete(row.id)}
                          className={`${actionBtn} border-red-200 bg-white text-red-700 hover:border-red-300 hover:bg-red-50`}
                        >
                          {deletingId === row.id ? "삭제 중..." : "삭제"}
                        </button>
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
