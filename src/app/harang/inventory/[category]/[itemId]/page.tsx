"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { HarangInventoryLot, HarangInventoryTransaction } from "@/features/harang/types";

export default function HarangInventoryItemDetailPage() {
  const params = useParams<{ category: string; itemId: string }>();
  const searchParams = useSearchParams();
  const category = params.category;
  const itemId = params.itemId;
  const itemName = searchParams.get("itemName") ?? "-";
  const unit = searchParams.get("unit") ?? "";

  const [lots, setLots] = useState<HarangInventoryLot[]>([]);
  const [txs, setTxs] = useState<HarangInventoryTransaction[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!category || !itemId) return;
    setLoading(true);
    const [lotsRes, txRes] = await Promise.all([
      supabase
        .from("harang_inventory_lots")
        .select(`
          id, category, item_id, item_code, item_name, lot_date, inbound_date, inbound_route,
          source_header_id, source_item_id, initial_quantity, current_quantity, unit, note, created_at,
          headers:source_header_id(inbound_no)
        `)
        .eq("category", category)
        .eq("item_id", itemId)
        .order("lot_date", { ascending: true }),
      supabase
        .from("harang_inventory_transactions")
        .select("id, category, item_id, item_code, item_name, lot_id, tx_date, tx_type, reference_no, quantity_delta, unit, note, created_at")
        .eq("category", category)
        .eq("item_id", itemId)
        .order("tx_date", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);
    setLoading(false);
    if (lotsRes.error) return alert(lotsRes.error.message);
    if (txRes.error) return alert(txRes.error.message);
    setLots((lotsRes.data ?? []) as HarangInventoryLot[]);
    setTxs((txRes.data ?? []) as HarangInventoryTransaction[]);
  }, [category, itemId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const summary = useMemo(() => {
    const totalQty = lots.reduce((acc, lot) => acc + Number(lot.current_quantity ?? 0), 0);
    const recentInbound = lots.reduce<string | null>((acc, lot) => {
      if (!acc || lot.inbound_date > acc) return lot.inbound_date;
      return acc;
    }, null);
    const recentUsage = txs.find((tx) => tx.tx_type === "usage")?.tx_date ?? null;
    return { totalQty, recentInbound, recentUsage };
  }, [lots, txs]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{itemName}</h1>
            <p className="text-sm text-slate-600 mt-1">품목 상세 재고 / LOT / 입출고 이력</p>
          </div>
          <Link href="/harang/inventory" className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white">
            목록으로
          </Link>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-slate-500 text-xs">총 재고</p>
              <p className="mt-1 text-slate-900 text-lg font-semibold">{summary.totalQty.toLocaleString()} {unit}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-slate-500 text-xs">최근 입고일</p>
              <p className="mt-1 text-slate-900">{summary.recentInbound ?? "-"}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-slate-500 text-xs">최근 사용일</p>
              <p className="mt-1 text-slate-900">{summary.recentUsage ?? "-"}</p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">LOT별 잔량 목록</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left">LOT(제조일자/소비기한)</th>
                  <th className="px-3 py-2 text-left">입고일자</th>
                  <th className="px-3 py-2 text-right">최초수량</th>
                  <th className="px-3 py-2 text-right">현재수량</th>
                  <th className="px-3 py-2 text-left">단위</th>
                  <th className="px-3 py-2 text-left">입고경로</th>
                  <th className="px-3 py-2 text-left">참조번호(일자-No.)</th>
                  <th className="px-3 py-2 text-left">비고</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">불러오는 중...</td></tr>}
                {!loading && lots.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">LOT가 없습니다.</td></tr>}
                {!loading &&
                  lots.map((lot) => {
                    const headerInboundNo = (lot as HarangInventoryLot & { headers?: { inbound_no?: string } | null }).headers?.inbound_no;
                    return (
                      <tr key={lot.id} className="border-b border-slate-100 text-slate-900">
                        <td className="px-3 py-2">{lot.lot_date}</td>
                        <td className="px-3 py-2">{lot.inbound_date}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(lot.initial_quantity).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(lot.current_quantity).toLocaleString()}</td>
                        <td className="px-3 py-2">{lot.unit}</td>
                        <td className="px-3 py-2">{lot.inbound_route}</td>
                        <td className="px-3 py-2">{headerInboundNo ?? "-"}</td>
                        <td className="px-3 py-2 text-slate-600">{lot.note ?? "-"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">입출고 이력</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left">일자</th>
                  <th className="px-3 py-2 text-left">유형</th>
                  <th className="px-3 py-2 text-left">참조번호</th>
                  <th className="px-3 py-2 text-right">수량증감</th>
                  <th className="px-3 py-2 text-left">단위</th>
                  <th className="px-3 py-2 text-left">비고</th>
                  <th className="px-3 py-2 text-left">등록일시</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">불러오는 중...</td></tr>}
                {!loading && txs.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">이력이 없습니다.</td></tr>}
                {!loading &&
                  txs.map((tx) => (
                    <tr key={tx.id} className="border-b border-slate-100 text-slate-900">
                      <td className="px-3 py-2">{tx.tx_date}</td>
                      <td className="px-3 py-2">{tx.tx_type === "inbound" ? "입고" : tx.tx_type === "usage" ? "사용" : "조정"}</td>
                      <td className="px-3 py-2">{tx.reference_no ?? "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(tx.quantity_delta).toLocaleString()}</td>
                      <td className="px-3 py-2">{tx.unit}</td>
                      <td className="px-3 py-2 text-slate-600">{tx.note ?? "-"}</td>
                      <td className="px-3 py-2">{new Date(tx.created_at).toLocaleString("ko-KR")}</td>
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
