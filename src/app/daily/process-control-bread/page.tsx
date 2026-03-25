"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { Pencil, Trash2 } from "lucide-react";

type LogStatus = "draft" | "submitted" | "approved" | "rejected";

type LogRow = {
  id: string;
  inspection_date: string;
  author_name: string | null;
  product_name: string | null;
  status: LogStatus;
  approved_at: string | null;
  approved_by_name: string | null;
  reject_reason: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ko-KR", { dateStyle: "short" });
  } catch {
    return iso;
  }
}

function statusLabel(s: LogStatus): string {
  switch (s) {
    case "draft":
      return "작성중";
    case "submitted":
      return "제출됨";
    case "approved":
      return "승인완료";
    case "rejected":
      return "반려";
    default:
      return s;
  }
}

function statusBadgeClass(s: LogStatus): string {
  switch (s) {
    case "approved":
      return "bg-emerald-900/50 text-emerald-300";
    case "submitted":
      return "bg-cyan-900/50 text-cyan-300 border border-cyan-600/50";
    case "rejected":
      return "bg-amber-900/50 text-amber-300";
    default:
      return "bg-slate-700/80 text-slate-400";
  }
}

export default function DailyProcessControlBreadListPage() {
  const { viewOrganizationCode } = useAuth();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const orgCode = viewOrganizationCode ?? "100";

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("daily_process_control_bread_logs")
      .select("id, inspection_date, author_name, product_name, status, approved_at, approved_by_name, reject_reason")
      .eq("organization_code", orgCode)
      .order("inspection_date", { ascending: false })
      .limit(100);
    if (error) {
      setToast({ message: error.message, error: true });
      setLogs([]);
    } else {
      setLogs((data ?? []) as LogRow[]);
    }
    setLoading(false);
  }, [orgCode]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const getRowHref = (log: LogRow) => {
    if (log.status === "draft" || log.status === "rejected") return `/daily/process-control-bread/${log.id}/edit`;
    return `/daily/process-control-bread/${log.id}`;
  };

  const handleDelete = async (logId: string) => {
    const ok = window.confirm("이 점검일지를 삭제할까요?");
    if (!ok) return;
    setDeletingId(logId);
    setToast(null);
    const { error } = await supabase.from("daily_process_control_bread_logs").delete().eq("id", logId);
    setDeletingId(null);
    if (error) {
      setToast({ message: error.message, error: true });
      return;
    }
    await fetchLogs();
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-2xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200 text-sm">데일리</Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">공정관리 점검일지(빵류)</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-lg font-semibold text-slate-100">공정관리 점검일지(빵류)</h1>
        <Link href="/daily/process-control-bread/new" className="shrink-0 inline-flex items-center justify-center px-4 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium text-sm">
          새 점검일지 작성
        </Link>
      </div>

      {toast && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${toast.error ? "bg-red-900/30 text-red-200" : "bg-cyan-900/30 text-cyan-200"}`}>
          {toast.message}
        </div>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      ) : logs.length === 0 ? (
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-8 text-center">
          <p className="text-slate-500 text-sm mb-4">저장된 점검일지가 없습니다.</p>
          <Link href="/daily/process-control-bread/new" className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium">
            새 점검일지 작성
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {logs.map((log) => (
            <li key={log.id}>
              <Link href={getRowHref(log)} className={`block px-4 py-3 rounded-xl border transition-colors ${log.status === "submitted" ? "border-cyan-600/50 bg-slate-800/80 hover:bg-slate-700/60" : "border-slate-700/60 bg-slate-800/50 hover:bg-slate-700/50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 gap-y-1">
                      <span className="font-medium text-slate-200">{log.inspection_date}</span>
                      {log.product_name && <span className="text-slate-500 text-sm">제품: {log.product_name}</span>}
                      {log.author_name && <span className="text-slate-500 text-sm">작성: {log.author_name}</span>}
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusBadgeClass(log.status)}`}>{statusLabel(log.status)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/daily/process-control-bread/${log.id}/edit`; }} className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-700/60 bg-slate-900/30 hover:bg-slate-700/40 text-slate-200" title="수정" aria-label="수정">
                        <Pencil className="w-4 h-4" strokeWidth={2} />
                      </button>
                      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleDelete(log.id); }} disabled={deletingId === log.id} className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-red-700/40 bg-red-900/10 hover:bg-red-900/25 text-red-200 disabled:opacity-50" title="삭제" aria-label="삭제">
                        <Trash2 className="w-4 h-4" strokeWidth={2} />
                      </button>
                    </div>
                </div>
                {log.status === "approved" && (log.approved_at || log.approved_by_name) && (
                  <p className="mt-1 text-xs text-slate-500">
                    승인 {log.approved_at ? formatDate(log.approved_at) : ""}
                    {log.approved_by_name ? ` · ${log.approved_by_name}` : ""}
                  </p>
                )}
                {log.status === "rejected" && log.reject_reason && (
                  <p className="mt-1 text-xs text-amber-400/90 line-clamp-1">{log.reject_reason}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
