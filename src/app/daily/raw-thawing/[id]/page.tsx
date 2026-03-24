"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type LogHeader = {
  id: string;
  thawing_date: string;
  planned_use_date: string | null;
  author_name: string | null;
  item_code: string | null;
  material_name: string | null;
  lot_no: string | null;
  box_weight_g: number | null;
  unit_weight_g: number | null;
  box_qty: number | null;
  unit_qty: number | null;
  remainder_g: number | null;
  total_weight_g: number | null;
  thawing_start_at: string | null;
  thawing_end_at: string | null;
  thawing_room_temp_c: number | null;
  sensory_odor_result: string | null;
  sensory_color_result: string | null;
  foreign_matter_result: string | null;
  status: string;
  approved_by_name: string | null;
  reject_reason: string | null;
  corrective_datetime: string | null;
  corrective_deviation: string | null;
  corrective_detail: string | null;
  corrective_remarks: string | null;
  corrective_actor: string | null;
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

function resultLabel(v: string | null): string {
  if (v === "O") return "적합";
  if (v === "X") return "부적합";
  return "—";
}

export default function DailyRawThawingViewPage() {
  const router = useRouter();
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const { user, profile } = useAuth();
  const [header, setHeader] = useState<LogHeader | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReasonInput, setRejectReasonInput] = useState("");

  const canApproveReject = (profile?.role === "manager" || profile?.role === "admin") && header?.status === "submitted";
  const isManager = profile?.role === "manager" || profile?.role === "admin";
  const approverName = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();

  const load = useCallback(async () => {
    if (!id) { setError("일지 ID가 없습니다."); setLoading(false); return; }
    if (id.toLowerCase() === "new") { router.replace("/daily/raw-thawing/new"); setLoading(false); return; }
    if (!UUID_RE.test(id)) { setError("잘못된 일지 ID입니다."); setLoading(false); return; }
    setLoading(true);
    const { data, error: err } = await supabase.from("daily_raw_thawing_logs").select("*").eq("id", id).maybeSingle();
    if (err) { setError(err.message); setHeader(null); setLoading(false); return; }
    if (!data) { setError("해당 일지를 찾을 수 없습니다."); setHeader(null); setLoading(false); return; }
    setHeader(data as LogHeader);
    setLoading(false);
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto"><p className="text-slate-500 text-sm">불러오는 중...</p></div>;
  if (error || !header) return <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto"><p className="text-red-400 text-sm mb-4">{error ?? "데이터 없음"}</p><Link href="/daily/raw-thawing" className="text-cyan-400 hover:text-cyan-300 text-sm">목록으로</Link></div>;

  const hasCorrective = header.corrective_datetime || header.corrective_deviation || header.corrective_detail || header.corrective_remarks || header.corrective_actor;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200 text-sm">데일리</Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/raw-thawing" className="text-slate-400 hover:text-slate-200 text-sm">원료 해동 일지</Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{header.thawing_date}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-4">원료 해동 일지</h1>

      <section className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 mb-6 text-sm space-y-2">
        <p className="text-slate-300">해동일자: <span className="text-slate-100">{header.thawing_date}</span></p>
        <p className="text-slate-300">사용예정일자: <span className="text-slate-100">{header.planned_use_date ?? "—"}</span></p>
        <p className="text-slate-300">원료명: <span className="text-slate-100">{header.material_name ?? "—"}</span></p>
        <p className="text-slate-300">LOT: <span className="text-slate-100">{header.lot_no ?? "—"}</span></p>
        <p className="text-slate-300">박스/낱개/잔량: <span className="text-slate-100">{header.box_qty ?? 0} / {header.unit_qty ?? 0} / {header.remainder_g ?? 0}g</span></p>
        <p className="text-slate-300">총중량: <span className="text-cyan-300">{header.total_weight_g ?? 0}g</span></p>
        <p className="text-slate-300">해동 시작/종료: <span className="text-slate-100">{formatDt(header.thawing_start_at)} / {formatDt(header.thawing_end_at)}</span></p>
        <p className="text-slate-300">해동 창고 온도: <span className="text-slate-100">{header.thawing_room_temp_c != null ? `${header.thawing_room_temp_c}℃` : "—"}</span></p>
        <p className="text-slate-300">관능검사(이취): <span className="text-slate-100">{resultLabel(header.sensory_odor_result)}</span></p>
        <p className="text-slate-300">관능검사(색깔): <span className="text-slate-100">{resultLabel(header.sensory_color_result)}</span></p>
        <p className="text-slate-300">이물오염 여부 확인: <span className="text-slate-100">{resultLabel(header.foreign_matter_result)}</span></p>
      </section>

      {hasCorrective && (
        <section className="rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8">
          <h2 className="text-sm font-semibold text-amber-300 mb-3">개선조치</h2>
          <dl className="grid gap-3 text-sm">
            {header.corrective_datetime && <><dt className="text-slate-500">일시</dt><dd className="text-slate-200">{formatDt(header.corrective_datetime)}</dd></>}
            {header.corrective_deviation && <><dt className="text-slate-500">이탈내용</dt><dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_deviation}</dd></>}
            {header.corrective_detail && <><dt className="text-slate-500">개선조치내용</dt><dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_detail}</dd></>}
            {header.corrective_remarks && <><dt className="text-slate-500">비고</dt><dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_remarks}</dd></>}
            {header.corrective_actor && <><dt className="text-slate-500">개선조치자</dt><dd className="text-slate-200">{header.corrective_actor}</dd></>}
          </dl>
        </section>
      )}

      {canApproveReject && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button type="button" onClick={async () => { setActionLoading(true); const { error: err } = await supabase.from("daily_raw_thawing_logs").update({ status: "approved", approved_at: new Date().toISOString(), approved_by: user?.id ?? null, approved_by_name: approverName || null, updated_at: new Date().toISOString() }).eq("id", id); setActionLoading(false); if (err) setError(err.message); else load(); }} disabled={actionLoading} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium">{actionLoading ? "처리 중..." : "승인"}</button>
          <button type="button" onClick={() => { setRejectReasonInput(""); setRejectModalOpen(true); }} disabled={actionLoading} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium">반려</button>
        </div>
      )}

      {isManager && (
        <div className="flex flex-wrap justify-end gap-2 mb-6">
          <Link href={`/daily/raw-thawing/${id}/edit`} className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium">수정</Link>
          <button type="button" onClick={async () => { if (!window.confirm("이 일지를 삭제할까요?")) return; setActionLoading(true); const { error: err } = await supabase.from("daily_raw_thawing_logs").delete().eq("id", id); setActionLoading(false); if (err) setError(err.message); else router.push("/daily/raw-thawing"); }} disabled={actionLoading} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium">삭제</button>
        </div>
      )}

      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-slate-800 rounded-xl border border-slate-600 shadow-xl max-w-md w-full p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">반려 사유 (선택)</h3>
            <textarea value={rejectReasonInput} onChange={(e) => setRejectReasonInput(e.target.value)} rows={3} placeholder="반려 사유를 입력하세요." className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 text-sm resize-none mb-4" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRejectModalOpen(false)} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm">취소</button>
              <button type="button" onClick={async () => { setActionLoading(true); const { error: err } = await supabase.from("daily_raw_thawing_logs").update({ status: "rejected", rejected_at: new Date().toISOString(), rejected_by: user?.id ?? null, reject_reason: rejectReasonInput.trim() || null, updated_at: new Date().toISOString() }).eq("id", id); setActionLoading(false); setRejectModalOpen(false); if (err) setError(err.message); else load(); }} disabled={actionLoading} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium">반려하기</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Link href="/daily/raw-thawing" className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm">목록으로</Link>
      </div>
    </div>
  );
}
