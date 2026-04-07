"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { formatEquipmentMasterListLabel } from "@/features/equipment/equipmentDisplay";
import {
  canDeleteEquipmentHistoryRecord,
  canDeleteEquipmentHistoryUpdate,
  canWriteEquipmentHistory,
} from "@/features/equipment/equipmentHistoryPermissions";
import { deleteEquipmentHistoryRecord, deleteEquipmentHistoryUpdate } from "@/features/equipment/equipmentHistoryMutations";
import type { EquipmentHistoryRecordRow, EquipmentHistoryUpdateRow, EquipmentMasterRow } from "@/features/equipment/equipmentTypes";

const fieldClass =
  "w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500";

export default function EquipmentHistoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");
  const { profile, user, viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const canWrite = canWriteEquipmentHistory(profile?.role);
  const canDelRecord = canDeleteEquipmentHistoryRecord(profile?.role);
  const canDelUpdate = canDeleteEquipmentHistoryUpdate(profile?.role);

  const [record, setRecord] = useState<EquipmentHistoryRecordRow | null>(null);
  const [updates, setUpdates] = useState<EquipmentHistoryUpdateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [deletingRecord, setDeletingRecord] = useState(false);
  const [deletingUpdateId, setDeletingUpdateId] = useState<string | null>(null);

  const [resultDate, setResultDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [resultDetail, setResultDetail] = useState("");
  const [assignee, setAssignee] = useState("");
  const [upNotes, setUpNotes] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    const { data: rec, error: re } = await supabase
      .from("equipment_history_records")
      .select("*, equipment_master(*)")
      .eq("id", id)
      .maybeSingle();
    if (re) {
      setLoading(false);
      setErr(re.message);
      return;
    }
    if (!rec || (rec as { organization_code: string }).organization_code !== orgCode) {
      setLoading(false);
      setRecord(null);
      return;
    }
    setRecord(rec as EquipmentHistoryRecordRow);
    const { data: ups, error: ue } = await supabase
      .from("equipment_history_updates")
      .select("*")
      .eq("history_record_id", id)
      .order("result_date", { ascending: false })
      .order("created_at", { ascending: false });
    setLoading(false);
    if (ue) {
      setErr(ue.message);
      return;
    }
    setUpdates((ups ?? []) as EquipmentHistoryUpdateRow[]);
  }, [id, orgCode]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddResult(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite || !record) return;
    const detail = resultDetail.trim();
    if (!detail) {
      setErr("조치내용·결과내용을 입력하세요.");
      return;
    }
    const authorName = profile?.display_name?.trim() || profile?.login_id || "";
    setAdding(true);
    setErr(null);
    const { error } = await supabase.from("equipment_history_updates").insert({
      history_record_id: record.id,
      result_date: resultDate,
      result_detail: detail,
      assignee: assignee.trim() || null,
      notes: upNotes.trim() || null,
      created_by: user?.id ?? null,
      created_by_name: authorName || null,
      updated_at: new Date().toISOString(),
    });
    setAdding(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setResultDetail("");
    setAssignee("");
    setUpNotes("");
    setResultDate(new Date().toISOString().slice(0, 10));
    load();
  }

  async function setClosure(next: "ongoing" | "closed") {
    if (!canWrite || !record) return;
    setErr(null);
    const { error } = await supabase
      .from("equipment_history_records")
      .update({ closure_status: next, updated_at: new Date().toISOString(), updated_by: user?.id ?? null })
      .eq("id", record.id);
    if (error) {
      setErr(error.message);
      return;
    }
    load();
  }

  async function handleDeleteRecord() {
    if (!record || !canDelRecord) {
      setToast({ message: "삭제 권한이 없습니다.", error: true });
      return;
    }
    const ok = window.confirm(
      "이 설비 이력을 삭제하시겠습니까?\n\n삭제하면 초기 기록과 연결된 결과 이력이 함께 삭제됩니다."
    );
    if (!ok) return;
    setDeletingRecord(true);
    setErr(null);
    const { data: { session } } = await supabase.auth.getSession();
    const result = await deleteEquipmentHistoryRecord(record.id, session);
    setDeletingRecord(false);
    if ("error" in result) {
      setErr(result.error);
      setToast({ message: result.error, error: true });
      return;
    }
    router.replace("/daily/equipment-history?deleted=1");
  }

  async function handleDeleteUpdate(updateId: string) {
    if (!canDelUpdate) {
      setToast({ message: "삭제 권한이 없습니다.", error: true });
      return;
    }
    const ok = window.confirm("이 결과 이력을 삭제하시겠습니까?");
    if (!ok) return;
    setDeletingUpdateId(updateId);
    setErr(null);
    const { data: { session } } = await supabase.auth.getSession();
    const result = await deleteEquipmentHistoryUpdate(updateId, session);
    setDeletingUpdateId(null);
    if ("error" in result) {
      setErr(result.error);
      setToast({ message: result.error, error: true });
      return;
    }
    setToast({ message: "결과 이력이 삭제되었습니다." });
    load();
  }

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      </div>
    );
  }
  if (!record) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <p className="text-red-400 text-sm">이력을 찾을 수 없습니다.</p>
        <Link href="/daily/equipment-history" className="text-cyan-400 text-sm mt-2 inline-block">
          목록으로
        </Link>
      </div>
    );
  }

  const m = record.equipment_master as EquipmentMasterRow | null | undefined;
  const label = m ? formatEquipmentMasterListLabel(m) : record.equipment_id;

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-4 md:p-6 max-w-3xl mx-auto pb-28 md:pb-10">
      <Link href="/daily/equipment-history" className="text-sm text-slate-500 hover:text-slate-300">
        ← 목록
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-2 mt-2 mb-4">
        <h1 className="text-lg font-semibold text-slate-100">이력 상세</h1>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite && (
            <Link
              href={`/daily/equipment-history/${record.id}/edit`}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 hover:border-slate-500 transition-colors"
            >
              수정
            </Link>
          )}
          {canDelRecord && (
            <button
              type="button"
              onClick={() => void handleDeleteRecord()}
              disabled={deletingRecord}
              className="rounded-lg border border-red-500/35 bg-red-950/20 px-3 py-1.5 text-sm font-medium text-red-200/95 hover:bg-red-950/40 disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
            >
              {deletingRecord ? "삭제 중…" : "삭제"}
            </button>
          )}
        </div>
      </div>

      {toast && (
        <div
          className={`mb-3 px-4 py-2 rounded-lg text-sm ${
            toast.error ? "bg-red-900/30 text-red-200 border border-red-500/30" : "bg-emerald-950/40 text-emerald-100 border border-emerald-500/25"
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}

      {err && (
        <p className="mb-3 text-sm text-red-400" role="alert">
          {err}
        </p>
      )}

      <section className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4 mb-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">설비 정보</h2>
        {m && (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">관리번호</dt>
              <dd className="text-slate-100 font-mono">{m.management_no}</dd>
            </div>
            <div>
              <dt className="text-slate-500">설비명</dt>
              <dd className="text-slate-100">{m.equipment_name}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">표시</dt>
              <dd className="text-slate-200">{label}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">설치장소</dt>
              <dd className="text-slate-200">{m.install_location}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">용도</dt>
              <dd className="text-slate-200 whitespace-pre-wrap">{m.purpose}</dd>
            </div>
          </dl>
        )}
        {!m && <p className="text-slate-500 text-sm">설비 마스터 정보를 불러오지 못했습니다.</p>}
      </section>

      <section className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-300">초기 기록</h2>
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${record.closure_status === "closed" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-200"}`}>
            {record.closure_status === "closed" ? "완료" : "진행 중"}
          </span>
        </div>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-slate-500">일자</dt>
            <dd className="text-slate-200 tabular-nums">{record.record_date}</dd>
          </div>
          <div>
            <dt className="text-slate-500">고장내용</dt>
            <dd className="text-slate-200 whitespace-pre-wrap">{record.issue_detail}</dd>
          </div>
          <div>
            <dt className="text-slate-500">응급조치</dt>
            <dd className="text-slate-300 whitespace-pre-wrap">{record.emergency_action ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">수리내역</dt>
            <dd className="text-slate-300 whitespace-pre-wrap">{record.repair_detail ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">비고</dt>
            <dd className="text-slate-300 whitespace-pre-wrap">{record.notes ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">작성</dt>
            <dd className="text-slate-400">
              {record.created_by_name ?? "—"} ·{" "}
              <span className="tabular-nums">{new Date(record.created_at).toLocaleString("ko-KR")}</span>
            </dd>
          </div>
        </dl>
        {canWrite && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-700/50">
            {record.closure_status === "ongoing" ? (
              <button
                type="button"
                onClick={() => setClosure("closed")}
                className="text-xs rounded-lg border border-emerald-500/40 px-3 py-1.5 text-emerald-200 hover:bg-emerald-950/30"
              >
                처리 완료로 표시
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setClosure("ongoing")}
                className="text-xs rounded-lg border border-amber-500/40 px-3 py-1.5 text-amber-200 hover:bg-amber-950/30"
              >
                진행 중으로 되돌리기
              </button>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4 mb-4">
        <h2 className="text-sm font-semibold text-slate-300 mb-3">결과 이력</h2>
        {updates.length === 0 ? (
          <p className="text-slate-500 text-sm">등록된 결과가 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {updates.map((u) => (
              <li key={u.id} className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-slate-400 text-xs tabular-nums">
                      {u.result_date}
                      {u.assignee ? ` · 담당 ${u.assignee}` : ""}
                    </p>
                    <p className="text-slate-100 mt-1 whitespace-pre-wrap">{u.result_detail}</p>
                    {u.notes && <p className="text-slate-500 mt-1 text-xs whitespace-pre-wrap">비고: {u.notes}</p>}
                    <p className="text-slate-600 text-xs mt-2">
                      {u.created_by_name ?? "—"} ·{" "}
                      <span className="tabular-nums">{new Date(u.created_at).toLocaleString("ko-KR")}</span>
                    </p>
                  </div>
                  {canDelUpdate && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteUpdate(u.id)}
                      disabled={deletingUpdateId === u.id}
                      className="shrink-0 rounded-md border border-red-500/30 px-2 py-1 text-xs font-medium text-red-300/95 hover:bg-red-950/35 disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                    >
                      {deletingUpdateId === u.id ? "…" : "삭제"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWrite && (
        <section className="rounded-xl border border-cyan-500/25 bg-cyan-950/15 p-4">
          <h2 className="text-sm font-semibold text-cyan-200/90 mb-3">결과 추가</h2>
          <p className="text-xs text-slate-500 mb-3">
            예: 업체 방문 및 점검, 부품 교체, 임시 복구, 정상 가동 확인, 최종 조치 완료
          </p>
          <form onSubmit={handleAddResult} className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">결과일자</label>
              <input type="date" className={fieldClass} value={resultDate} onChange={(e) => setResultDate(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">조치내용·결과내용 (필수)</label>
              <textarea
                className={`${fieldClass} min-h-[88px]`}
                value={resultDetail}
                onChange={(e) => setResultDetail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">담당자 (선택)</label>
              <input className={fieldClass} value={assignee} onChange={(e) => setAssignee(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">비고 (선택)</label>
              <textarea className={`${fieldClass} min-h-[56px]`} value={upNotes} onChange={(e) => setUpNotes(e.target.value)} />
            </div>
            <button
              type="submit"
              disabled={adding}
              className="w-full sm:w-auto px-4 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400 disabled:opacity-50"
            >
              결과 추가
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
