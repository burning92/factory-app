"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { HarangInventoryLot, HarangInventoryTransaction } from "@/features/harang/types";
import { fetchLotStockAsOfMap, isOnOrBeforeAsOf } from "@/features/harang/inventoryAsOf";

function isParbakeDoughName(name: string): boolean {
  return name.replace(/\s/g, "").includes("파베이크도우");
}

function displayUnit(category: string, itemName: string): "EA" | "g" {
  if (category === "packaging_material") return "EA";
  return isParbakeDoughName(itemName) ? "EA" : "g";
}

function formatLotDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  return iso.replaceAll("-", ".");
}

export default function HarangInventoryItemDetailPage() {
  const params = useParams<{ category: string; itemId: string }>();
  const searchParams = useSearchParams();
  const category = params.category;
  const itemId = params.itemId;
  const itemName = searchParams.get("itemName") ?? "-";
  const lotId = searchParams.get("lotId");
  const asOfDate = searchParams.get("asOf")?.slice(0, 10) ?? "";
  const unit = displayUnit(category, itemName);

  const [lots, setLots] = useState<HarangInventoryLot[]>([]);
  const [txs, setTxs] = useState<HarangInventoryTransaction[]>([]);
  const [stockAsOf, setStockAsOf] = useState<Map<string, number> | null>(null);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!category || !itemId) return;
    setLoading(true);
    const cut = asOfDate.slice(0, 10);
    const [lotsRes, txRes, asOfMap] = await Promise.all([
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
      cut ? fetchLotStockAsOfMap(cut) : Promise.resolve(null),
    ]);
    setLoading(false);
    if (lotsRes.error) return alert(lotsRes.error.message);
    if (txRes.error) return alert(txRes.error.message);
    setLots((lotsRes.data ?? []) as HarangInventoryLot[]);
    setTxs((txRes.data ?? []) as HarangInventoryTransaction[]);
    setStockAsOf(asOfMap);
  }, [category, itemId, asOfDate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const visibleLots = useMemo(() => {
    if (!lotId) return lots;
    return lots.filter((lot) => lot.id === lotId);
  }, [lots, lotId]);

  const visibleTxs = useMemo(() => {
    let list = txs;
    if (lotId) list = list.filter((tx) => tx.lot_id === lotId);
    if (asOfDate) list = list.filter((tx) => isOnOrBeforeAsOf(asOfDate, tx.tx_date));
    return list;
  }, [txs, lotId, asOfDate]);

  const lotQty = useCallback(
    (lot: HarangInventoryLot) => {
      if (asOfDate && stockAsOf) return stockAsOf.get(lot.id) ?? 0;
      return Number(lot.current_quantity ?? 0);
    },
    [asOfDate, stockAsOf],
  );

  const lotDateById = useMemo(() => {
    const map = new Map<string, string>();
    for (const lot of lots) {
      map.set(lot.id, lot.lot_date);
    }
    return map;
  }, [lots]);

  const showLotOnTx = !lotId;
  const txColSpan = showLotOnTx ? 8 : 7;

  const summary = useMemo(() => {
    const totalQty = visibleLots.reduce((acc, lot) => acc + lotQty(lot), 0);
    const recentInbound = visibleLots.reduce<string | null>((acc, lot) => {
      if (lot.inbound_date && !isOnOrBeforeAsOf(asOfDate, lot.inbound_date)) return acc;
      if (!acc || lot.inbound_date > acc) return lot.inbound_date;
      return acc;
    }, null);
    const recentUsage = visibleTxs.find((tx) => tx.tx_type === "usage")?.tx_date ?? null;
    return { totalQty, recentInbound, recentUsage };
  }, [visibleLots, visibleTxs, lotQty, asOfDate]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{itemName}</h1>
            <p className="text-sm text-slate-600 mt-1">
              {lotId
                ? "LOT 상세 재고 / 입출고 이력"
                : "품목 상세 재고 / LOT / 입출고 이력 (소진 LOT 포함 · 사용 LOT 표시)"}
              {asOfDate ? ` · 기준일 ${asOfDate.replaceAll("-", ".")} 포함` : ""}
            </p>
          </div>
          <Link
            href={`/harang/inventory${asOfDate ? `?asOf=${encodeURIComponent(asOfDate)}` : ""}`}
            className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm bg-white"
          >
            목록으로
          </Link>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-slate-500 text-xs">{asOfDate ? "기준일 재고" : "총 재고"}</p>
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
                  <th className="px-3 py-2 text-right">{asOfDate ? "기준일 수량" : "현재수량"}</th>
                  <th className="px-3 py-2 text-left">단위</th>
                  <th className="px-3 py-2 text-left">입고경로</th>
                  <th className="px-3 py-2 text-left">참조번호(일자-No.)</th>
                  <th className="px-3 py-2 text-left">비고</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">불러오는 중...</td></tr>}
                {!loading && visibleLots.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">LOT가 없습니다.</td></tr>}
                {!loading &&
                  visibleLots.map((lot) => {
                    const headerInboundNo = (lot as HarangInventoryLot & { headers?: { inbound_no?: string } | null }).headers?.inbound_no;
                    const qty = lotQty(lot);
                    const isDepleted = qty <= 0;
                    return (
                      <tr
                        key={lot.id}
                        className={`border-b border-slate-100 ${isDepleted ? "bg-slate-50 text-slate-500" : "text-slate-900"}`}
                      >
                        <td className="px-3 py-2">
                          {lot.lot_date}
                          {isDepleted && (
                            <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-xs">소진</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{lot.inbound_date}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(lot.initial_quantity).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{qty.toLocaleString()}</td>
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
                  {showLotOnTx && <th className="px-3 py-2 text-left">소비기한 LOT</th>}
                  <th className="px-3 py-2 text-left">참조번호</th>
                  <th className="px-3 py-2 text-right">수량증감</th>
                  <th className="px-3 py-2 text-left">단위</th>
                  <th className="px-3 py-2 text-left">비고</th>
                  <th className="px-3 py-2 text-left">등록일시</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={txColSpan} className="px-3 py-6 text-center text-slate-500">불러오는 중...</td></tr>}
                {!loading && visibleTxs.length === 0 && <tr><td colSpan={txColSpan} className="px-3 py-6 text-center text-slate-500">이력이 없습니다.</td></tr>}
                {!loading &&
                  visibleTxs.map((tx) => (
                    <tr key={tx.id} className="border-b border-slate-100 text-slate-900">
                      <td className="px-3 py-2">{tx.tx_date}</td>
                      <td className="px-3 py-2">{tx.tx_type === "inbound" ? "입고" : tx.tx_type === "usage" ? "사용" : "조정"}</td>
                      {showLotOnTx && (
                        <td className="px-3 py-2 tabular-nums font-medium">
                          {formatLotDate(tx.lot_id ? lotDateById.get(tx.lot_id) : null)}
                        </td>
                      )}
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
