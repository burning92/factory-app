"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { canShowDailyApproveReject } from "@/app/daily/dailyLogPermissions";

type LogHeader = {
  id: string;
  inspection_date: string | null;
  inspector_name: string | null;
  status: string;
  approved_at: string | null;
  approved_by_name: string | null;
  reject_reason: string | null;
  corrective_datetime: string | null;
  corrective_deviation: string | null;
  corrective_detail: string | null;
  corrective_remarks: string | null;
  corrective_actor: string | null;
};

type LogItem = {
  item_index: number;
  item_label: string;
  min_lux: number;
  measured_lux: number | null;
  conformity: "O" | "X" | null;
};

function formatDate(value: string | null): string {
  return value || "—";
}

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function DailyIlluminationViewPage() {
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
    setLoading(true);
    setError(null);

    const { data: logData, error: logErr } = await supabase.from("daily_illumination_logs").select("*").eq("id", id).maybeSingle();
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

    const { data: itemData, error: itemErr } = await supabase
      .from("daily_illumination_log_items")
      .select("item_index, item_label, min_lux, measured_lux, conformity")
      .eq("log_id", id)
      .order("item_index", { ascending: true });
    if (itemErr) setItems([]);
    else setItems((itemData ?? []) as LogItem[]);

    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-3xl mx-auto">
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      </div>
    );
  }

  if (error || !header) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-3xl mx-auto">
        <p className="text-red-400 text-sm mb-4">{error ?? "데이터가 없습니다."}</p>
        <Link href="/daily/illumination" className="text-cyan-400 hover:text-cyan-300 text-sm">목록으로</Link>
      </div>
    );
  }

  const hasCorrective =
    header.corrective_datetime ||
    header.corrective_deviation ||
    header.corrective_detail ||
    header.corrective_remarks ||
    header.corrective_actor;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-3xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200 text-sm">데일리</Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/illumination" className="text-slate-400 hover:text-slate-200 text-sm">영업장 조도 점검일지</Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{formatDate(header.inspection_date)}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">영업장 조도 점검일지 — 상세</h1>
      <p className="text-slate-500 text-sm mb-4">점검일자: {formatDate(header.inspection_date)}{header.inspector_name ? ` · 점검자: ${header.inspector_name}` : ""}</p>

      {header.status === "approved" && <div className="mb-4 px-4 py-2 rounded-lg bg-emerald-900/20 border border-emerald-700/50 text-emerald-200 text-sm">승인 완료</div>}
      {header.status === "submitted" && <div className="mb-4 px-4 py-2 rounded-lg bg-slate-800/80 border border-slate-600 text-slate-400 text-sm">제출 완료 · 승인 대기</div>}
      {header.status === "rejected" && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-amber-900/20 border border-amber-700/50 text-amber-200 text-sm">
          <span className="font-medium">반려</span>
          {header.reject_reason && <p className="mt-1 text-slate-300 whitespace-pre-wrap">{header.reject_reason}</p>}
        </div>
      )}

      <div className="space-y-3 mb-8">
        {items.map((row) => (
          <section key={row.item_index} className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4">
            <p className="text-sm text-slate-200 font-medium mb-1">{row.item_index}. {row.item_label}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <p className="text-slate-400">기준: <span className="text-slate-200">{row.min_lux} lx 이상</span></p>
              <p className="text-slate-400">실측: <span className="text-slate-200">{row.measured_lux == null ? "—" : `${row.measured_lux} lx`}</span></p>
              <p className="text-slate-400">판정: <span className={row.conformity === "O" ? "text-emerald-300" : row.conformity === "X" ? "text-amber-300" : "text-slate-300"}>{row.conformity === "O" ? "적합" : row.conformity === "X" ? "부적합" : "미판정"}</span></p>
            </div>
          </section>
        ))}
      </div>

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
          <button
            type="button"
            onClick={async () => {
              setActionLoading(true);
              const { error: err } = await supabase
                .from("daily_illumination_logs")
                .update({
                  status: "approved",
                  approved_at: new Date().toISOString(),
                  approved_by: user?.id ?? null,
                  approved_by_name: approverName || null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", id);
              setActionLoading(false);
              if (err) setError(err.message);
              else void load();
            }}
            disabled={actionLoading}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium"
          >
            {actionLoading ? "처리 중…" : "승인"}
          </button>
          <button
            type="button"
            onClick={() => {
              setRejectReasonInput("");
              setRejectModalOpen(true);
            }}
            disabled={actionLoading}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium"
          >
            반려
          </button>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 mb-6">
        <Link href={`/daily/illumination/${id}/edit`} className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium">수정</Link>
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm("이 일지를 삭제할까요?")) return;
            setActionLoading(true);
            const { error: err } = await supabase.from("daily_illumination_logs").delete().eq("id", id);
            setActionLoading(false);
            if (err) setError(err.message);
            else router.push("/daily/illumination");
          }}
          disabled={actionLoading}
          className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium"
        >
          삭제
        </button>
      </div>

      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-slate-800 rounded-xl border border-slate-600 shadow-xl max-w-md w-full p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">반려 사유 (선택)</h3>
            <textarea
              value={rejectReasonInput}
              onChange={(e) => setRejectReasonInput(e.target.value)}
              rows={3}
              placeholder="반려 사유를 입력하세요."
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 text-sm resize-none mb-4"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRejectModalOpen(false)} className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm">취소</button>
              <button
                type="button"
                onClick={async () => {
                  setActionLoading(true);
                  const { error: err } = await supabase
                    .from("daily_illumination_logs")
                    .update({
                      status: "rejected",
                      rejected_at: new Date().toISOString(),
                      rejected_by: user?.id ?? null,
                      reject_reason: rejectReasonInput.trim() || null,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", id);
                  setActionLoading(false);
                  setRejectModalOpen(false);
                  if (err) setError(err.message);
                  else void load();
                }}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium"
              >
                반려하기
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Link href="/daily/illumination" className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm">목록으로</Link>
      </div>
    </div>
  );
}
