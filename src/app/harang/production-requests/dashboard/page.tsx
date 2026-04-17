"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  materialKey,
  sumStockByMaterial,
  type MaterialKey,
} from "@/features/harang/productionRequests";
import type { HarangCategory } from "@/features/harang/types";
import { supabase } from "@/lib/supabase";

type AggRow = {
  key: string;
  material_name: string;
  reserved_total: number;
  stock: number;
  available: number;
  shortage: number;
};

export default function HarangProductionRequestDashboardPage() {
  const [rows, setRows] = useState<AggRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [resvRes, linesRes, headsRes, lotsRes, matRes] = await Promise.all([
      supabase.from("harang_production_request_reservations").select("request_line_id, material_category, material_id, reserved_qty"),
      supabase.from("harang_production_request_lines").select("id, header_id, remaining_qty"),
      supabase.from("harang_production_requests").select("id, status"),
      supabase.from("harang_inventory_lots").select("category, item_id, current_quantity, item_name"),
      supabase
        .from("harang_production_request_line_materials")
        .select("request_line_id, material_category, material_id, material_name, unit"),
    ]);

    if (resvRes.error || linesRes.error || headsRes.error || lotsRes.error) {
      setLoading(false);
      alert(resvRes.error?.message ?? linesRes.error?.message ?? headsRes.error?.message ?? lotsRes.error?.message);
      return;
    }

    const headStatus = new Map<string, string>();
    for (const h of headsRes.data ?? []) {
      headStatus.set(h.id, h.status as string);
    }
    const lineMeta = new Map<string, { header_id: string; remaining_qty: number }>();
    for (const ln of linesRes.data ?? []) {
      lineMeta.set(ln.id, { header_id: ln.header_id as string, remaining_qty: Number(ln.remaining_qty) });
    }

    const stockMap = sumStockByMaterial((lotsRes.data ?? []) as Parameters<typeof sumStockByMaterial>[0]);
    const nameFromMat = new Map<string, string>();
    for (const m of matRes.data ?? []) {
      const k = materialKey(m.material_category as HarangCategory, m.material_id as string);
      if (!nameFromMat.has(k)) nameFromMat.set(k, m.material_name as string);
    }
    for (const l of lotsRes.data ?? []) {
      const k = materialKey(l.category as HarangCategory, l.item_id as string);
      if (!nameFromMat.has(k)) nameFromMat.set(k, String(l.item_name ?? ""));
    }

    const sumByKey = new Map<MaterialKey, number>();
    for (const r of resvRes.data ?? []) {
      const lm = lineMeta.get(r.request_line_id as string);
      if (!lm) continue;
      const st = headStatus.get(lm.header_id);
      if (st === "completed" || st === "cancelled" || lm.remaining_qty <= 0) continue;
      const k = materialKey(r.material_category as HarangCategory, r.material_id as string);
      sumByKey.set(k, (sumByKey.get(k) ?? 0) + Number(r.reserved_qty));
    }

    const out: AggRow[] = [];
    sumByKey.forEach((reserved_total, k) => {
      const stock = stockMap.get(k) ?? 0;
      const available = stock - reserved_total;
      const shortage = Math.max(0, reserved_total - stock);
      out.push({
        key: k,
        material_name: nameFromMat.get(k) ?? k,
        reserved_total,
        stock,
        available,
        shortage,
      });
    });
    out.sort((a, b) => b.shortage - a.shortage || a.material_name.localeCompare(b.material_name, "ko"));
    setRows(out);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">소요·부족 (열린 요청 합산)</h1>
            <p className="text-sm text-slate-600 mt-1">
              완료·취소 제외, 잔여&gt;0 인 요청의 품목 단위 예약만 합산합니다.
            </p>
          </div>
          <Link href="/harang/production-requests" className="text-sm text-cyan-700">
            요청 목록
          </Link>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="text-left px-3 py-2">품목</th>
                  <th className="text-right px-3 py-2">예약합</th>
                  <th className="text-right px-3 py-2">현재고</th>
                  <th className="text-right px-3 py-2">가용</th>
                  <th className="text-right px-3 py-2">부족</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                      불러오는 중…
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                      집계할 예약이 없습니다.
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((r) => (
                    <tr key={r.key} className="border-b border-slate-100">
                      <td className="px-3 py-2 text-slate-900">{r.material_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.reserved_total.toLocaleString("ko-KR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.stock.toLocaleString("ko-KR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.available.toLocaleString("ko-KR")}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-800">
                        {r.shortage > 0 ? r.shortage.toLocaleString("ko-KR") : "-"}
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
