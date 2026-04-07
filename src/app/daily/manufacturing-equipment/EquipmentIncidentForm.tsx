"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  insertEquipmentIncident,
  type EquipmentActionStatus,
  type EquipmentIncidentEquipment,
  type EquipmentIncidentType,
  type EquipmentSymptomType,
} from "@/features/daily/equipmentIncidents";
import { canRegisterEquipmentIncident } from "@/features/daily/equipmentIncidentPermissions";

const EQUIPMENT_OPTIONS: EquipmentIncidentEquipment[] = ["화덕", "호이스트", "기타"];
const INCIDENT_TYPES: EquipmentIncidentType[] = ["이상", "고장", "가동중지"];
const SYMPTOMS: EquipmentSymptomType[] = ["소음", "작동불량", "체인 이상", "버튼 불량", "기타"];
const ACTION_OPTIONS: EquipmentActionStatus[] = ["확인중", "수리요청", "수리중", "조치완료"];

function localDatetimeInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EquipmentIncidentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile, viewOrganizationCode, loading: authLoading } = useAuth();
  const canRegister = canRegisterEquipmentIncident(profile?.role);
  const orgCode = viewOrganizationCode ?? "100";

  const [equipment, setEquipment] = useState<EquipmentIncidentEquipment>("화덕");
  const [equipmentOther, setEquipmentOther] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => localDatetimeInput(new Date().toISOString()));
  const [incidentType, setIncidentType] = useState<EquipmentIncidentType>("이상");
  const [symptomType, setSymptomType] = useState<EquipmentSymptomType>("기타");
  const [symptomOther, setSymptomOther] = useState("");
  const [detail, setDetail] = useState("");
  const [hasProductionImpact, setHasProductionImpact] = useState(false);
  const [actionStatus, setActionStatus] = useState<EquipmentActionStatus>("확인중");
  const [resumedAt, setResumedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [linkedInspectionId, setLinkedInspectionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  useEffect(() => {
    const eq = searchParams.get("equipment");
    if (eq === "화덕" || eq === "호이스트" || eq === "기타") setEquipment(eq);
    const detailPref = searchParams.get("detail");
    if (detailPref) setDetail(decodeURIComponent(detailPref));
    const linked = searchParams.get("linkedLog");
    if (linked) setLinkedInspectionId(linked);
  }, [searchParams]);

  const canSubmit = useMemo(() => {
    if (!detail.trim()) return false;
    if (equipment === "기타" && !equipmentOther.trim()) return false;
    if (symptomType === "기타" && !symptomOther.trim()) return false;
    return true;
  }, [detail, equipment, equipmentOther, symptomType, symptomOther]);

  const handleSubmit = useCallback(async () => {
    if (!canRegister) {
      setToast({ message: "설비 이상 등록은 관리자·매니저 권한에서만 가능합니다.", error: true });
      return;
    }
    if (!canSubmit) {
      setToast({ message: "필수 항목을 입력해 주세요.", error: true });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      const occurredIso = new Date(occurredAt).toISOString();
      const resumedIso = resumedAt.trim() ? new Date(resumedAt).toISOString() : null;
      const { id: newId, error } = await insertEquipmentIncident(supabase, {
        organization_code: orgCode,
        equipment_name: equipment,
        equipment_custom_name: equipment === "기타" ? equipmentOther.trim() : null,
        occurred_at: occurredIso,
        incident_type: incidentType,
        symptom_type: symptomType,
        symptom_other: symptomType === "기타" ? symptomOther.trim() : null,
        detail: detail.trim(),
        has_production_impact: hasProductionImpact,
        action_status: actionStatus,
        resumed_at: resumedIso,
        notes: notes.trim() || null,
        source_type: linkedInspectionId ? "linked_from_inspection" : "manual",
        linked_inspection_id: linkedInspectionId,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      setToast({ message: "등록되었습니다." });
      if (newId) {
        setTimeout(() => router.push(`/daily/manufacturing-equipment/incidents/${newId}`), 500);
      } else {
        setTimeout(() => router.push("/daily/manufacturing-equipment/incidents"), 800);
      }
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSaving(false);
    }
  }, [
    canSubmit,
    orgCode,
    equipment,
    equipmentOther,
    occurredAt,
    incidentType,
    symptomType,
    symptomOther,
    detail,
    hasProductionImpact,
    actionStatus,
    resumedAt,
    notes,
    linkedInspectionId,
    user?.id,
    router,
    canRegister,
  ]);

  const authorHint = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();

  if (authLoading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-6">
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      </div>
    );
  }

  if (profile && !canRegister) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-xl mx-auto pb-24 md:pb-8">
        <p className="text-slate-200 text-sm mb-4">
          설비 이상 등록은 관리자·매니저 권한에서만 가능합니다.
        </p>
        <Link
          href="/daily/manufacturing-equipment"
          className="text-cyan-400 hover:text-cyan-300 text-sm font-medium"
        >
          제조설비 점검표로 돌아가기
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-xl mx-auto pb-24 md:pb-8">
      <div className="flex items-center gap-2 mb-4 text-sm">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200">
          데일리
        </Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/manufacturing-equipment" className="text-slate-400 hover:text-slate-200">
          제조설비 점검표
        </Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/manufacturing-equipment/incidents" className="text-slate-400 hover:text-slate-200">
          설비 이상 이력
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">등록</span>
      </div>

      <h1 className="text-lg font-semibold text-slate-100 mb-1">설비 이상 등록</h1>
      <p className="text-slate-500 text-sm mb-6">
        실제 고장·가동중지·현장 이상을 정기 점검과 별도로 기록합니다. 등록자: {authorHint || "—"}
      </p>

      {toast && (
        <div
          className={`mb-4 px-4 py-2 rounded-lg text-sm ${
            toast.error ? "bg-red-900/30 text-red-200" : "bg-cyan-900/30 text-cyan-200"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="space-y-5 rounded-xl border border-slate-700/60 bg-slate-800/50 p-5">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">설비명</label>
          <select
            value={equipment}
            onChange={(e) => setEquipment(e.target.value as EquipmentIncidentEquipment)}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100"
          >
            {EQUIPMENT_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {equipment === "기타" && (
            <input
              type="text"
              value={equipmentOther}
              onChange={(e) => setEquipmentOther(e.target.value)}
              placeholder="설비명 입력"
              className="mt-2 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">발생일시</label>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">구분</label>
          <div className="flex flex-wrap gap-2">
            {INCIDENT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setIncidentType(t)}
                className={`px-3 py-1.5 rounded-lg text-sm border ${
                  incidentType === t
                    ? "bg-amber-600/80 border-amber-500 text-white"
                    : "bg-slate-800 border-slate-600 text-slate-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">증상·유형</label>
          <select
            value={symptomType}
            onChange={(e) => setSymptomType(e.target.value as EquipmentSymptomType)}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100"
          >
            {SYMPTOMS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {symptomType === "기타" && (
            <input
              type="text"
              value={symptomOther}
              onChange={(e) => setSymptomOther(e.target.value)}
              placeholder="증상 설명"
              className="mt-2 w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">상세내용</label>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-y min-h-[100px]"
          />
        </div>

        <div>
          <span className="block text-sm font-medium text-slate-400 mb-2">생산영향 여부</span>
          <label className="flex items-center gap-2 text-slate-300 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={hasProductionImpact}
              onChange={(e) => setHasProductionImpact(e.target.checked)}
              className="rounded border-slate-500"
            />
            생산에 영향 있음
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">조치상태</label>
          <select
            value={actionStatus}
            onChange={(e) => setActionStatus(e.target.value as EquipmentActionStatus)}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100"
          >
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">재가동일시 (선택)</label>
          <input
            type="datetime-local"
            value={resumedAt}
            onChange={(e) => setResumedAt(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">비고 (선택)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
          />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 justify-end">
        <Link
          href="/daily/manufacturing-equipment"
          className="px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
        >
          취소
        </Link>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !canSubmit}
          className="px-6 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium text-sm"
        >
          {saving ? "저장 중…" : "등록"}
        </button>
      </div>
    </div>
  );
}
