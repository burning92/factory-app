"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { getDailyLogAccess, type DailyLogAccessRow } from "@/app/daily/dailyLogPermissions";
import {
  diffDailyLogHeader,
  loadDailyLogCorrections,
  requestDailyLogCorrection,
  withdrawDailyLogSubmission,
  type DailyLogCorrection,
} from "@/features/daily/logWorkflow";

type Props = {
  table: string;
  logId: string;
  /** 상세 화면에서 select("*") 로 읽은 머리글 */
  log: DailyLogAccessRow & Record<string, unknown>;
  editHref: string;
  listHref: string;
  /** 상태가 바뀐 뒤 다시 읽기 */
  onChanged: () => void;
  /** 기본 삭제(머리글 delete) 대신 쓸 삭제 처리. 오류 메시지를 돌려준다 */
  onDelete?: () => Promise<string | null>;
};

function formatDt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function show(value: unknown): string {
  if (value == null || value === "") return "(비어 있음)";
  if (typeof value === "string" && value.startsWith("data:image/")) return `(사진 ${value.length.toLocaleString("ko-KR")}자)`;
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

export default function DailyLogActions({ table, logId, log, editHref, listHref, onChanged, onDelete }: Props) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const access = getDailyLogAccess(log, user?.id, profile?.role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<DailyLogCorrection[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = () =>
    run(async () => {
      if (!window.confirm("이 일지를 삭제할까요? 한 번도 제출하지 않은 작성 중 일지만 삭제할 수 있습니다.")) return;
      if (onDelete) {
        const message = await onDelete();
        if (message) throw new Error(message);
      } else {
        const { error: err } = await supabase.from(table).delete().eq("id", logId);
        if (err) throw new Error(err.message);
      }
      router.push(listHref);
    });

  const handleWithdraw = () =>
    run(async () => {
      if (!window.confirm("제출을 회수할까요? 작성 중 상태로 돌아가며, 수정한 뒤 다시 제출해야 합니다. 회수 기록은 감사로그에 남습니다.")) return;
      await withdrawDailyLogSubmission(supabase, table, logId);
      onChanged();
    });

  const handleCorrection = () =>
    run(async () => {
      await requestDailyLogCorrection(supabase, table, logId, reason);
      setCorrectionOpen(false);
      setReason("");
      setHistory(null);
      onChanged();
    });

  const openHistory = async () => {
    setHistoryError(null);
    try {
      setHistory(await loadDailyLogCorrections(supabase, table, logId));
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    }
  };

  const isCorrectionReview = log.status === "rejected" && String(log.reject_reason ?? "").startsWith("[정정 요청]");

  return (
    <div className="mb-6 space-y-3">
      {access.lockReason && (
        <p className="px-4 py-2 rounded-lg bg-slate-800/80 border border-slate-600 text-slate-300 text-sm">{access.lockReason}</p>
      )}
      {isCorrectionReview && (
        <p className="px-4 py-2 rounded-lg bg-amber-900/20 border border-amber-700/50 text-amber-200 text-sm">
          정정 요청으로 승인이 취소된 일지입니다. 수정 후 다시 제출하면 관리자가 재승인합니다. 정정 전 기록은 보존되어 있습니다.
        </p>
      )}
      {error && !correctionOpen && <p className="text-red-400 text-sm" role="alert">{error}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        {access.canWithdraw && (
          <button
            type="button"
            onClick={handleWithdraw}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white text-sm font-medium"
          >
            제출 회수
          </button>
        )}
        {access.canEdit && (
          <Link href={editHref} className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-sm font-medium">
            수정
          </Link>
        )}
        {access.canDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium"
          >
            {busy ? "처리 중…" : "삭제"}
          </button>
        )}
        {access.canRequestCorrection && (
          <button
            type="button"
            onClick={() => {
              setReason("");
              setCorrectionOpen(true);
            }}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-medium"
          >
            정정 요청
          </button>
        )}
        {access.isAdminLike && history === null && (
          <button
            type="button"
            onClick={openHistory}
            className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
          >
            정정 이력
          </button>
        )}
      </div>

      {historyError && <p className="text-red-400 text-sm">{historyError}</p>}
      {history !== null && (
        <section className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 text-sm">
          <h2 className="font-semibold text-slate-200 mb-3">정정 이력</h2>
          {history.length === 0 ? (
            <p className="text-slate-500">정정 이력이 없습니다.</p>
          ) : (
            <ol className="space-y-4">
              {history.map((c) => {
                const changes = diffDailyLogHeader(c.before_header, log);
                return (
                  <li key={c.id} className="border-t border-slate-700/60 pt-3 first:border-t-0 first:pt-0">
                    <p className="text-slate-300">
                      {formatDt(c.created_at)} · {c.kind === "reopen" ? "승인 취소 후 재검토" : "DB 직접 정정"} ·{" "}
                      요청 {c.requested_by_name ?? "—"}
                      {c.kind !== "reopen" && c.approved_by_name ? ` · 승인 ${c.approved_by_name}` : ""}
                    </p>
                    <p className="text-slate-400 mt-1 whitespace-pre-wrap">사유: {c.reason}</p>
                    {c.before_header && (
                      <p className="text-slate-500 mt-1">
                        정정 전 상태: {String(c.before_header.status ?? "—")}
                        {c.before_header.approved_at ? ` · 승인 ${formatDt(String(c.before_header.approved_at))}` : ""}
                        {c.before_header.approved_by_name ? ` (${String(c.before_header.approved_by_name)})` : ""}
                        {c.before_item_count != null ? ` · 점검 항목 ${c.before_item_count}건` : ""}
                      </p>
                    )}
                    {changes.length > 0 ? (
                      <table className="mt-2 w-full text-xs">
                        <thead>
                          <tr className="text-slate-500 text-left">
                            <th className="py-1 pr-2 font-normal">항목</th>
                            <th className="py-1 pr-2 font-normal">정정 전</th>
                            <th className="py-1 font-normal">현재</th>
                          </tr>
                        </thead>
                        <tbody>
                          {changes.map((change) => (
                            <tr key={change.column} className="align-top border-t border-slate-700/40">
                              <td className="py-1 pr-2 text-slate-400">{change.column}</td>
                              <td className="py-1 pr-2 text-slate-300 break-all">{show(change.before)}</td>
                              <td className="py-1 text-slate-100 break-all">{show(change.after)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      c.before_header && <p className="text-slate-500 mt-1">머리글 내용은 정정 전과 같습니다.</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="text-slate-500 text-xs mt-3">점검 항목별 변경 내역은 감사로그(로그조회)에 변경 전후 값으로 남아 있습니다.</p>
        </section>
      )}

      {correctionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-slate-800 rounded-xl border border-slate-600 shadow-xl max-w-md w-full p-4">
            <h3 className="text-sm font-semibold text-slate-200 mb-2">정정 요청 (승인 취소 후 재검토)</h3>
            <p className="text-xs text-slate-400 mb-3">
              승인을 취소하고 재검토(반려) 상태로 되돌립니다. 정정 전 기록·승인 정보·요청자·사유는 그대로 보존되며, 작성자가 수정 후 다시 제출하면 재승인합니다.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="정정 사유 (5자 이상)"
              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 text-sm resize-none mb-4"
            />
            {error && <p className="text-red-400 text-sm mb-3" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCorrectionOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleCorrection}
                disabled={busy || reason.trim().length < 5}
                className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-medium"
              >
                {busy ? "처리 중…" : "정정 요청"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
