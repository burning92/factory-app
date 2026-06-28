"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type DefectDisposalHeader,
  deleteDefectDisposal,
  fetchDefectDisposalHeaders,
  sumDisposalQuantity,
  summarizeDisposalItemName,
} from "@/features/harang/defectDisposal";

export default function HarangDefectDisposalListPage() {
  const [rows, setRows] = useState<DefectDisposalHeader[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [keyword, setKeyword] = useState("");
  const [applied, setApplied] = useState({ dateFrom: "", dateTo: "", keyword: "" });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDefectDisposalHeaders();
      setRows(data);
    } catch (e) {
      alert(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    const q = applied.keyword.trim().toLowerCase();
    return rows.filter((row) => {
      const d = row.disposal_date.slice(0, 10);
      if (applied.dateFrom && d < applied.dateFrom) return false;
      if (applied.dateTo && d > applied.dateTo) return false;
      if (!q) return true;
      const itemSummary = summarizeDisposalItemName(row.lines).toLowerCase();
      const handler = (row.handler_name ?? "").toLowerCase();
      const no = row.disposal_no.toLowerCase();
      return itemSummary.includes(q) || handler.includes(q) || no.includes(q);
    });
  }, [rows, applied]);

  const applySearch = () => {
    setApplied({ dateFrom, dateTo, keyword });
  };

  const handleDelete = async (row: DefectDisposalHeader) => {
    if (!confirm(`불량처리 ${row.disposal_no} 을(를) 삭제할까요?\n재고 원장의 폐기 내역도 함께 제거됩니다.`)) {
      return;
    }
    setDeletingId(row.id);
    try {
      await deleteDefectDisposal(row.id);
      await loadRows();
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">불량처리조회</h1>
            <p className="mt-1 text-sm text-slate-600">
              폐기·불량 처리 전표를 조회합니다. 저장 시 재고에서 차감됩니다.
            </p>
          </div>
          <Link
            href="/harang/defect-disposal/new"
            className="inline-flex items-center rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-700"
          >
            불량처리입력
          </Link>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600">기간 시작</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">기간 종료</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-slate-600">검색 (품목명·담당자·전표번호)</span>
              <input
                type="search"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="품목명 등"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={applySearch}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
            >
              조회
            </button>
            <button
              type="button"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setKeyword("");
                setApplied({ dateFrom: "", dateTo: "", keyword: "" });
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              초기화
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-slate-900">
              <thead className="bg-slate-100 border-b-2 border-slate-300">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold">No</th>
                  <th className="px-3 py-2.5 text-left font-semibold">일자-No.</th>
                  <th className="px-3 py-2.5 text-left font-semibold">품목명</th>
                  <th className="px-3 py-2.5 text-right font-semibold">수량</th>
                  <th className="px-3 py-2.5 text-left font-semibold">처리방법</th>
                  <th className="px-3 py-2.5 text-left font-semibold">담당자</th>
                  <th className="px-3 py-2.5 text-left font-semibold">등록일시</th>
                  <th className="px-3 py-2.5 text-center font-semibold">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                      불러오는 중…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                      내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  filtered.map((row, index) => (
                    <tr key={row.id} className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-3 py-2.5 tabular-nums">{index + 1}</td>
                      <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                        <Link
                          href={`/harang/defect-disposal/${row.id}`}
                          className="text-cyan-700 hover:underline"
                        >
                          {row.disposal_no}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">{summarizeDisposalItemName(row.lines)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                        {sumDisposalQuantity(row.lines)}
                      </td>
                      <td className="px-3 py-2.5">{row.processing_method}</td>
                      <td className="px-3 py-2.5">{row.handler_name || "-"}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString("ko-KR")}
                      </td>
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        <Link
                          href={`/harang/defect-disposal/${row.id}`}
                          className="text-cyan-700 hover:underline text-xs mr-2"
                        >
                          상세
                        </Link>
                        <button
                          type="button"
                          disabled={deletingId === row.id}
                          onClick={() => void handleDelete(row)}
                          className="text-red-600 hover:underline text-xs disabled:opacity-50"
                        >
                          {deletingId === row.id ? "삭제 중…" : "삭제"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loading && filtered.length > 0 ? (
            <p className="px-4 py-3 text-sm text-slate-600 border-t border-slate-200">
              {filtered.length}건
              {applied.dateFrom || applied.dateTo
                ? ` · ${applied.dateFrom || "…"} ~ ${applied.dateTo || "…"}`
                : ""}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
