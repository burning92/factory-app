"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { displayHarangProductName } from "@/features/harang/displayProductName";
import {
  formatYmdDot,
  harangProductExpiryFromProductionDate,
} from "@/features/harang/finishedProductExpiry";

type FinishedStockRow = {
  id: string;
  production_no: string;
  production_date: string;
  finished_product_lot_date: string | null;
  product_name: string;
  finished_qty: number;
  created_at: string;
  used_qty: number;
  remain_qty: number;
};

function finishedDisplayName(productName: string): string {
  return `[하랑]${displayHarangProductName(productName)}`;
}

export default function HarangFinishedProductInventoryPage() {
  const [rows, setRows] = useState<FinishedStockRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    const [prodRes, usedRes] = await Promise.all([
      supabase
        .from("harang_production_headers")
        .select("id, production_no, production_date, finished_product_lot_date, product_name, finished_qty, created_at")
        .order("production_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("harang_finished_product_outbound_line_lots")
        .select("production_header_id, quantity_used"),
    ]);
    setLoading(false);
    if (prodRes.error) {
      alert(prodRes.error.message);
      return;
    }
    if (usedRes.error) {
      alert(usedRes.error.message);
      return;
    }
    const usedByHeader = new Map<string, number>();
    for (const u of usedRes.data ?? []) {
      const key = String(u.production_header_id);
      usedByHeader.set(key, (usedByHeader.get(key) ?? 0) + Number(u.quantity_used ?? 0));
    }
    const merged = ((prodRes.data ?? []) as Omit<FinishedStockRow, "used_qty" | "remain_qty">[]).map((r) => {
      const used = usedByHeader.get(r.id) ?? 0;
      const remain = Math.max(0, Number(r.finished_qty) - used);
      return { ...r, used_qty: used, remain_qty: remain };
    });
    setRows(merged.filter((r) => r.remain_qty > 0));
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (!keyword.trim()) return true;
      const q = keyword.trim().toLowerCase();
      return (
        row.production_no.toLowerCase().includes(q) ||
        finishedDisplayName(row.product_name).toLowerCase().includes(q)
      );
    });
  }, [rows, keyword]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">완제품 재고현황</h1>
          <p className="mt-1 text-sm text-slate-600">
            생산입고로 생성된 완제품 LOT/소비기한(생산일 + 364일) 기준 재고를 조회합니다.
          </p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="제품명/생산입고 No. 검색"
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
                  <th className="px-3 py-2 text-left">생산입고 No.</th>
                  <th className="px-3 py-2 text-left">완제품명</th>
                  <th className="px-3 py-2 text-left">제품 시리얼 / LOT</th>
                  <th className="px-3 py-2 text-left">제품 소비기한</th>
                  <th className="px-3 py-2 text-right">잔여재고</th>
                  <th className="px-3 py-2 text-left">생성일시</th>
                  <th className="px-3 py-2 text-left">내역</th>
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
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">완제품 재고 데이터가 없습니다.</td>
                  </tr>
                )}
                {!loading &&
                  filtered.map((row) => {
                    const lotYmd = (row.finished_product_lot_date ?? row.production_date).slice(0, 10);
                    const expiryYmd = harangProductExpiryFromProductionDate(row.production_date);
                    return (
                      <tr key={row.id} className="border-b border-slate-100 text-slate-900">
                        <td className="px-3 py-2 font-mono text-xs">{row.production_no}</td>
                        <td className="px-3 py-2">{finishedDisplayName(row.product_name)}</td>
                        <td className="px-3 py-2 tabular-nums">{formatYmdDot(lotYmd)}</td>
                        <td className="px-3 py-2 tabular-nums">{formatYmdDot(expiryYmd)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {Number(row.remain_qty).toLocaleString("ko-KR")}
                        </td>
                        <td className="px-3 py-2">{new Date(row.created_at).toLocaleString("ko-KR")}</td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/harang/outbound?product=${encodeURIComponent(displayHarangProductName(row.product_name))}`}
                            className="px-2.5 py-1.5 rounded border border-cyan-300 text-cyan-800 bg-cyan-50 text-xs"
                          >
                            출고내역
                          </Link>
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
