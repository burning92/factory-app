"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { TEMP_HUMIDITY_ZONES } from "@/features/daily/tempHumidityZones";
import { canShowDailyApproveReject } from "@/app/daily/dailyLogPermissions";

type LogHeader = {
  id: string;
  inspection_date: string;
  author_name: string | null;
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
  zone_index: number;
  zone_name: string;
  max_temp_c: number;
  max_humidity_pct: number;
  actual_temp_c: number | null;
  actual_humidity_pct: number | null;
};

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function itemDeviation(it: LogItem): boolean {
  return (
    (it.actual_temp_c != null && Number(it.actual_temp_c) > Number(it.max_temp_c)) ||
    (it.actual_humidity_pct != null && Number(it.actual_humidity_pct) > Number(it.max_humidity_pct))
  );
}

export default function DailyTempHumidityViewPage() {
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
    const { data: logData, error: logErr } = await supabase
      .from("daily_temp_humidity_logs")
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
      .from("daily_temp_humidity_log_items")
      .select("zone_index, zone_name, max_temp_c, max_humidity_pct, actual_temp_c, actual_humidity_pct")
      .eq("log_id", id)
      .order("zone_index");
    if (itemsErr) {
      setItems([]);
    } else {
      setItems((itemsData ?? []) as LogItem[]);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      </div>
    );
  }

  if (error || !header) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-red-400 text-sm mb-4">{error ?? "데이터가 없습니다."}</p>
        <Link href="/daily/temperature-humidity" className="text-cyan-400 hover:text-cyan-300 text-sm">
          목록으로
        </Link>
      </div>
    );
  }

  const itemByIndex = new Map<number, LogItem>();
  items.forEach((it) => itemByIndex.set(it.zone_index, it));

  const anyDeviation = items.some(itemDeviation);
  const hasCorrectiveText =
    header.corrective_datetime ||
    header.corrective_deviation ||
    header.corrective_detail ||
    header.corrective_remarks ||
    header.corrective_actor;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200 text-sm">
          데일리
        </Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/temperature-humidity" className="text-slate-400 hover:text-slate-200 text-sm">
          영업장 온·습도 점검일지
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{header.inspection_date}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">영업장 온·습도 점검일지 — 상세</h1>

      {header.status === "approved" && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-900/20 border border-emerald-700/50 text-emerald-200 text-sm font-medium">
          승인 완료
          {header.approved_at && (
            <span className="ml-2 font-normal text-slate-400">
              {formatDt(header.approved_at)}
              {header.approved_by_name ? ` · ${header.approved_by_name}` : ""}
            </span>
          )}
        </div>
      )}
      {header.status === "rejected" && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-900/20 border border-amber-700/50 text-amber-200 text-sm">
          <span className="font-medium">반려</span>
          {header.reject_reason && (
            <p className="mt-1 text-slate-300 whitespace-pre-wrap">{header.reject_reason}</p>
          )}
          <p className="mt-1 text-slate-500 text-xs">수정 후 다시 제출할 수 있습니다.</p>
        </div>
      )}
      {header.status === "submitted" && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-slate-800/80 border border-slate-600 text-slate-400 text-sm">
          제출 완료 · 승인 대기
        </div>
      )}

      <p className="text-slate-500 text-sm mb-4">
        점검일자: {header.inspection_date}
        {header.author_name && ` · 작성: ${header.author_name}`}
      </p>

      <div className="space-y-3 mb-8">
        {TEMP_HUMIDITY_ZONES.map((z, i) => {
          const idx = i + 1;
          const it = itemByIndex.get(idx);
          const dev = it ? itemDeviation(it) : false;
          return (
            <section
              key={z.id}
              className={`rounded-xl border overflow-hidden ${
                dev ? "border-amber-600/60 bg-amber-950/10" : "border-slate-700/60 bg-slate-800/50"
              }`}
            >
              <div className="px-4 py-3 border-b border-slate-700/60 bg-slate-800/80">
                <h2 className="text-sm font-semibold text-cyan-300">{z.name}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  온도 기준: {z.maxTempC}°C 이하 · 습도 기준: {z.maxHumidityPct}% 이하
                </p>
              </div>
              <div className="px-4 py-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-slate-500 text-xs mb-1">실제 온도</p>
                  <p className="text-slate-200">
                    {it?.actual_temp_c != null ? `${it.actual_temp_c}°C` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 text-xs mb-1">실제 습도</p>
                  <p className="text-slate-200">
                    {it?.actual_humidity_pct != null ? `${it.actual_humidity_pct}%` : "—"}
                  </p>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {(anyDeviation || hasCorrectiveText) && (
        <section className="rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8">
          <h2 className="text-sm font-semibold text-amber-300 mb-4">개선조치</h2>
          <dl className="grid gap-3 text-sm">
            {header.corrective_datetime && (
              <>
                <dt className="text-slate-500">일시</dt>
                <dd className="text-slate-200">{formatDt(header.corrective_datetime)}</dd>
              </>
            )}
            {header.corrective_deviation && (
              <>
                <dt className="text-slate-500">이탈 내용</dt>
                <dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_deviation}</dd>
              </>
            )}
            {header.corrective_detail && (
              <>
                <dt className="text-slate-500">개선조치내용</dt>
                <dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_detail}</dd>
              </>
            )}
            {header.corrective_remarks && (
              <>
                <dt className="text-slate-500">비고</dt>
                <dd className="text-slate-200 whitespace-pre-wrap">{header.corrective_remarks}</dd>
              </>
            )}
            {header.corrective_actor && (
              <>
                <dt className="text-slate-500">개선조치자</dt>
                <dd className="text-slate-200">{header.corrective_actor}</dd>
              </>
            )}
            {header.status === "approved" && header.approved_by_name && (
              <>
                <dt className="text-slate-500">승인자</dt>
                <dd className="text-slate-200">{header.approved_by_name}</dd>
              </>
            )}
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
                .from("daily_temp_humidity_logs")
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
              else load();
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
        <Link
          href={`/daily/temperature-humidity/${id}/edit`}
          className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium"
        >
          수정
        </Link>
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm("이 점검일지를 삭제할까요?")) return;
            setActionLoading(true);
            const { error: err } = await supabase.from("daily_temp_humidity_logs").delete().eq("id", id);
            setActionLoading(false);
            if (err) setError(err.message);
            else router.push("/daily/temperature-humidity");
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
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
              >
                취소
              </button>
              <button
                type="button"
                onClick={async () => {
                  setActionLoading(true);
                  const { error: err } = await supabase
                    .from("daily_temp_humidity_logs")
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
                  else load();
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
        <Link
          href="/daily/temperature-humidity"
          className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
        >
          목록으로
        </Link>
      </div>
    </div>
  );
}
