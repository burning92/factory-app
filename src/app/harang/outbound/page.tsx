"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { displayHarangProductName } from "@/features/harang/displayProductName";

type OutboundRow = {
  id: string;
  outbound_date: string;
  outbound_no: string;
  note: string | null;
  created_at: string;
  profiles:
    | { display_name: string | null; login_id: string | null }
    | { display_name: string | null; login_id: string | null }[]
    | null;
  lines?: Array<{ id: string; product_name: string; outbound_qty: number; unit: string }>;
};

function authorLabel(row: OutboundRow): string {
  const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return p?.display_name || p?.login_id || "-";
}

function summarizeProducts(lines: OutboundRow["lines"]): string {
  if (!lines || lines.length === 0) return "-";
  if (lines.length === 1) return `[하랑]${displayHarangProductName(lines[0].product_name)}`;
  return `[하랑]${displayHarangProductName(lines[0].product_name)} 외 ${lines.length - 1}건`;
}

const actionBtn =
  "inline-flex items-center justify-center rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";

export default function HarangOutboundListPage() {
  const searchParams = useSearchParams();
  const initialKeyword = searchParams.get("product") ?? "";
  const [rows, setRows] = useState<OutboundRow[]>([]);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("harang_finished_product_outbound_headers")
      .select(`
        id, outbound_date, outbound_no, note, created_at,
        profiles:created_by(display_name, login_id),
        lines:harang_finished_product_outbound_lines(id, product_name, outbound_qty, unit)
      `)
      .order("outbound_date", { ascending: false })
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }
    setRows((data ?? []) as OutboundRow[]);
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (!keyword.trim()) return true;
      const q = keyword.trim().toLowerCase();
      if (row.outbound_no.toLowerCase().includes(q)) return true;
      return (row.lines ?? []).some((line) =>
        displayHarangProductName(line.product_name).toLowerCase().includes(q),
      );
    });
  }, [rows, keyword]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">하랑 출고관리</h1>
            <p className="mt-1 text-sm text-slate-600">완제품 출고 내역 조회 및 신규 출고 입력</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/harang/outbound/new"
              className="px-4 py-2 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-600"
            >
              출고입력
            </Link>
            <Link
              href="/harang/outbound/clients"
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium bg-white hover:bg-slate-50"
            >
              출고처관리
            </Link>
          </div>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="제품명/출고 No. 검색"
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm md:col-span-2"
            />
            <button
              type="button"
              onClick={() => setKeyword("")}
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm"
            >
              검색 초기화
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left">출고 No.</th>
                  <th className="px-3 py-2 text-left">출고일자</th>
                  <th className="px-3 py-2 text-left">품목</th>
                  <th className="px-3 py-2 text-right">총 출고수량</th>
                  <th className="px-3 py-2 text-left">비고</th>
                  <th className="px-3 py-2 text-left">등록자</th>
                  <th className="px-3 py-2 text-left">작업</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">불러오는 중...</td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">출고내역이 없습니다.</td>
                  </tr>
                )}
                {!loading &&
                  filtered.map((row) => {
                    const total = (row.lines ?? []).reduce((s, line) => s + Number(line.outbound_qty), 0);
                    return (
                      <tr key={row.id} className="border-b border-slate-100 text-slate-900">
                        <td className="px-3 py-2 font-mono text-xs">{row.outbound_no}</td>
                        <td className="px-3 py-2">{row.outbound_date}</td>
                        <td className="px-3 py-2 max-w-[260px] break-words">{summarizeProducts(row.lines)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{total.toLocaleString("ko-KR")}</td>
                        <td className="px-3 py-2 text-slate-600 max-w-[220px] break-words">{row.note ?? "-"}</td>
                        <td className="px-3 py-2">{authorLabel(row)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/harang/outbound/${row.id}`}
                              className={`${actionBtn} border-cyan-200 bg-white text-cyan-800 hover:border-cyan-300 hover:bg-cyan-50/90`}
                            >
                              보기
                            </Link>
                            <Link
                              href={`/harang/outbound/new?id=${row.id}`}
                              className={`${actionBtn} border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50`}
                            >
                              수정
                            </Link>
                            <button
                              type="button"
                              disabled={deletingId === row.id}
                              onClick={async () => {
                                const ok = confirm(`${row.outbound_no} 내역을 삭제할까요?`);
                                if (!ok) return;
                                setDeletingId(row.id);
                                const { error } = await supabase
                                  .from("harang_finished_product_outbound_headers")
                                  .delete()
                                  .eq("id", row.id);
                                setDeletingId(null);
                                if (error) {
                                  alert(error.message);
                                  return;
                                }
                                await loadRows();
                              }}
                              className={`${actionBtn} border-red-200 bg-white text-red-700 hover:border-red-300 hover:bg-red-50`}
                            >
                              {deletingId === row.id ? "삭제 중..." : "삭제"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
