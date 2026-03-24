"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { PROCESS_CONTROL_BREAD_STAGES } from "@/features/daily/processControlBreadChecklist";

type LogHeader = {
  id: string;
  inspection_date: string;
  author_name: string | null;
  product_name: string | null;
  work_start_time: string | null;
  work_end_time: string | null;
  fermentation_start_at: string | null;
  fermentation_end_at: string | null;
  topping_weight_check_g: number | null;
  notes: string | null;
  status: string;
  approved_at: string | null;
  approved_by_name: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  corrective_datetime: string | null;
  corrective_deviation: string | null;
  corrective_detail: string | null;
  corrective_remarks: string | null;
  corrective_actor: string | null;
  created_at: string;
};

type LogItem = {
  stage_index: number;
  result: string;
};

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function resultLabel(result: string): string {
  if (result === "O") return "적합";
  if (result === "X") return "부적합";
  return "—";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DailyProcessControlBreadViewPage() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const { user, profile } = useAuth();
  const [header, setHeader] = useState<LogHeader | null>(null);
  const [items, setItems] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReasonInput, setRejectReasonInput] = useState("");

  const canApproveReject = (profile?.role === "manager" || profile?.role === "admin") && header?.status === "submitted";
  const isManager = profile?.role === "manager" || profile?.role === "admin";
  const approverName = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();

  const load = useCallback(async () => {
    if (!id) {
      setError("일지 ID가 없습니다.");
      setLoading(false);
      return;
    }
    if (id.toLowerCase() === "new") {
      router.replace("/daily/process-control-bread/new");
      setLoading(false);
      return;
    }
    if (!UUID_RE.test(id)) {
      setError("잘못된 일지 ID입니다.");
      setHeader(null);
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data: logData, error: logErr } = await supabase
      .from("daily_process_control_bread_logs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (logErr) {
      setError(logErr.message);
      setHeader(null);
      setItems([]);
      setLoading(false);
      return;
    }
    if (!logData) {
      setError("해당 일지를 찾을 수 없습니다.");
      setHeader(null);
      setItems([]);
      setLoading(false);
      return;
    }
    setHeader(logData as LogHeader);
    const { data: itemsData, error: itemsErr } = await supabase
      .from("daily_process_control_bread_log_items")
      .select("stage_index, result")
      .eq("log_id", id)
      .order("stage_index");
    if (itemsErr) setItems([]);
    else setItems((itemsData ?? []) as LogItem[]);
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto"><p className="text-slate-500 text-sm">불러오는 중…</p></div>;
  }
  if (error || !header) {
    return <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto"><p className="text-red-400 text-sm mb-4">{error ?? "데이터 없음"}</p><Link href="/daily/process-control-bread" className="text-cyan-400 hover:text-cyan-300 text-sm">목록으로</Link></div>;
  }

  const itemMap = new Map<number, string>();
  items.forEach((i) => itemMap.set(i.stage_index, i.result));

  const hasCorrective =
    header.corrective_datetime ||
    header.corrective_deviation ||
    header.corrective_detail ||
    header.corrective_remarks ||
    header.corrective_actor;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200 text-sm">데일리</Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/process-control-bread" className="text-slate-400 hover:text-slate-200 text-sm">공정관리 점검일지(빵류)</Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{header.inspection_date}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">공정관리 점검일지(빵류)</h1>

      {header.status === "approved" && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-900/20 border border-emerald-700/50 text-emerald-200 text-sm font-medium">
          승인 완료
          {header.approved_at && <span className="ml-2 font-normal text-slate-400">{formatDt(header.approved_at)}{header.approved_by_name ? ` · ${header.approved_by_name}` : ""}</span>}
        </div>
      )}
      {header.status === "rejected" && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-900/20 border border-amber-700/50 text-amber-200 text-sm">
          <span className="font-medium">반려됨</span>
          {header.reject_reason && <p className="mt-1 text-slate-300 whitespace-pre-wrap">{header.reject_reason}</p>}
          <p className="mt-1 text-slate-500 text-xs">수정 후 다시 제출할 수 있습니다.</p>
        </div>
      )}
      {header.status === "submitted" && <div className="mb-4 px-4 py-2 rounded-lg bg-slate-800/80 border border-slate-600 text-slate-400 text-sm">제출됨 · 승인 대기 중</div>}

      <div className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <p className="text-slate-300">점검일자: <span className="text-slate-100">{header.inspection_date}</span></p>
        <p className="text-slate-300">제품명: <span className="text-slate-100">{header.product_name || "—"}</span></p>
        <p className="text-slate-300">작성자명: <span className="text-slate-100">{header.author_name || "—"}</span></p>
        <p className="text-slate-300">작성시각: <span className="text-slate-100">{formatDt(header.created_at)}</span></p>
        <p className="text-slate-300">작업시작시간: <span className="text-slate-100">{header.work_start_time || "—"}</span></p>
        <p className="text-slate-300">작업종료시간: <span className="text-slate-100">{header.work_end_time || "—"}</span></p>
        <p className="text-slate-300">숙성 시작: <span className="text-slate-100">{formatDt(header.fermentation_start_at)}</span></p>
        <p className="text-slate-300">숙성 종료: <span className="text-slate-100">{formatDt(header.fermentation_end_at)}</span></p>
        <p className="text-slate-300">토핑 중량체크 평균: <span className="text-slate-100">{header.topping_weight_check_g != null ? `${header.topping_weight_check_g} g` : "—"}</span></p>
      </div>

      <div className="space-y-2 mb-8">
        {PROCESS_CONTROL_BREAD_STAGES.map((stage, idx) => {
          const raw = itemMap.get(idx + 1) ?? "";
          return (
            <div key={stage} className="px-4 py-3 rounded-xl border border-slate-700/60 bg-slate-800/50 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <p className="flex-1 text-sm text-slate-300">{stage}</p>
              <span className={`shrink-0 min-w-[3.5rem] px-2 py-1.5 flex items-center justify-center rounded text-xs font-medium ${raw === "O" ? "bg-emerald-900/50 text-emerald-300" : raw === "X" ? "bg-amber-900/50 text-amber-300" : "bg-slate-700/50 text-slate-500"}`}>
                {resultLabel(raw)}
              </span>
            </div>
          );
        })}
      </div>

      <section className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 mb-8">
        <h2 className="text-sm font-semibold text-cyan-300 mb-2">특이사항</h2>
        <p className="text-sm text-slate-300 whitespace-pre-wrap">{header.notes || "—"}</p>
      </section>

      {hasCorrective && (
        <section className="rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8">
          <h2 className="text-sm font-semibold text-amber-300 mb-4">개선조치</h2>
          <dl className="grid gap-3 text-sm">
            {header.corrective_datetime && <><dt className="text-slate-500">일시</dt><dd className="text-slate-200">{formatDt(header.corrective_datetime)}</dd></>}
            {header.corrective_deviation && <><dt className="text-slate-500">이탈내용</dt><dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_deviation}</dd></>}
            {header.corrective_detail && <><dt className="text-slate-500">개선조치내용</dt><dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_detail}</dd></>}
            {header.corrective_remarks && <><dt className="text-slate-500">비고</dt><dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_remarks}</dd></>}
            {header.corrective_actor && <><dt className="text-slate-500">개선조치자</dt><dd className="text-slate-200">{header.corrective_actor}</dd></>}
            {header.status === "approved" && header.approved_by_name && <><dt className="text-slate-500">승인자</dt><dd className="text-slate-200">{header.approved_by_name}</dd></>}
          </dl>
        </section>
      )}

      {canApproveReject && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button type="button" onClick={async () => { setActionLoading(true); const { error: err } = await supabase.from("daily_process_control_bread_logs").update({ status: "approved", approved_at: new Date().toISOString(), approved_by: user?.id ?? null, approved_by_name: approverName || null, updated_at: new Date().toISOString() }).eq("id", id); setActionLoading(false); if (err) setError(err.message); else load(); }} disabled={actionLoading} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium">{actionLoading ? "처리 중…" : "승인"}</button>
          <button type="button" onClick={() => { setRejectReasonInput(""); setRejectModalOpen(true); }} disabled={actionLoading} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium">반려</button>
        </div>
      )}

      {isManager && (
        <div className="flex flex-wrap justify-end gap-2 mb-6">
          <Link href={`/daily/process-control-bread/${id}/edit`} className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium">수정</Link>
          <button type="button" onClick={async () => { if (!window.confirm("이 점검일지를 삭제할까요?")) return; setActionLoading(true); const { error: err } = await supabase.from("daily_process_control_bread_logs").delete().eq("id", id); setActionLoading(false); if (err) setError(err.message); else router.push("/daily/process-control-bread"); }} disabled={actionLoading} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium">삭제</button>
        </div>
      )}

      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-slate-800 rounded-xl border border-slate-600 shadow-xl max-w-md w-full p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">반려 사유 (선택)</h3>
            <textarea value={rejectReasonInput} onChange={(e) => setRejectReasonInput(e.target.value)} rows={3} placeholder="반려 사유를 입력하세요." className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 text-sm resize-none mb-4" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRejectModalOpen(false)} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm">취소</button>
              <button type="button" onClick={async () => { setActionLoading(true); const { error: err } = await supabase.from("daily_process_control_bread_logs").update({ status: "rejected", rejected_at: new Date().toISOString(), rejected_by: user?.id ?? null, reject_reason: rejectReasonInput.trim() || null, updated_at: new Date().toISOString() }).eq("id", id); setActionLoading(false); setRejectModalOpen(false); if (err) setError(err.message); else load(); }} disabled={actionLoading} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium">반려하기</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Link href="/daily/process-control-bread" className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm">목록으로</Link>
      </div>
    </div>
  );
}
