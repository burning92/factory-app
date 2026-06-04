"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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

type ProductStockGroup = {
  product_name: string;
  display_name: string;
  total_remain_qty: number;
  lot_count: number;
  lots: FinishedStockRow[];
};

function finishedDisplayName(productName: string): string {
  return `[하랑]${displayHarangProductName(productName)}`;
}

function groupRowsByProduct(rows: FinishedStockRow[]): ProductStockGroup[] {
  const byProduct = new Map<string, FinishedStockRow[]>();
  for (const row of rows) {
    const list = byProduct.get(row.product_name) ?? [];
    list.push(row);
    byProduct.set(row.product_name, list);
  }
  return Array.from(byProduct.entries())
    .map(([product_name, lots]) => {
      const sortedLots = [...lots].sort((a, b) => {
        const lotA = (a.finished_product_lot_date ?? a.production_date).slice(0, 10);
        const lotB = (b.finished_product_lot_date ?? b.production_date).slice(0, 10);
        return lotA.localeCompare(lotB) || b.created_at.localeCompare(a.created_at);
      });
      return {
        product_name,
        display_name: finishedDisplayName(product_name),
        total_remain_qty: sortedLots.reduce((sum, r) => sum + r.remain_qty, 0),
        lot_count: sortedLots.length,
        lots: sortedLots,
      };
    })
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "ko-KR"));
}

export default function HarangFinishedProductInventoryPage() {
  const [rows, setRows] = useState<FinishedStockRow[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

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

  const productGroups = useMemo(() => groupRowsByProduct(filtered), [filtered]);

  const toggleProduct = (productName: string) => {
    setExpandedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(productName)) next.delete(productName);
      else next.add(productName);
      return next;
    });
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">완제품 재고현황</h1>
          <p className="mt-1 text-sm text-slate-600">
            잔량이 있는 제품·LOT만 표시합니다. 소진된 생산입고는 출고내역에서 추적할 수 있습니다.
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
                  <th className="px-3 py-2 w-8" aria-label="펼치기" />
                  <th className="px-3 py-2 text-left">완제품명</th>
                  <th className="px-3 py-2 text-right">LOT 수</th>
                  <th className="px-3 py-2 text-right">총 잔여재고</th>
                  <th className="px-3 py-2 text-left">내역</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500">불러오는 중...</td>
                  </tr>
                )}
                {!loading && productGroups.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500">완제품 재고 데이터가 없습니다.</td>
                  </tr>
                )}
                {!loading &&
                  productGroups.map((group) => {
                    const isExpanded = expandedProducts.has(group.product_name);
                    return (
                      <Fragment key={group.product_name}>
                        <tr
                          className="border-b border-slate-200 text-slate-900 bg-slate-50/80 hover:bg-slate-100/80 cursor-pointer"
                          onClick={() => toggleProduct(group.product_name)}
                        >
                          <td className="px-3 py-2.5 text-slate-500">
                            <span
                              className={`inline-block transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              aria-hidden
                            >
                              ▶
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-medium">{group.display_name}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                            {group.lot_count.toLocaleString("ko-KR")}개
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-cyan-800">
                            {group.total_remain_qty.toLocaleString("ko-KR")}
                          </td>
                          <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <Link
                              href={`/harang/outbound?product=${encodeURIComponent(displayHarangProductName(group.product_name))}`}
                              className="px-2.5 py-1.5 rounded border border-cyan-300 text-cyan-800 bg-cyan-50 text-xs"
                            >
                              출고내역
                            </Link>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} className="px-0 py-0 border-b border-slate-200 bg-white">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-slate-100 text-slate-500 text-xs">
                                    <th className="px-3 py-2 pl-10 text-left font-normal">생산입고 No.</th>
                                    <th className="px-3 py-2 text-left font-normal">제품 시리얼 / LOT</th>
                                    <th className="px-3 py-2 text-left font-normal">제품 소비기한</th>
                                    <th className="px-3 py-2 text-right font-normal">잔여재고</th>
                                    <th className="px-3 py-2 text-left font-normal">생성일시</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.lots.map((row) => {
                                    const lotYmd = (row.finished_product_lot_date ?? row.production_date).slice(0, 10);
                                    const expiryYmd = harangProductExpiryFromProductionDate(row.production_date);
                                    return (
                                      <tr key={row.id} className="border-b border-slate-50 text-slate-800 last:border-b-0">
                                        <td className="px-3 py-2 pl-10 font-mono text-xs">{row.production_no}</td>
                                        <td className="px-3 py-2 tabular-nums">{formatYmdDot(lotYmd)}</td>
                                        <td className="px-3 py-2 tabular-nums">{formatYmdDot(expiryYmd)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                                          {Number(row.remain_qty).toLocaleString("ko-KR")}
                                        </td>
                                        <td className="px-3 py-2 text-slate-600">
                                          {new Date(row.created_at).toLocaleString("ko-KR")}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
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
