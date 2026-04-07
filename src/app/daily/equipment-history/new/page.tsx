"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { formatEquipmentMasterListLabel } from "@/features/equipment/equipmentDisplay";
import { isEquipmentSelectableForHistory } from "@/features/equipment/equipmentConstants";
import { canWriteEquipmentHistory } from "@/features/equipment/equipmentHistoryPermissions";
import type { EquipmentMasterRow } from "@/features/equipment/equipmentTypes";

const fieldClass =
  "w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500";

export default function EquipmentHistoryNewPage() {
  const router = useRouter();
  const { profile, user, viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const canWrite = canWriteEquipmentHistory(profile?.role);

  const [masters, setMasters] = useState<EquipmentMasterRow[]>([]);
  /** 운영중·예비 외(사용중지·철거 등) 포함 */
  const [includeNonOperating, setIncludeNonOperating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [equipmentId, setEquipmentId] = useState("");
  const [recordDate, setRecordDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [issueDetail, setIssueDetail] = useState("");
  const [emergencyAction, setEmergencyAction] = useState("");
  const [repairDetail, setRepairDetail] = useState("");
  const [notes, setNotes] = useState("");

  const loadMasters = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("equipment_master")
      .select("*")
      .eq("organization_code", orgCode)
      .order("management_no");
    setLoading(false);
    if (error) {
      setErr(error.message);
      return;
    }
    let list = (data ?? []) as EquipmentMasterRow[];
    if (!includeNonOperating) {
      list = list.filter((m) => isEquipmentSelectableForHistory(m));
    }
    setMasters(list);
  }, [orgCode, includeNonOperating]);

  useEffect(() => {
    if (!canWrite) return;
    loadMasters();
  }, [canWrite, loadMasters]);

  useEffect(() => {
    if (!canWrite) router.replace("/daily/equipment-history");
  }, [canWrite, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!equipmentId) {
      setErr("설비를 선택하세요.");
      return;
    }
    const issue = issueDetail.trim();
    if (!issue) {
      setErr("고장내용을 입력하세요.");
      return;
    }
    const authorName = profile?.display_name?.trim() || profile?.login_id || "";
    setSaving(true);
    const { data, error } = await supabase
      .from("equipment_history_records")
      .insert({
        organization_code: orgCode,
        equipment_id: equipmentId,
        record_date: recordDate,
        issue_detail: issue,
        emergency_action: emergencyAction.trim() || null,
        repair_detail: repairDetail.trim() || null,
        notes: notes.trim() || null,
        closure_status: "ongoing",
        created_by: user?.id ?? null,
        created_by_name: authorName || null,
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.replace(`/daily/equipment-history/${data.id}`);
  }

  if (!canWrite) {
    return null;
  }

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto pb-24 md:pb-8">
      <Link href="/daily/equipment-history" className="text-sm text-slate-500 hover:text-slate-300">
        ← 목록
      </Link>
      <h1 className="text-lg font-semibold text-slate-100 mt-2 mb-4">새 이력 작성</h1>

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

      {loading ? (
        <p className="text-slate-500 text-sm">설비 목록 불러오는 중…</p>
      ) : masters.length === 0 ? (
        <p className="text-slate-500 text-sm">
          선택 가능한 설비가 없습니다. 관리자에게 제조설비등록을 요청하세요.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">설비 (필수)</label>
            <select
              className={fieldClass}
              value={equipmentId}
              onChange={(e) => setEquipmentId(e.target.value)}
              required
            >
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
            <label className="block text-xs font-medium text-slate-400 mb-1">일자 (필수)</label>
            <input type="date" className={fieldClass} value={recordDate} onChange={(e) => setRecordDate(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">고장내용 (필수)</label>
            <textarea
              className={`${fieldClass} min-h-[100px]`}
              value={issueDetail}
              onChange={(e) => setIssueDetail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">응급조치 (선택)</label>
            <textarea className={`${fieldClass} min-h-[72px]`} value={emergencyAction} onChange={(e) => setEmergencyAction(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">수리내역 (선택)</label>
            <textarea className={`${fieldClass} min-h-[72px]`} value={repairDetail} onChange={(e) => setRepairDetail(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">비고 (선택)</label>
            <textarea className={`${fieldClass} min-h-[56px]`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400 disabled:opacity-50"
            >
              저장
            </button>
            <Link href="/daily/equipment-history" className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-800">
              취소
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
