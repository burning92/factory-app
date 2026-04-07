"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type EquipmentActionStatus,
  type EquipmentIncidentEquipment,
  type EquipmentIncidentRow,
  type EquipmentIncidentType,
  type EquipmentSymptomType,
} from "@/features/daily/equipmentIncidents";
import { patchEquipmentIncidentApi } from "@/features/daily/equipmentIncidentApi";

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

type Props = {
  row: EquipmentIncidentRow;
  organizationCode: string;
};

export function EquipmentIncidentEditForm({ row, organizationCode }: Props) {
  const router = useRouter();
  const isLinked = row.source_type === "linked_from_inspection";

  const [equipment, setEquipment] = useState<EquipmentIncidentEquipment>(row.equipment_name);
  const [equipmentOther, setEquipmentOther] = useState(row.equipment_custom_name ?? "");
  const [occurredAt, setOccurredAt] = useState(() => localDatetimeInput(row.occurred_at));
  const [incidentType, setIncidentType] = useState<EquipmentIncidentType>(row.incident_type);
  const [symptomType, setSymptomType] = useState<EquipmentSymptomType>(row.symptom_type);
  const [symptomOther, setSymptomOther] = useState(row.symptom_other ?? "");
  const [detail, setDetail] = useState(row.detail);
  const [hasProductionImpact, setHasProductionImpact] = useState(row.has_production_impact);
  const [actionStatus, setActionStatus] = useState<EquipmentActionStatus>(row.action_status);
  const [resumedAt, setResumedAt] = useState(row.resumed_at ? localDatetimeInput(row.resumed_at) : "");
  const [notes, setNotes] = useState(row.notes ?? "");

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  const canSubmitManual = useMemo(() => {
    if (!detail.trim()) return false;
    if (equipment === "기타" && !equipmentOther.trim()) return false;
    if (symptomType === "기타" && !symptomOther.trim()) return false;
    return true;
  }, [detail, equipment, equipmentOther, symptomType, symptomOther]);

  const handleSubmit = useCallback(async () => {
    setSaving(true);
    setToast(null);
    try {
      if (isLinked) {
        await patchEquipmentIncidentApi(row.id, organizationCode, {
          has_production_impact: hasProductionImpact,
          action_status: actionStatus,
          resumed_at: resumedAt.trim() ? new Date(resumedAt).toISOString() : null,
          notes: notes.trim() || null,
        });
      } else {
        if (!canSubmitManual) {
          setToast({ message: "필수 항목을 입력해 주세요.", error: true });
          setSaving(false);
          return;
        }
        await patchEquipmentIncidentApi(row.id, organizationCode, {
          equipment_name: equipment,
          equipment_custom_name: equipment === "기타" ? equipmentOther.trim() : null,
          occurred_at: new Date(occurredAt).toISOString(),
          incident_type: incidentType,
          symptom_type: symptomType,
          symptom_other: symptomType === "기타" ? symptomOther.trim() : null,
          detail: detail.trim(),
          has_production_impact: hasProductionImpact,
          action_status: actionStatus,
          resumed_at: resumedAt.trim() ? new Date(resumedAt).toISOString() : null,
          notes: notes.trim() || null,
        });
      }
      setToast({ message: "저장되었습니다." });
      setTimeout(() => router.push(`/daily/manufacturing-equipment/incidents/${row.id}`), 600);
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSaving(false);
    }
  }, [
    isLinked,
    row.id,
    organizationCode,
    hasProductionImpact,
    actionStatus,
    resumedAt,
    notes,
    canSubmitManual,
    equipment,
    equipmentOther,
    occurredAt,
    incidentType,
    symptomType,
    symptomOther,
    detail,
    router,
  ]);

  const equipReadonly =
    row.equipment_name === "기타" && row.equipment_custom_name
      ? `기타 (${row.equipment_custom_name})`
      : row.equipment_name;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-xl mx-auto pb-24 md:pb-8">
      <div className="flex items-center gap-2 mb-4 text-sm">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200">
          데일리
        </Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/manufacturing-equipment/incidents" className="text-slate-400 hover:text-slate-200">
          설비 이상 이력
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">수정</span>
      </div>

      <h1 className="text-lg font-semibold text-slate-100 mb-1">설비 이상 수정</h1>
      <p className="text-slate-500 text-sm mb-4">
        {isLinked ? "점검표 연동 건은 조치·재가동·비고만 수정할 수 있습니다." : "직접 등록 건은 전체 항목을 수정할 수 있습니다."}
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

      {isLinked && (
        <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/95 space-y-1">
          <p>이 기록은 제조설비 점검표에서 연동 생성된 항목입니다.</p>
          <p className="text-amber-200/85">
            원본 점검 내용은 수정할 수 없으며, 조치상태·재가동·비고만 수정할 수 있습니다.
          </p>
        </div>
      )}

      <div className="space-y-5 rounded-xl border border-slate-700/60 bg-slate-800/50 p-5">
        {isLinked ? (
          <>
            <div className="rounded-lg bg-slate-900/50 border border-slate-700/50 p-3 space-y-2 text-sm">
              <p className="text-slate-500 text-xs">수정 불가 (읽기 전용)</p>
              <p className="text-slate-200">
                <span className="text-slate-500">설비명 · </span>
                {equipReadonly}
              </p>
              <p className="text-slate-200">
                <span className="text-slate-500">발생일시 · </span>
                {new Date(row.occurred_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}
              </p>
              <p className="text-slate-200">
                <span className="text-slate-500">구분 · </span>
                {row.incident_type}
              </p>
              <p className="text-slate-200 whitespace-pre-wrap">
                <span className="text-slate-500">증상·유형 · </span>
                {row.symptom_type === "기타" && row.symptom_other
                  ? `${row.symptom_type} (${row.symptom_other})`
                  : row.symptom_type}
              </p>
              <p className="text-slate-200 whitespace-pre-wrap">
                <span className="text-slate-500">상세내용 · </span>
                {row.detail}
              </p>
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
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
              />
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-2 justify-end">
        <Link
          href={`/daily/manufacturing-equipment/incidents/${row.id}`}
          className="px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
        >
          취소
        </Link>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || (!isLinked && !canSubmitManual)}
          className="px-6 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium text-sm"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}
