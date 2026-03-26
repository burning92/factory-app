"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  MATERIAL_STORAGE_3F_QUESTIONS,
  MATERIAL_STORAGE_3F_ROOMS,
  keyForResult,
} from "@/features/daily/materialStorage3fChecklist";
import { canShowDailyApproveReject } from "@/app/daily/dailyLogPermissions";

type LogHeader = {
  id: string;
  inspection_date: string;
  author_name: string | null;
  raw_room_temp_c: number | null;
  raw_room_humidity_pct: number | null;
  sub_room_temp_c: number | null;
  sub_room_humidity_pct: number | null;
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
  room_key: string;
  question_index: number;
  result: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export default function DailyMaterialStorage3fViewPage() {
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

  const canApproveReject = canShowDailyApproveReject(profile?.role, header?.status);
  const approverName = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();

  const load = useCallback(async () => {
    if (!id) {
      setError("일지 ID가 없습니다.");
      setLoading(false);
      return;
    }
    if (id.toLowerCase() === "new") {
      router.replace("/daily/material-storage-3f/new");
      setLoading(false);
      return;
    }
    if (!UUID_RE.test(id)) {
      setError("잘못된 일지 ID입니다.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data: logData, error: logErr } = await supabase
      .from("daily_material_storage_3f_logs")
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
      .from("daily_material_storage_3f_log_items")
      .select("room_key, question_index, result")
      .eq("log_id", id);
    if (itemsErr) setItems([]);
    else setItems((itemsData ?? []) as LogItem[]);
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto"><p className="text-slate-500 text-sm">불러오는 중…</p></div>;
  if (error || !header) return <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto"><p className="text-red-400 text-sm mb-4">{error ?? "데이터가 없습니다."}</p><Link href="/daily/material-storage-3f" className="text-cyan-400 hover:text-cyan-300 text-sm">목록으로</Link></div>;

  const itemMap = new Map<string, string>();
  items.forEach((i) => {
    if ((i.room_key === "raw" || i.room_key === "sub") && i.question_index > 0) {
      itemMap.set(keyForResult(i.room_key, i.question_index - 1), i.result);
    }
  });

  const hasCorrective = header.corrective_datetime || header.corrective_deviation || header.corrective_detail || header.corrective_remarks || header.corrective_actor;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200 text-sm">데일리</Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/material-storage-3f" className="text-slate-400 hover:text-slate-200 text-sm">원부자재 창고 점검표(3F)</Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{header.inspection_date}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">원부자재 창고 점검표(3F) — 상세</h1>
      <p className="text-slate-500 text-sm mb-4">점검일자: {header.inspection_date}{header.author_name ? ` · 작성: ${header.author_name}` : ""}</p>

      {MATERIAL_STORAGE_3F_ROOMS.map((room) => (
        <section key={room.key} className="rounded-xl border border-slate-700/60 bg-slate-800/50 overflow-hidden mb-6">
          <h2 className="px-4 py-3 text-sm font-semibold text-cyan-300 bg-slate-800/80 border-b border-slate-700/60">{room.name}</h2>
          <div className="px-4 py-3 grid grid-cols-2 gap-3 text-sm border-b border-slate-700/50">
            <div>
              <p className="text-slate-500 text-xs mb-1">온도</p>
              <p className="text-slate-200">
                {room.key === "raw" ? (header.raw_room_temp_c != null ? `${header.raw_room_temp_c}℃` : "—") : (header.sub_room_temp_c != null ? `${header.sub_room_temp_c}℃` : "—")}
              </p>
            </div>
            <div>
              <p className="text-slate-500 text-xs mb-1">습도</p>
              <p className="text-slate-200">
                {room.key === "raw" ? (header.raw_room_humidity_pct != null ? `${header.raw_room_humidity_pct}%` : "—") : (header.sub_room_humidity_pct != null ? `${header.sub_room_humidity_pct}%` : "—")}
              </p>
            </div>
          </div>
          <ul className="divide-y divide-slate-700/50">
            {MATERIAL_STORAGE_3F_QUESTIONS.map((q, qi) => {
              const raw = itemMap.get(keyForResult(room.key, qi)) ?? "";
              return (
                <li key={`${room.key}-${qi}`} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <p className="flex-1 text-sm text-slate-300">{q}</p>
                  <span className={`shrink-0 min-w-[3.5rem] px-2 py-1.5 flex items-center justify-center rounded text-xs font-medium ${raw === "O" ? "bg-emerald-900/50 text-emerald-300" : raw === "X" ? "bg-amber-900/50 text-amber-300" : "bg-slate-700/50 text-slate-500"}`}>
                    {resultLabel(raw)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {hasCorrective && (
        <section className="rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8">
          <h2 className="text-sm font-semibold text-amber-300 mb-4">개선조치</h2>
          <dl className="grid gap-3 text-sm">
            {header.corrective_datetime && <><dt className="text-slate-500">일시</dt><dd className="text-slate-200">{formatDt(header.corrective_datetime)}</dd></>}
            {header.corrective_deviation && <><dt className="text-slate-500">이탈 내용</dt><dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_deviation}</dd></>}
            {header.corrective_detail && <><dt className="text-slate-500">개선 조치 내용</dt><dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_detail}</dd></>}
            {header.corrective_remarks && <><dt className="text-slate-500">비고</dt><dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_remarks}</dd></>}
            {header.corrective_actor && <><dt className="text-slate-500">개선 조치자</dt><dd className="text-slate-200">{header.corrective_actor}</dd></>}
          </dl>
        </section>
      )}

      {canApproveReject && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button type="button" onClick={async () => { setActionLoading(true); const { error: err } = await supabase.from("daily_material_storage_3f_logs").update({ status: "approved", approved_at: new Date().toISOString(), approved_by: user?.id ?? null, approved_by_name: approverName || null, updated_at: new Date().toISOString() }).eq("id", id); setActionLoading(false); if (err) setError(err.message); else load(); }} disabled={actionLoading} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium">{actionLoading ? "처리 중…" : "승인"}</button>
          <button type="button" onClick={() => { setRejectReasonInput(""); setRejectModalOpen(true); }} disabled={actionLoading} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium">반려</button>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 mb-6">
        <Link href={`/daily/material-storage-3f/${id}/edit`} className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium">수정</Link>
        <button type="button" onClick={async () => { if (!window.confirm("이 점검일지를 삭제할까요?")) return; setActionLoading(true); const { error: err } = await supabase.from("daily_material_storage_3f_logs").delete().eq("id", id); setActionLoading(false); if (err) setError(err.message); else router.push("/daily/material-storage-3f"); }} disabled={actionLoading} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium">삭제</button>
      </div>

      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-slate-800 rounded-xl border border-slate-600 shadow-xl max-w-md w-full p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">반려 사유 (선택)</h3>
            <textarea value={rejectReasonInput} onChange={(e) => setRejectReasonInput(e.target.value)} rows={3} placeholder="반려 사유를 입력하세요." className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 text-sm resize-none mb-4" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRejectModalOpen(false)} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm">취소</button>
              <button type="button" onClick={async () => { setActionLoading(true); const { error: err } = await supabase.from("daily_material_storage_3f_logs").update({ status: "rejected", rejected_at: new Date().toISOString(), rejected_by: user?.id ?? null, reject_reason: rejectReasonInput.trim() || null, updated_at: new Date().toISOString() }).eq("id", id); setActionLoading(false); setRejectModalOpen(false); if (err) setError(err.message); else load(); }} disabled={actionLoading} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium">반려하기</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Link href="/daily/material-storage-3f" className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm">목록으로</Link>
      </div>
    </div>
  );
}
