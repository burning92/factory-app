"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { Pencil, Trash2 } from "lucide-react";

type LogStatus = "draft" | "submitted" | "approved" | "rejected";
type LogRow = {
  id: string;
  received_at: string;
  author_name: string | null;
  status: LogStatus;
  approved_at: string | null;
  approved_by_name: string | null;
  reject_reason: string | null;
};
type ItemSummary = {
  names: string[];
  totalWeightG: number;
};

function statusLabel(s: LogStatus): string {
  if (s === "draft") return "작성 중";
  if (s === "submitted") return "제출 완료";
  if (s === "approved") return "승인 완료";
  return "반려";
}

function statusBadgeClass(s: LogStatus): string {
  if (s === "approved") return "bg-emerald-900/50 text-emerald-300";
  if (s === "submitted") return "bg-cyan-900/50 text-cyan-300 border border-cyan-600/50";
  if (s === "rejected") return "bg-amber-900/50 text-amber-300";
  return "bg-slate-700/80 text-slate-400";
}

function formatReceivedAt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatKgDisplay(weightG: number): string {
  const kg = weightG / 1000;
  if (!Number.isFinite(kg)) return "0";
  if (Math.abs(kg - Math.round(kg)) < 1e-9) return String(Math.round(kg));
  return kg.toFixed(1);
}

export default function DailyMaterialReceivingInspectionListPage() {
  const { viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [itemSummaryByLogId, setItemSummaryByLogId] = useState<Record<string, ItemSummary>>({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("daily_material_receiving_inspection_logs")
      .select("id, received_at, author_name, status, approved_at, approved_by_name, reject_reason")
      .eq("organization_code", orgCode)
      .order("received_at", { ascending: false })
      .limit(100);
    if (error) {
      setToast({ message: error.message, error: true });
      setLogs([]);
      setItemSummaryByLogId({});
    } else {
      const rows = (data ?? []) as LogRow[];
      setLogs(rows);
      if (rows.length === 0) {
        setItemSummaryByLogId({});
        setLoading(false);
        return;
      }
      const logIds = rows.map((row) => row.id);
      const { data: itemsData, error: itemsErr } = await supabase
        .from("daily_material_receiving_inspection_log_items")
        .select("log_id, item_name, total_weight_g, line_index")
        .in("log_id", logIds)
        .order("line_index", { ascending: true });
      if (itemsErr) {
        setItemSummaryByLogId({});
      } else {
        const summaryMap: Record<string, ItemSummary> = {};
        for (const item of itemsData ?? []) {
          const logId = String((item as { log_id: string }).log_id);
          const itemName = String((item as { item_name?: string | null }).item_name ?? "").trim();
          const weight = Number((item as { total_weight_g?: number | null }).total_weight_g ?? 0);
          if (!summaryMap[logId]) summaryMap[logId] = { names: [], totalWeightG: 0 };
          if (itemName) summaryMap[logId].names.push(itemName);
          if (Number.isFinite(weight) && weight > 0) summaryMap[logId].totalWeightG += weight;
        }
        setItemSummaryByLogId(summaryMap);
      }
    }
    setLoading(false);
  }, [orgCode]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const getRowHref = (log: LogRow) => {
    if (log.status === "draft" || log.status === "rejected") return `/materials/material-receiving-inspection/${log.id}/edit`;
    return `/materials/material-receiving-inspection/${log.id}`;
  };

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((log) => {
      const dateText = formatReceivedAt(log.received_at).toLowerCase();
      const author = (log.author_name ?? "").toLowerCase();
      const summary = itemSummaryByLogId[log.id];
      const names = (summary?.names ?? []).join(" ").toLowerCase();
      return dateText.includes(q) || author.includes(q) || names.includes(q);
    });
  }, [logs, itemSummaryByLogId, searchQuery]);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-2xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/materials" className="text-slate-400 hover:text-slate-200 text-sm">
          원부자재
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">원료 입고 검수일지</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-lg font-semibold text-slate-100">원료 입고 검수일지 — 목록</h1>
        <Link
          href="/materials/material-receiving-inspection/new"
          className="shrink-0 inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm"
        >
          새 일지 작성
        </Link>
      </div>
      <div className="mb-4">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="원료명/작성자/날짜 검색"
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 text-sm"
        />
      </div>
      {toast && (
        <div
          className={`mb-4 px-4 py-2 rounded-lg text-sm ${toast.error ? "bg-red-900/30 text-red-200" : "bg-cyan-900/30 text-cyan-200"}`}
        >
          {toast.message}
        </div>
      )}
      {loading ? (
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      ) : logs.length === 0 ? (
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-8 text-center">
          <p className="text-slate-500 text-sm mb-4">저장된 일지가 없습니다.</p>
          <Link
            href="/materials/material-receiving-inspection/new"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium"
          >
            새 일지 작성
          </Link>
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-8 text-center">
          <p className="text-slate-400 text-sm">검색 결과가 없습니다.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filteredLogs.map((log) => (
            <li key={log.id}>
              <div
                className={`flex items-stretch gap-1 rounded-xl border transition-colors ${
                  log.status === "submitted"
                    ? "border-cyan-600/50 bg-slate-800/80"
                    : "border-slate-700/60 bg-slate-800/50"
                }`}
              >
                <Link href={getRowHref(log)} className="flex-1 min-w-0 px-4 py-3 hover:bg-slate-700/40 rounded-l-xl">
                  {(() => {
                    const summary = itemSummaryByLogId[log.id];
                    const names = summary?.names ?? [];
                    const preview = names.slice(0, 3).join(", ");
                    const extra = Math.max(0, names.length - 3);
                    const totalKg = formatKgDisplay(summary?.totalWeightG ?? 0);
                    return (
                      <p className="text-[15px] font-medium text-slate-100 truncate">
                        {preview || "품목 없음"}
                        {extra > 0 ? ` 외 ${extra}건` : ""} · 총 {totalKg}kg
                      </p>
                    );
                  })()}
                  <div className="flex flex-wrap items-center gap-2 gap-y-1">
                    <span className="text-slate-400 text-sm">{formatReceivedAt(log.received_at)}</span>
                    {log.author_name && <span className="text-slate-500 text-sm">{log.author_name}</span>}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusBadgeClass(log.status)}`}>
                      {statusLabel(log.status)}
                    </span>
                  </div>
                </Link>
                <div className="flex items-center pr-2 gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.location.href = `/materials/material-receiving-inspection/${log.id}/edit`;
                    }}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-700/60 bg-slate-900/30 hover:bg-slate-700/40 text-slate-200"
                    title="수정"
                    aria-label="수정"
                  >
                    <Pencil className="w-4 h-4" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!window.confirm("이 일지를 삭제할까요?")) return;
                      setDeletingId(log.id);
                      const { error } = await supabase
                        .from("daily_material_receiving_inspection_logs")
                        .delete()
                        .eq("id", log.id);
                      setDeletingId(null);
                      if (error) setToast({ message: error.message, error: true });
                      else fetchLogs();
                    }}
                    disabled={deletingId === log.id}
                    className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-red-700/40 bg-red-900/10 hover:bg-red-900/25 text-red-200 disabled:opacity-50"
                    title="삭제"
                    aria-label="삭제"
                  >
                    <Trash2 className="w-4 h-4" strokeWidth={2} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
