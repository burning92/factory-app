"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  COLD_STORAGE_HYGIENE_CHECKLIST,
  coldStorageQuestionText,
} from "@/features/daily/coldStorageHygieneChecklist";
import {
  COLD_STORAGE_TEMPERATURE_DEFS,
  isTempKeyOutOfRange,
  roundOneDecimal,
  type ColdStorageTempKey,
} from "@/features/daily/coldStorageHygieneTemperature";

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
  am_measure_time: string | null;
  pm_measure_time: string | null;
  am_temp_floor1_refrigerator_c: number | null;
  am_temp_floor1_freezer_c: number | null;
  am_temp_dough_aging_c: number | null;
  am_temp_topping_refrigerator_c: number | null;
  am_temp_blast_freezer_1_c: number | null;
  am_temp_blast_freezer_2_c: number | null;
  pm_temp_floor1_refrigerator_c: number | null;
  pm_temp_floor1_freezer_c: number | null;
  pm_temp_dough_aging_c: number | null;
  pm_temp_topping_refrigerator_c: number | null;
  pm_temp_blast_freezer_1_c: number | null;
  pm_temp_blast_freezer_2_c: number | null;
};

type LogItem = {
  category: string;
  question_index: number;
  question_text: string;
  result: string;
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

function resultLabel(result: string): string {
  if (result === "O") return "적합";
  if (result === "X") return "부적합";
  return "—";
}

function formatTempCell(n: number | null): string {
  if (n == null) return "—";
  return `${roundOneDecimal(Number(n)).toFixed(1)}℃`;
}

const AM_KEY: Record<ColdStorageTempKey, keyof LogHeader> = {
  floor1_refrigerator: "am_temp_floor1_refrigerator_c",
  floor1_freezer: "am_temp_floor1_freezer_c",
  dough_aging: "am_temp_dough_aging_c",
  topping_refrigerator: "am_temp_topping_refrigerator_c",
  blast_freezer_1: "am_temp_blast_freezer_1_c",
  blast_freezer_2: "am_temp_blast_freezer_2_c",
};

const PM_KEY: Record<ColdStorageTempKey, keyof LogHeader> = {
  floor1_refrigerator: "pm_temp_floor1_refrigerator_c",
  floor1_freezer: "pm_temp_floor1_freezer_c",
  dough_aging: "pm_temp_dough_aging_c",
  topping_refrigerator: "pm_temp_topping_refrigerator_c",
  blast_freezer_1: "pm_temp_blast_freezer_1_c",
  blast_freezer_2: "pm_temp_blast_freezer_2_c",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DailyColdStorageHygieneViewPage() {
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

  const canApproveReject =
    (profile?.role === "manager" || profile?.role === "admin") && header?.status === "submitted";
  const isManager = profile?.role === "manager" || profile?.role === "admin";
  const approverName = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();

  const load = useCallback(async () => {
    if (!id) {
      setError("일지 ID가 없습니다.");
      setLoading(false);
      return;
    }
    const idLower = id.toLowerCase();
    if (idLower === "new") {
      router.replace("/daily/cold-storage-hygiene/new");
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
      .from("daily_cold_storage_hygiene_logs")
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
      .from("daily_cold_storage_hygiene_log_items")
      .select("category, question_index, question_text, result")
      .eq("log_id", id)
      .order("category")
      .order("question_index");
    if (itemsErr) {
      setItems([]);
    } else {
      setItems((itemsData ?? []) as LogItem[]);
    }
    setLoading(false);
  }, [id, router]);

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
        <p className="text-red-400 text-sm mb-4">{error ?? "데이터 없음"}</p>
        <Link href="/daily/cold-storage-hygiene" className="text-cyan-400 hover:text-cyan-300 text-sm">
          목록으로
        </Link>
      </div>
    );
  }

  const itemMap = new Map<string, string>();
  items.forEach((i) => {
    const key = `${i.category}-${i.question_index}`;
    itemMap.set(key, i.result);
  });

  const hasCorrective =
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
        <Link href="/daily/cold-storage-hygiene" className="text-slate-400 hover:text-slate-200 text-sm">
          냉장 · 냉동온도 및 위생 점검일지
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{header.inspection_date}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">냉장 · 냉동온도 및 위생 점검일지</h1>

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
          <span className="font-medium">반려됨</span>
          {header.reject_reason && (
            <p className="mt-1 text-slate-300 whitespace-pre-wrap">{header.reject_reason}</p>
          )}
          <p className="mt-1 text-slate-500 text-xs">수정 후 다시 제출할 수 있습니다.</p>
        </div>
      )}
      {header.status === "submitted" && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-slate-800/80 border border-slate-600 text-slate-400 text-sm">
          제출됨 · 승인 대기 중
        </div>
      )}

      <p className="text-slate-500 text-sm mb-1">
        점검일자: {header.inspection_date}
        {header.author_name && ` · 작성: ${header.author_name}`}
      </p>
      <p className="text-slate-600 text-xs mb-4">작성 시각: {formatDt(header.created_at)}</p>

      <div className="space-y-6 mb-8">
        {COLD_STORAGE_HYGIENE_CHECKLIST.map((category) => (
          <section
            key={category.title}
            className="rounded-xl border border-slate-700/60 bg-slate-800/50 overflow-hidden"
          >
            <h2 className="px-4 py-3 text-sm font-semibold text-cyan-300 bg-slate-800/80 border-b border-slate-700/60">
              {category.title}
            </h2>
            <ul className="divide-y divide-slate-700/50">
              {category.items.map((item, qIndex) => {
                const key = `${category.title}-${qIndex + 1}`;
                const raw = itemMap.get(key) ?? "";
                const label = resultLabel(raw);
                return (
                  <li key={key} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <p className="flex-1 text-sm text-slate-300 min-w-0">{coldStorageQuestionText(item)}</p>
                    <span
                      className={`shrink-0 min-w-[3.5rem] px-2 py-1.5 flex items-center justify-center rounded text-xs font-medium ${
                        raw === "O"
                          ? "bg-emerald-900/50 text-emerald-300"
                          : raw === "X"
                            ? "bg-amber-900/50 text-amber-300"
                            : "bg-slate-700/50 text-slate-500"
                      }`}
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <section className="rounded-xl border border-slate-700/60 bg-slate-800/50 overflow-hidden mb-8">
        <h2 className="px-4 py-3 text-sm font-semibold text-cyan-300 bg-slate-800/80 border-b border-slate-700/60">
          온도 측정
        </h2>
        <div className="px-4 py-3 border-b border-slate-700/60 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-slate-500 text-xs">오전 측정 시간</span>
            <p className="text-slate-200">{header.am_measure_time?.trim() || "—"}</p>
          </div>
          <div>
            <span className="text-slate-500 text-xs">오후 측정 시간</span>
            <p className="text-slate-200">{header.pm_measure_time?.trim() || "—"}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/60 text-left text-xs text-slate-500">
                <th className="px-4 py-2 font-medium">측정 위치</th>
                <th className="px-4 py-2 font-medium">오전</th>
                <th className="px-4 py-2 font-medium">오후</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {COLD_STORAGE_TEMPERATURE_DEFS.map((def) => {
                const amVal = header[AM_KEY[def.key]] as number | null;
                const pmVal = header[PM_KEY[def.key]] as number | null;
                const amDev = isTempKeyOutOfRange(def.key, amVal);
                const pmDev = isTempKeyOutOfRange(def.key, pmVal);
                return (
                  <tr key={def.key}>
                    <td className="px-4 py-2 text-slate-300">{def.label}</td>
                    <td
                      className={`px-4 py-2 ${amDev ? "text-amber-300 bg-amber-950/20" : "text-slate-200"}`}
                    >
                      {formatTempCell(amVal)}
                    </td>
                    <td
                      className={`px-4 py-2 ${pmDev ? "text-amber-300 bg-amber-950/20" : "text-slate-200"}`}
                    >
                      {formatTempCell(pmVal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {hasCorrective && (
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
                <dt className="text-slate-500">이탈내용</dt>
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
                .from("daily_cold_storage_hygiene_logs")
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

      {isManager && (
        <div className="flex flex-wrap justify-end gap-2 mb-6">
          <Link
            href={`/daily/cold-storage-hygiene/${id}/edit`}
            className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium"
          >
            수정
          </Link>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm("이 점검일지를 삭제할까요?")) return;
              setActionLoading(true);
              const { error: err } = await supabase.from("daily_cold_storage_hygiene_logs").delete().eq("id", id);
              setActionLoading(false);
              if (err) setError(err.message);
              else router.push("/daily/cold-storage-hygiene");
            }}
            disabled={actionLoading}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium"
          >
            삭제
          </button>
        </div>
      )}

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
                    .from("daily_cold_storage_hygiene_logs")
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
          href="/daily/cold-storage-hygiene"
          className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
        >
          목록으로
        </Link>
      </div>
    </div>
  );
}
