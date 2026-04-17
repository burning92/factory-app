"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { HarangCategory, HarangInventoryLot, HarangInventoryTransaction } from "@/features/harang/types";

type StockRow = {
  lot_id: string;
  category: HarangCategory;
  item_id: string;
  item_code: string;
  item_name: string;
  unit: string;
  current_qty: number;
  inbound_date: string | null;
  recent_usage_date: string | null;
};

type InventoryViewCategory = "parbake" | HarangCategory;

function viewCategoryOf(row: Pick<StockRow, "category" | "item_name">): InventoryViewCategory {
  if (row.category === "raw_material" && isParbakeDoughName(row.item_name)) return "parbake";
  return row.category;
}

function categoryLabel(category: InventoryViewCategory): string {
  if (category === "parbake") return "파베이크";
  return category === "raw_material" ? "원재료" : "부자재";
}

function isParbakeDoughName(name: string): boolean {
  return name.replace(/\s/g, "").includes("파베이크도우");
}

function displayUnit(category: HarangCategory, itemName: string): "EA" | "g" {
  if (category === "packaging_material") return "EA";
  return isParbakeDoughName(itemName) ? "EA" : "g";
}

export default function HarangInventoryPage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [category, setCategory] = useState<"" | InventoryViewCategory>("");
  const [keyword, setKeyword] = useState("");
  const [hasStock, setHasStock] = useState("");
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [lotsRes, usageRes] = await Promise.all([
      supabase
        .from("harang_inventory_lots")
        .select(`
          id, category, item_id, item_code, item_name, lot_date, inbound_date, inbound_route,
          source_header_id, source_item_id, initial_quantity, current_quantity, unit, note, created_at
        `),
      supabase
        .from("harang_inventory_transactions")
        .select("id, category, item_id, item_code, item_name, lot_id, tx_date, tx_type, reference_no, quantity_delta, unit, note, created_at")
        .eq("tx_type", "usage")
        .order("tx_date", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);
    setLoading(false);
    if (lotsRes.error) return alert(lotsRes.error.message);
    if (usageRes.error) return alert(usageRes.error.message);

    const lots = (lotsRes.data ?? []) as HarangInventoryLot[];
    const usageTx = (usageRes.data ?? []) as HarangInventoryTransaction[];
    const usageMap = new Map<string, string>();
    for (const tx of usageTx) {
      const key = String(tx.lot_id ?? "");
      if (!key) continue;
      if (!usageMap.has(key)) usageMap.set(key, tx.tx_date);
    }

    const mappedRows = lots.map((lot) => {
      const shownUnit = displayUnit(lot.category, lot.item_name);
      return {
        lot_id: lot.id,
        category: lot.category,
        item_id: lot.item_id,
        item_code: lot.item_code,
        item_name: lot.item_name,
        unit: shownUnit,
        current_qty: Number(lot.current_quantity ?? 0),
        inbound_date: lot.inbound_date ?? null,
        recent_usage_date: usageMap.get(lot.id) ?? null,
      } as StockRow;
    });
    setRows(mappedRows);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (category && viewCategoryOf(row) !== category) return false;
      if (hasStock === "yes" && row.current_qty <= 0) return false;
      if (hasStock === "no" && row.current_qty > 0) return false;
      if (keyword.trim()) {
        const q = keyword.trim().toLowerCase();
        if (!row.item_name.toLowerCase().includes(q) && !row.item_code.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, category, hasStock, keyword]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">하랑 재고현황</h1>
          <p className="mt-1 text-sm text-slate-600">LOT별 현재고와 이력을 조회합니다.</p>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select
              value={category}
              onChange={(e) => setCategory((e.target.value || "") as "" | InventoryViewCategory)}
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm"
            >
              <option value="">분류 전체</option>
              <option value="parbake">파베이크</option>
              <option value="raw_material">원재료</option>
              <option value="packaging_material">부자재</option>
            </select>
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="품목명/코드 검색" className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm" />
            <select value={hasStock} onChange={(e) => setHasStock(e.target.value)} className="px-3 py-2 rounded-lg bg-white border border-slate-300 text-slate-900 text-sm">
              <option value="">재고 상태 전체</option>
              <option value="yes">재고 있음</option>
              <option value="no">재고 없음</option>
            </select>
            <button type="button" onClick={() => { setCategory(""); setKeyword(""); setHasStock(""); }} className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm">필터 초기화</button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left">분류</th>
                  <th className="px-3 py-2 text-left">품목명</th>
                  <th className="px-3 py-2 text-right">재고수량</th>
                  <th className="px-3 py-2 text-left">최근 입고일</th>
                  <th className="px-3 py-2 text-left">최근 사용일</th>
                  <th className="px-3 py-2 text-left">상세보기</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">불러오는 중...</td></tr>}
                {!loading && filtered.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">재고 데이터가 없습니다.</td></tr>}
                {!loading &&
                  filtered.map((row) => (
                    <tr key={row.lot_id} className="border-b border-slate-100 text-slate-900">
                      <td className="px-3 py-2">{categoryLabel(viewCategoryOf(row))}</td>
                      <td className="px-3 py-2">{row.item_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.current_qty.toLocaleString("ko-KR")} {row.unit}
                      </td>
                      <td className="px-3 py-2">{row.inbound_date ?? "-"}</td>
                      <td className="px-3 py-2">{row.recent_usage_date ?? "-"}</td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/harang/inventory/${row.category}/${row.item_id}?itemName=${encodeURIComponent(row.item_name)}&lotId=${encodeURIComponent(row.lot_id)}`}
                          className="px-3 py-1.5 rounded border border-cyan-700/70 text-cyan-300 text-xs"
                        >
                          보기
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
