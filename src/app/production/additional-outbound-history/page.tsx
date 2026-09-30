"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  cancelAdditionalOutboundHistory,
  fetchAdditionalOutboundHistory,
  formatAdditionalOutboundWeight,
  type AdditionalOutboundHistoryRow,
} from "@/features/production/outbound/additionalOutboundHistory";
import {
  listProductionOutboundDates,
  pickProductionOutboundDate,
} from "@/features/production/outbound/additionalOutboundMaterials";
import { formatDateKorea, formatDateTimeKorea, formatTimeKorea } from "@/lib/formatDateTimeKorea";
import { isManagerOrAbove } from "@/lib/roles";
import { useMasterStore } from "@/store/useMasterStore";

function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AdditionalOutboundHistoryPage() {
  const { viewOrganizationCode, profile } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const canCancel = isManagerOrAbove(profile?.role);

  const { fetchProductionLogs, productionLogs, productionLogsLoading } = useMasterStore();

  const [filterDate, setFilterDate] = useState("");
  const [rows, setRows] = useState<AdditionalOutboundHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    fetchProductionLogs();
  }, [fetchProductionLogs]);

  const outboundDates = useMemo(
    () => listProductionOutboundDates(productionLogs),
    [productionLogs]
  );

  useEffect(() => {
    if (productionLogsLoading) return;
    setFilterDate((prev) =>
      pickProductionOutboundDate(outboundDates, prev, todayLocalIso())
    );
  }, [productionLogsLoading, outboundDates]);

  const load = useCallback(async () => {
    if (!filterDate) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdditionalOutboundHistory(orgCode, {
        productionDate: filterDate,
      });
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "내역을 불러오지 못했습니다.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [orgCode, filterDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancelledCount = useMemo(() => rows.filter((r) => r.cancelled_at).length, [rows]);
  const visibleRows = useMemo(
    () => (showCancelled ? rows : rows.filter((r) => !r.cancelled_at)),
    [rows, showCancelled]
  );

  const handleCancel = useCallback(
    async (row: AdditionalOutboundHistoryRow) => {
      if (
        !window.confirm(
          `${row.material_name} ${formatAdditionalOutboundWeight(row.box_qty, row.bag_qty, row.g_qty)} 내역을 삭제 처리할까요?\n생산 출고 현황의 출고 수량은 바뀌지 않습니다.`
        )
      ) {
        return;
      }
      setCancellingId(row.id);
      try {
        await cancelAdditionalOutboundHistory([row.id]);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "삭제 처리에 실패했습니다.");
      } finally {
        setCancellingId(null);
      }
    },
    [load]
  );

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
            생산 중 추가로 올린 원료 입력 기록입니다. 생산 출고 현황에서 해당 LOT을 지우면 여기서도 삭제됨으로 처리됩니다.
          </p>
        </div>

        <section className="mb-5 rounded-2xl border border-slate-700 bg-space-800/80 p-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <label className="block text-xs font-medium text-slate-400 mb-1.5">출고 날짜</label>
            {productionLogsLoading ? (
              <p className="text-sm text-slate-500 py-2">출고 날짜 불러오는 중…</p>
            ) : outboundDates.length === 0 ? (
              <p className="text-sm text-slate-400 py-2">
                생산 출고가 잡힌 날짜가 없습니다. 1차 출고 입력 후 조회할 수 있습니다.
              </p>
            ) : (
              <select
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full max-w-xs px-3 py-2.5 rounded-xl bg-space-900 border border-slate-600 text-slate-100"
              >
                {outboundDates.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}
          </div>
          {cancelledCount > 0 ? (
            <label className="inline-flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={showCancelled}
                onChange={(e) => setShowCancelled(e.target.checked)}
                className="rounded border-slate-600 bg-space-900"
              />
              삭제된 내역 보기 ({cancelledCount})
            </label>
          ) : null}
        </section>

        {error ? (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {productionLogsLoading || loading ? (
          <p className="text-sm text-slate-500 py-10 text-center">불러오는 중…</p>
        ) : outboundDates.length === 0 ? null : visibleRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-600 bg-space-800/50 p-8 text-center">
            <p className="text-sm text-slate-300">
              {filterDate}에 저장된 추가 출고 내역이 없습니다.
            </p>
            <Link
              href={`/production/additional-outbound?date=${encodeURIComponent(filterDate)}`}
              className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-xl bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400"
            >
              추가 출고 입력
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-space-800/80">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-xs text-slate-400">
                  <th className="px-3 py-3 font-medium">올린날짜</th>
                  <th className="px-3 py-3 font-medium">올린시간</th>
                  <th className="px-3 py-3 font-medium">원료명</th>
                  <th className="px-3 py-3 font-medium">중량</th>
                  <th className="px-3 py-3 font-medium">LOT(소비기한)</th>
                  <th className="px-3 py-3 font-medium">올린사람</th>
                  {canCancel ? <th className="px-3 py-3 font-medium" /> : null}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const cancelled = Boolean(row.cancelled_at);
                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-slate-700/70 last:border-0 ${cancelled ? "opacity-50" : ""}`}
                    >
                      <td className="px-3 py-3 tabular-nums text-slate-200 whitespace-nowrap">
                        {formatDateKorea(row.created_at)}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-slate-300 whitespace-nowrap">
                        {formatTimeKorea(row.created_at)}
                      </td>
                      <td className="px-3 py-3 text-slate-100 font-medium">
                        <span className={cancelled ? "line-through" : ""}>{row.material_name}</span>
                        {cancelled ? (
                          <span className="mt-0.5 block text-xs font-normal text-red-300">
                            삭제됨 · {formatDateTimeKorea(row.cancelled_at)}
                            {row.cancelled_by_name ? ` · ${row.cancelled_by_name}` : ""}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-cyan-200 whitespace-nowrap">
                        <span className={cancelled ? "line-through" : ""}>
                          {formatAdditionalOutboundWeight(row.box_qty, row.bag_qty, row.g_qty)}
                        </span>
                      </td>
                      <td className="px-3 py-3 tabular-nums text-slate-300 whitespace-nowrap">
                        {row.lot_expiry || "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-300 whitespace-nowrap">
                        {row.author_name?.trim() || "—"}
                      </td>
                      {canCancel ? (
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          {!cancelled ? (
                            <button
                              type="button"
                              onClick={() => void handleCancel(row)}
                              disabled={cancellingId === row.id}
                              className="text-xs text-red-300 hover:text-red-200 underline disabled:opacity-50"
                            >
                              {cancellingId === row.id ? "처리 중…" : "삭제 처리"}
                            </button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
