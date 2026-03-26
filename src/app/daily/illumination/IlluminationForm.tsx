"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  ILLUMINATION_CHECKLIST,
  conformityFromLux,
  parseLux,
} from "@/features/daily/illuminationChecklist";

type LogStatus = "draft" | "submitted" | "approved" | "rejected";

type CorrectiveState = {
  datetime: string;
  deviation: string;
  detail: string;
  remarks: string;
  actor: string;
};

type Props = {
  mode: "new" | "edit";
  editLogId?: string;
};

function todayDateString(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function syncDateToDatetimeLocal(existing: string, date: string): string {
  if (!date) return existing;
  const timePart = existing.includes("T") ? existing.slice(11, 16) : "00:00";
  const safeTime = timePart.length === 5 ? timePart : "00:00";
  return `${date}T${safeTime}`;
}

function localInputToIso(value: string): string {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function statusLabel(status: LogStatus | null): string {
  if (status === "draft") return "작성 중";
  if (status === "submitted") return "제출 완료";
  if (status === "approved") return "승인 완료";
  if (status === "rejected") return "반려";
  return "-";
}

export function IlluminationForm({ mode, editLogId }: Props) {
  const { user, profile, viewOrganizationCode } = useAuth();
  const [inspectionDate, setInspectionDate] = useState(todayDateString);
  const [luxByIndex, setLuxByIndex] = useState<Record<number, string>>({});
  const [corrective, setCorrective] = useState<CorrectiveState>({
    datetime: "",
    deviation: "",
    detail: "",
    remarks: "",
    actor: "",
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [currentLogId, setCurrentLogId] = useState<string | null>(null);
  const [currentLogStatus, setCurrentLogStatus] = useState<LogStatus | null>(null);
  const [loadDone, setLoadDone] = useState(mode === "new");
  const [deviationManuallyEdited, setDeviationManuallyEdited] = useState(false);
  const [correctiveDatetimeManuallyEdited, setCorrectiveDatetimeManuallyEdited] = useState(false);

  const orgCode = viewOrganizationCode ?? "100";
  const inspectorName = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();

  const evaluatedRows = useMemo(() => {
    return ILLUMINATION_CHECKLIST.map((item) => {
      const measuredLux = parseLux(luxByIndex[item.index] ?? "");
      const conformity = conformityFromLux(measuredLux, item.minLux);
      return { ...item, measuredLux, conformity };
    });
  }, [luxByIndex]);

  const hasAnyNonConform = evaluatedRows.some((row) => row.conformity === "X");
  const hasAnyMissingLux = evaluatedRows.some((row) => row.measuredLux == null);

  const autoDeviationText = useMemo(() => {
    const lines: string[] = [];
    evaluatedRows.forEach((row) => {
      if (row.conformity === "X") {
        const measured = row.measuredLux == null ? "미입력" : `${row.measuredLux} lx`;
        lines.push(`${row.label} (기준 ${row.minLux} lx / 실측 ${measured})`);
      }
    });
    return lines.join("\n");
  }, [evaluatedRows]);

  useEffect(() => {
    if (mode === "new" && inspectorName) {
      setCorrective((prev) => ({ ...prev, actor: prev.actor || inspectorName }));
    }
  }, [mode, inspectorName]);

  useEffect(() => {
    if (hasAnyNonConform && !deviationManuallyEdited) {
      setCorrective((prev) => ({ ...prev, deviation: autoDeviationText }));
    }
    if (!hasAnyNonConform) {
      setCorrective((prev) => ({ ...prev, deviation: "" }));
      setDeviationManuallyEdited(false);
      setCorrectiveDatetimeManuallyEdited(false);
    }
  }, [hasAnyNonConform, deviationManuallyEdited, autoDeviationText]);

  useEffect(() => {
    if (!hasAnyNonConform || !inspectionDate || correctiveDatetimeManuallyEdited) return;
    setCorrective((prev) => {
      const next = syncDateToDatetimeLocal(prev.datetime, inspectionDate);
      if (next === prev.datetime) return prev;
      return { ...prev, datetime: next };
    });
  }, [hasAnyNonConform, inspectionDate, correctiveDatetimeManuallyEdited]);

  useEffect(() => {
    if (mode !== "edit" || !editLogId) {
      setLoadDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: logData, error: logErr } = await supabase
        .from("daily_illumination_logs")
        .select(
          "id, inspection_date, inspected_at, status, corrective_datetime, corrective_deviation, corrective_detail, corrective_remarks, corrective_actor"
        )
        .eq("id", editLogId)
        .maybeSingle();
      if (cancelled || logErr) {
        if (!cancelled) setToast({ message: logErr?.message ?? "일지를 불러올 수 없습니다.", error: true });
        setLoadDone(true);
        return;
      }
      if (!logData) {
        setToast({ message: "일지를 찾을 수 없습니다.", error: true });
        setLoadDone(true);
        return;
      }
      const log = logData as {
        id: string;
        inspection_date: string | null;
        inspected_at: string | null;
        status: LogStatus;
        corrective_datetime: string | null;
        corrective_deviation: string | null;
        corrective_detail: string | null;
        corrective_remarks: string | null;
        corrective_actor: string | null;
      };
      setCurrentLogId(log.id);
      setCurrentLogStatus(log.status);
      if (log.inspection_date) setInspectionDate(log.inspection_date);
      else if (log.inspected_at) setInspectionDate(log.inspected_at.slice(0, 10));
      setCorrective({
        datetime: log.corrective_datetime ? log.corrective_datetime.slice(0, 16) : "",
        deviation: log.corrective_deviation ?? "",
        detail: log.corrective_detail ?? "",
        remarks: log.corrective_remarks ?? "",
        actor: log.corrective_actor ?? inspectorName,
      });
      setCorrectiveDatetimeManuallyEdited(Boolean(log.corrective_datetime));

      const { data: itemData } = await supabase
        .from("daily_illumination_log_items")
        .select("item_index, measured_lux")
        .eq("log_id", log.id)
        .order("item_index", { ascending: true });
      if (cancelled) return;
      const next: Record<number, string> = {};
      (itemData ?? []).forEach((row: { item_index: number; measured_lux: number | null }) => {
        next[row.item_index] = row.measured_lux == null ? "" : String(row.measured_lux);
      });
      setLuxByIndex(next);
      setLoadDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, editLogId, inspectorName]);

  const persistItems = useCallback(async (logId: string) => {
    const rows = evaluatedRows.map((row) => ({
      log_id: logId,
      item_index: row.index,
      item_label: row.label,
      min_lux: row.minLux,
      measured_lux: row.measuredLux,
      conformity: row.conformity,
    }));
    const { error: delErr } = await supabase.from("daily_illumination_log_items").delete().eq("log_id", logId);
    if (delErr) throw delErr;
    const { error: insErr } = await supabase.from("daily_illumination_log_items").insert(rows);
    if (insErr) throw insErr;
  }, [evaluatedRows]);

  const correctivePayload = useMemo(() => {
    if (!hasAnyNonConform) {
      return {
        corrective_datetime: null as string | null,
        corrective_deviation: null as string | null,
        corrective_detail: null as string | null,
        corrective_remarks: null as string | null,
        corrective_actor: null as string | null,
      };
    }
    return {
      corrective_datetime: corrective.datetime ? localInputToIso(corrective.datetime) : null,
      corrective_deviation: corrective.deviation || null,
      corrective_detail: corrective.detail || null,
      corrective_remarks: corrective.remarks || null,
      corrective_actor: corrective.actor || null,
    };
  }, [hasAnyNonConform, corrective]);

  const saveLog = useCallback(async (submit: boolean) => {
    if (!inspectionDate) {
      setToast({ message: "점검일자를 선택해 주세요.", error: true });
      return;
    }
    if (submit && hasAnyMissingLux) {
      setToast({ message: "실측 조도 미입력 항목이 있습니다. 모든 항목을 입력해 주세요.", error: true });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      const payload = {
        organization_code: orgCode,
        inspector_name: inspectorName || null,
        inspection_date: inspectionDate || todayDateString(),
        ...correctivePayload,
        updated_at: new Date().toISOString(),
      };

      let logId = currentLogId;
      if (mode === "edit" && logId) {
        const { error: updateErr } = await supabase
          .from("daily_illumination_logs")
          .update(payload)
          .eq("id", logId);
        if (updateErr) throw updateErr;
      } else if (!logId) {
        const { data: inserted, error: insertErr } = await supabase
          .from("daily_illumination_logs")
          .insert({
            ...payload,
            status: "draft",
            inspector_user_id: user?.id ?? null,
          })
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        logId = (inserted as { id: string }).id;
      }

      await persistItems(logId!);

      if (submit) {
        const { error: submitErr } = await supabase
          .from("daily_illumination_logs")
          .update({
            status: "submitted",
            submitted_at: new Date().toISOString(),
            submitted_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", logId);
        if (submitErr) throw submitErr;
        setToast({ message: "제출되었습니다." });
        setCurrentLogStatus("submitted");
      } else {
        setToast({ message: "저장되었습니다." });
        setCurrentLogStatus(mode === "edit" ? currentLogStatus : "draft");
      }
      setCurrentLogId(logId!);
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setSaving(false);
    }
  }, [
    correctivePayload,
    currentLogId,
    currentLogStatus,
    hasAnyMissingLux,
    inspectionDate,
    inspectorName,
    mode,
    orgCode,
    persistItems,
    user?.id,
  ]);

  if (!loadDone) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-3xl mx-auto">
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-3xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200 text-sm">데일리</Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/illumination" className="text-slate-400 hover:text-slate-200 text-sm">영업장 조도 점검일지</Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{mode === "new" ? "새 작성" : "수정"}</span>
      </div>

      <h1 className="text-lg font-semibold text-slate-100 mb-1">
        {mode === "new" ? "영업장 조도 점검일지 — 새 작성" : "영업장 조도 점검일지 — 수정"}
      </h1>
      <p className="text-slate-500 text-sm mb-4">점검일자를 선택하고 각 항목의 실측 조도(lx)를 입력하세요.</p>

      {toast && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${toast.error ? "bg-red-900/30 text-red-200" : "bg-cyan-900/30 text-cyan-200"}`}>
          {toast.message}
        </div>
      )}

      {currentLogStatus && (
        <div className="mb-4 px-4 py-2 rounded-lg text-sm bg-slate-800/80 border border-slate-600">
          <span className="text-slate-400">상태: </span>
          <span className="text-slate-200">{statusLabel(currentLogStatus)}</span>
        </div>
      )}

      <div className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-slate-500 text-xs mb-1">점검자명</p>
          <p className="text-slate-200">{inspectorName || "-"}</p>
        </div>
        <div>
          <label className="block text-slate-500 text-xs mb-1">점검일자</label>
          <input
            type="date"
            value={inspectionDate}
            onChange={(e) => setInspectionDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-sm"
          />
        </div>
      </div>

      <div className="space-y-3 mb-8">
        {evaluatedRows.map((row) => (
          <section key={row.index} className="rounded-xl border border-slate-700/60 bg-slate-800/50 p-4">
            <p className="text-sm text-slate-200 font-medium mb-1">{row.index}. {row.label}</p>
            <p className="text-xs text-slate-500 mb-3">기준 조도: {row.minLux} lx 이상</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs text-slate-500 mb-1">실측 조도 (lx)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="1"
                  min={0}
                  value={luxByIndex[row.index] ?? ""}
                  onChange={(e) => {
                    const value = e.target.value;
                    setLuxByIndex((prev) => ({ ...prev, [row.index]: value }));
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">자동 판정</p>
                <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${
                  row.conformity === "O"
                    ? "bg-emerald-900/50 text-emerald-300"
                    : row.conformity === "X"
                      ? "bg-amber-900/50 text-amber-300"
                      : "bg-slate-700/60 text-slate-300"
                }`}>
                  {row.conformity === "O" ? "적합" : row.conformity === "X" ? "부적합" : "미판정"}
                </span>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">판정 기준</p>
                <p className="text-xs text-slate-300">실측값 ≥ {row.minLux} lx</p>
              </div>
            </div>
          </section>
        ))}
      </div>

      {hasAnyNonConform && (
        <section className="rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8">
          <h2 className="text-sm font-semibold text-amber-300 mb-2">개선조치</h2>
          <p className="text-xs text-slate-500 mb-4">부적합 항목이 있어 조치 내용을 입력합니다.</p>
          <div className="grid gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">일시</label>
              <input
                type="datetime-local"
                value={corrective.datetime}
                onChange={(e) => {
                  setCorrectiveDatetimeManuallyEdited(true);
                  setCorrective((prev) => ({ ...prev, datetime: e.target.value }));
                }}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">이탈 내용 (자동 생성, 필요 시 수정)</label>
              <textarea
                value={corrective.deviation}
                onChange={(e) => {
                  setDeviationManuallyEdited(true);
                  setCorrective((prev) => ({ ...prev, deviation: e.target.value }));
                }}
                rows={4}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">개선 조치 내용</label>
              <textarea
                value={corrective.detail}
                onChange={(e) => setCorrective((prev) => ({ ...prev, detail: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">비고</label>
              <textarea
                value={corrective.remarks}
                onChange={(e) => setCorrective((prev) => ({ ...prev, remarks: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">개선 조치자</label>
              <input
                type="text"
                value={corrective.actor}
                onChange={(e) => setCorrective((prev) => ({ ...prev, actor: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
              />
            </div>
          </div>
        </section>
      )}

      <div className="flex flex-wrap justify-end gap-2 mb-10">
        <button
          type="button"
          onClick={() => void saveLog(false)}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white font-medium text-sm"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        {(currentLogStatus === "draft" || currentLogStatus === "rejected" || currentLogStatus == null) && (
          <button
            type="button"
            onClick={() => void saveLog(true)}
            disabled={saving}
            className="px-6 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium text-sm"
          >
            {saving ? "처리 중…" : "제출"}
          </button>
        )}
      </div>

      <div className="flex justify-end">
        <Link href="/daily/illumination" className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm">
          목록으로
        </Link>
      </div>
    </div>
  );
}
