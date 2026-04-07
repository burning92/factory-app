"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { formatEquipmentMasterListLabel } from "@/features/equipment/equipmentDisplay";
import { isEquipmentSelectableForHistory } from "@/features/equipment/equipmentConstants";
import { canWriteEquipmentHistory } from "@/features/equipment/equipmentHistoryPermissions";
import type { EquipmentHistoryRecordRow, EquipmentMasterRow } from "@/features/equipment/equipmentTypes";

const fieldClass =
  "w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500";

export default function EquipmentHistoryEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id ?? "");
  const { profile, user, viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const canWrite = canWriteEquipmentHistory(profile?.role);

  const [record, setRecord] = useState<EquipmentHistoryRecordRow | null>(null);
  const [masters, setMasters] = useState<EquipmentMasterRow[]>([]);
  const [includeNonOperating, setIncludeNonOperating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [equipmentId, setEquipmentId] = useState("");
  const [recordDate, setRecordDate] = useState("");
  const [issueDetail, setIssueDetail] = useState("");
  const [emergencyAction, setEmergencyAction] = useState("");
  const [repairDetail, setRepairDetail] = useState("");
  const [notes, setNotes] = useState("");
  const [closureStatus, setClosureStatus] = useState<"ongoing" | "closed">("ongoing");

  const load = useCallback(async () => {
    if (!id || !canWrite) return;
    setLoading(true);
    setErr(null);
    const { data: rec, error: re } = await supabase
      .from("equipment_history_records")
      .select("*, equipment_master(*)")
      .eq("id", id)
      .maybeSingle();
    if (re || !rec || (rec as { organization_code: string }).organization_code !== orgCode) {
      setLoading(false);
      setRecord(null);
      if (re) setErr(re.message);
      return;
    }
    const r = rec as EquipmentHistoryRecordRow;
    setRecord(r);
    setEquipmentId(r.equipment_id);
    setRecordDate(r.record_date);
    setIssueDetail(r.issue_detail);
    setEmergencyAction(r.emergency_action ?? "");
    setRepairDetail(r.repair_detail ?? "");
    setNotes(r.notes ?? "");
    setClosureStatus(r.closure_status);

    const { data: ms, error: me } = await supabase
      .from("equipment_master")
      .select("*")
      .eq("organization_code", orgCode)
      .order("management_no");
    setLoading(false);
    if (me) {
      setErr(me.message);
      return;
    }
    let list = (ms ?? []) as EquipmentMasterRow[];
    if (!includeNonOperating) {
      list = list.filter((m) => m.id === r.equipment_id || isEquipmentSelectableForHistory(m));
    }
    setMasters(list);
  }, [id, orgCode, canWrite, includeNonOperating]);

  useEffect(() => {
    if (!canWrite) {
      router.replace(`/daily/equipment-history/${id}`);
      return;
    }
    load();
  }, [canWrite, load, router, id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!record) return;
    const issue = issueDetail.trim();
    if (!equipmentId || !issue) {
      setErr("설비와 고장내용은 필수입니다.");
      return;
    }
    setSaving(true);
    setErr(null);
    const { error } = await supabase
      .from("equipment_history_records")
      .update({
        equipment_id: equipmentId,
        record_date: recordDate,
        issue_detail: issue,
        emergency_action: emergencyAction.trim() || null,
        repair_detail: repairDetail.trim() || null,
        notes: notes.trim() || null,
        closure_status: closureStatus,
        updated_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      })
      .eq("id", record.id);
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.replace(`/daily/equipment-history/${record.id}`);
  }

  if (!canWrite) {
    return null;
  }
  if (loading || !record) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-slate-500 text-sm">{loading ? "불러오는 중…" : "이력을 찾을 수 없습니다."}</p>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto pb-24 md:pb-8">
      <Link href={`/daily/equipment-history/${id}`} className="text-sm text-slate-500 hover:text-slate-300">
        ← 상세
      </Link>
      <h1 className="text-lg font-semibold text-slate-100 mt-2 mb-4">이력 수정</h1>

      {err && (
        <p className="mb-3 text-sm text-red-400" role="alert">
          {err}
        </p>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-400 mb-4">
        <input
          type="checkbox"
          checked={includeNonOperating}
          onChange={(e) => setIncludeNonOperating(e.target.checked)}
          className="rounded border-slate-600 bg-space-900"
        />
        운영중·예비 외 설비 포함 (사용중지·철거 등)
      </label>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">설비</label>
          <select className={fieldClass} value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)} required>
            <option value="">선택</option>
            {masters.map((m) => {
              const ls = m.lifecycle_status ?? (m.is_active ? "운영중" : "미운영");
              return (
                <option key={m.id} value={m.id}>
                  {formatEquipmentMasterListLabel(m)}
                  {!isEquipmentSelectableForHistory(m) ? ` (${ls})` : ""}
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">일자</label>
          <input type="date" className={fieldClass} value={recordDate} onChange={(e) => setRecordDate(e.target.value)} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">고장내용</label>
          <textarea className={`${fieldClass} min-h-[100px]`} value={issueDetail} onChange={(e) => setIssueDetail(e.target.value)} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">응급조치</label>
          <textarea className={`${fieldClass} min-h-[72px]`} value={emergencyAction} onChange={(e) => setEmergencyAction(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">수리내역</label>
          <textarea className={`${fieldClass} min-h-[72px]`} value={repairDetail} onChange={(e) => setRepairDetail(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">비고</label>
          <textarea className={`${fieldClass} min-h-[56px]`} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">처리 상태</label>
          <select
            className={fieldClass}
            value={closureStatus}
            onChange={(e) => setClosureStatus(e.target.value as "ongoing" | "closed")}
          >
            <option value="ongoing">진행 중</option>
            <option value="closed">완료</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400 disabled:opacity-50"
          >
            저장
          </button>
          <Link
            href={`/daily/equipment-history/${id}`}
            className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-800"
          >
            취소
          </Link>
        </div>
      </form>
    </div>
  );
}
