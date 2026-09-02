"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchAdditionalOutboundHistory,
  formatAdditionalOutboundWeight,
  type AdditionalOutboundHistoryRow,
} from "@/features/production/outbound/additionalOutboundHistory";
import { formatDateKorea, formatTimeKorea } from "@/lib/formatDateTimeKorea";

export default function AdditionalOutboundHistoryPage() {
  const { viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";

  const [rows, setRows] = useState<AdditionalOutboundHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdditionalOutboundHistory(orgCode);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "내역을 불러오지 못했습니다.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [orgCode]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="py-6 px-4 sm:px-6 lg:px-8 pb-28 md:pb-10">
      <div className="max-w-5xl mx-auto">
        <div className="mb-5">
          <Link
            href="/materials"
            className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft className="w-4 h-4" /> 원부자재
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-100">추가 출고 내역</h1>
          <p className="mt-1 text-sm text-slate-400">
            생산 중 추가로 올린 원료 입력 기록입니다.
          </p>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500 py-10 text-center">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-600 bg-space-800/50 p-8 text-center">
            <p className="text-sm text-slate-300">저장된 추가 출고 내역이 없습니다.</p>
            <Link
              href="/production/additional-outbound"
              className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-xl bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400"
            >
              추가 출고 입력
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-space-800/80">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-xs text-slate-400">
                  <th className="px-3 py-3 font-medium">올린날짜</th>
                  <th className="px-3 py-3 font-medium">올린시간</th>
                  <th className="px-3 py-3 font-medium">원료명</th>
                  <th className="px-3 py-3 font-medium">중량</th>
                  <th className="px-3 py-3 font-medium">LOT(소비기한)</th>
                  <th className="px-3 py-3 font-medium">올린사람</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-slate-700/70 last:border-0">
                    <td className="px-3 py-3 tabular-nums text-slate-200 whitespace-nowrap">
                      {formatDateKorea(row.created_at)}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-slate-300 whitespace-nowrap">
                      {formatTimeKorea(row.created_at)}
                    </td>
                    <td className="px-3 py-3 text-slate-100 font-medium">{row.material_name}</td>
                    <td className="px-3 py-3 tabular-nums text-cyan-200 whitespace-nowrap">
                      {formatAdditionalOutboundWeight(row.box_qty, row.bag_qty, row.g_qty)}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-slate-300 whitespace-nowrap">
                      {row.lot_expiry || "—"}
                    </td>
                    <td className="px-3 py-3 text-slate-300 whitespace-nowrap">
                      {row.author_name?.trim() || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
