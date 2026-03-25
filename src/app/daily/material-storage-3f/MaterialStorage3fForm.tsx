"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  MATERIAL_STORAGE_3F_QUESTIONS,
  MATERIAL_STORAGE_3F_ROOMS,
  buildMaterialStorage3fAutoDeviationText,
  hasAnyMaterialStorage3fIssue,
  keyForResult,
  parseOptionalNum,
  type MaterialStorage3fResult,
  type MaterialStorage3fResultMap,
  type MaterialStorage3fRoomKey,
} from "@/features/daily/materialStorage3fChecklist";

type LogStatus = "draft" | "submitted" | "approved" | "rejected";

type CorrectiveState = {
  datetime: string;
  deviation: string;
  detail: string;
  remarks: string;
  actor: string;
};

type Props = { mode: "new" | "edit"; editLogId?: string };

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_ROOM_VALUES = {
  raw: "",
  sub: "",
} as Record<MaterialStorage3fRoomKey, string>;

function syncDateToDatetimeLocal(existing: string, date: string): string {
  if (!date) return existing;
  const timePart = existing.includes("T") ? existing.slice(11, 16) : "00:00";
  const safeTime = timePart.length === 5 ? timePart : "00:00";
  return `${date}T${safeTime}`;
}

export function MaterialStorage3fForm({ mode, editLogId }: Props) {
  const { user, profile, viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const authorName = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();

  const [inspectionDate, setInspectionDate] = useState(todayStr);
  const [temps, setTemps] = useState<Record<MaterialStorage3fRoomKey, string>>(EMPTY_ROOM_VALUES);
  const [humidities, setHumidities] = useState<Record<MaterialStorage3fRoomKey, string>>(EMPTY_ROOM_VALUES);
  const [results, setResults] = useState<MaterialStorage3fResultMap>({});
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

  const hasAnyIssue = useMemo(
    () => hasAnyMaterialStorage3fIssue(results, temps, humidities),
    [results, temps, humidities]
  );
  const autoDeviationText = useMemo(
    () => buildMaterialStorage3fAutoDeviationText(results, temps, humidities),
    [results, temps, humidities]
  );

  useEffect(() => {
    if (hasAnyIssue && !deviationManuallyEdited) {
      setCorrective((c) => ({ ...c, deviation: autoDeviationText }));
    }
    if (!hasAnyIssue) {
      setCorrective((c) => ({ ...c, deviation: "" }));
      setDeviationManuallyEdited(false);
      setCorrectiveDatetimeManuallyEdited(false);
    }
  }, [hasAnyIssue, deviationManuallyEdited, autoDeviationText]);

  useEffect(() => {
    if (!hasAnyIssue || !inspectionDate || correctiveDatetimeManuallyEdited) return;
    setCorrective((c) => {
      const next = syncDateToDatetimeLocal(c.datetime, inspectionDate);
      if (next === c.datetime) return c;
      return { ...c, datetime: next };
    });
  }, [hasAnyIssue, inspectionDate, correctiveDatetimeManuallyEdited]);

  const canEdit = true;
  const canSubmit =
    currentLogStatus === "draft" || currentLogStatus === "rejected" || currentLogStatus === null;

  useEffect(() => {
    if (mode === "new" && authorName) {
      setCorrective((c) => ({ ...c, actor: c.actor || authorName }));
    }
  }, [mode, authorName]);

  const setRoomResult = useCallback((room: MaterialStorage3fRoomKey, questionIndex: number, value: MaterialStorage3fResult) => {
    setResults((prev) => ({ ...prev, [keyForResult(room, questionIndex)]: value }));
  }, []);

  useEffect(() => {
    if (mode !== "edit" || !editLogId) {
      setLoadDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: logData, error } = await supabase
        .from("daily_material_storage_3f_logs")
        .select("*")
        .eq("id", editLogId)
        .maybeSingle();
      if (cancelled || error) {
        if (!cancelled) setToast({ message: error?.message ?? "일지를 불러올 수 없습니다.", error: true });
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
        inspection_date: string;
        raw_room_temp_c: number | null;
        raw_room_humidity_pct: number | null;
        sub_room_temp_c: number | null;
        sub_room_humidity_pct: number | null;
        status: LogStatus;
        corrective_datetime: string | null;
        corrective_deviation: string | null;
        corrective_detail: string | null;
        corrective_remarks: string | null;
        corrective_actor: string | null;
      };
      setCurrentLogId(log.id);
      setCurrentLogStatus(log.status);
      setInspectionDate(log.inspection_date ?? todayStr());
      setTemps({
        raw: log.raw_room_temp_c != null ? String(log.raw_room_temp_c) : "",
        sub: log.sub_room_temp_c != null ? String(log.sub_room_temp_c) : "",
      });
      setHumidities({
        raw: log.raw_room_humidity_pct != null ? String(log.raw_room_humidity_pct) : "",
        sub: log.sub_room_humidity_pct != null ? String(log.sub_room_humidity_pct) : "",
      });
      setCorrective({
        datetime: log.corrective_datetime ? String(log.corrective_datetime).slice(0, 16) : "",
        deviation: log.corrective_deviation ?? "",
        detail: log.corrective_detail ?? "",
        remarks: log.corrective_remarks ?? "",
        actor: log.corrective_actor ?? authorName,
      });

      const { data: itemsData } = await supabase
        .from("daily_material_storage_3f_log_items")
        .select("room_key, question_index, result")
        .eq("log_id", log.id);
      if (cancelled) return;
      const nextResults: MaterialStorage3fResultMap = {};
      (itemsData ?? []).forEach((row: { room_key: string; question_index: number; result: string }) => {
        if ((row.result === "O" || row.result === "X") && (row.room_key === "raw" || row.room_key === "sub")) {
          nextResults[keyForResult(row.room_key, row.question_index - 1)] = row.result;
        }
      });
      setResults(nextResults);
      setLoadDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, editLogId, authorName]);

  const correctivePayload = useMemo(() => {
    if (!hasAnyIssue) {
      return {
        corrective_datetime: null as string | null,
        corrective_deviation: null as string | null,
        corrective_detail: null as string | null,
        corrective_remarks: null as string | null,
        corrective_actor: null as string | null,
      };
    }
    return {
      corrective_datetime: corrective.datetime || null,
      corrective_deviation: corrective.deviation || null,
      corrective_detail: corrective.detail || null,
      corrective_remarks: corrective.remarks || null,
      corrective_actor: corrective.actor || null,
    };
  }, [hasAnyIssue, corrective]);

  const persistItems = useCallback(
    async (logId: string) => {
      const { error: delErr } = await supabase
        .from("daily_material_storage_3f_log_items")
        .delete()
        .eq("log_id", logId);
      if (delErr) throw delErr;
      const rows: Array<{
        log_id: string;
        room_key: string;
        room_name: string;
        question_index: number;
        question_text: string;
        result: "O" | "X";
      }> = [];
      MATERIAL_STORAGE_3F_ROOMS.forEach((room) => {
        MATERIAL_STORAGE_3F_QUESTIONS.forEach((q, qi) => {
          const r = results[keyForResult(room.key, qi)];
          if (r === "O" || r === "X") {
            rows.push({
              log_id: logId,
              room_key: room.key,
              room_name: room.name,
              question_index: qi + 1,
              question_text: q,
              result: r,
            });
          }
        });
      });
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("daily_material_storage_3f_log_items").insert(rows);
        if (insErr) throw insErr;
      }
    },
    [results]
  );

  const baseHeaderFields = useCallback(() => {
    return {
      organization_code: orgCode,
      inspection_date: inspectionDate.trim(),
      author_name: authorName || null,
      raw_room_temp_c: parseOptionalNum(temps.raw),
      raw_room_humidity_pct: parseOptionalNum(humidities.raw),
      sub_room_temp_c: parseOptionalNum(temps.sub),
      sub_room_humidity_pct: parseOptionalNum(humidities.sub),
      ...correctivePayload,
      updated_at: new Date().toISOString(),
    };
  }, [orgCode, inspectionDate, authorName, temps, humidities, correctivePayload]);

  const handleSave = useCallback(async () => {
    const date = inspectionDate.trim();
    if (!date) {
      setToast({ message: "점검일자를 선택해 주세요.", error: true });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      const payload = baseHeaderFields();
      let logId: string;
      if (mode === "edit" && currentLogId) {
        const { error: updateErr } = await supabase
          .from("daily_material_storage_3f_logs")
          .update(payload)
          .eq("id", currentLogId);
        if (updateErr) throw updateErr;
        logId = currentLogId;
      } else {
        const { data: existing } = await supabase
          .from("daily_material_storage_3f_logs")
          .select("id, status")
          .eq("organization_code", orgCode)
          .eq("inspection_date", date)
          .maybeSingle();
        const existingRow = existing as { id: string; status: LogStatus } | null;
        if (existingRow) {
          const { error: updateErr } = await supabase
            .from("daily_material_storage_3f_logs")
            .update(payload)
            .eq("id", existingRow.id);
          if (updateErr) throw updateErr;
          logId = existingRow.id;
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("daily_material_storage_3f_logs")
            .insert({
              ...payload,
              status: "draft",
              author_user_id: user?.id ?? null,
            })
            .select("id")
            .single();
          if (insertErr) throw insertErr;
          logId = (inserted as { id: string }).id;
        }
      }
      await persistItems(logId);
      setToast({ message: "저장되었습니다." });
      setCurrentLogId(logId);
      setCurrentLogStatus(mode === "edit" ? currentLogStatus : "draft");
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSaving(false);
    }
  }, [inspectionDate, baseHeaderFields, mode, currentLogId, orgCode, user?.id, persistItems, currentLogStatus]);

  const handleSubmit = useCallback(async () => {
    const date = inspectionDate.trim();
    if (!date) {
      setToast({ message: "점검일자를 선택해 주세요.", error: true });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      let logId = currentLogId;
      if (!logId) {
        const { data: existing } = await supabase
          .from("daily_material_storage_3f_logs")
          .select("id, status")
          .eq("organization_code", orgCode)
          .eq("inspection_date", date)
          .maybeSingle();
        const existingRow = existing as { id: string; status: LogStatus } | null;
        if (existingRow) {
          logId = existingRow.id;
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("daily_material_storage_3f_logs")
            .insert({
              ...baseHeaderFields(),
              status: "draft",
              author_user_id: user?.id ?? null,
            })
            .select("id")
            .single();
          if (insertErr) throw insertErr;
          logId = (inserted as { id: string }).id;
        }
      }

      const { error: patchErr } = await supabase
        .from("daily_material_storage_3f_logs")
        .update(baseHeaderFields())
        .eq("id", logId);
      if (patchErr) throw patchErr;
      await persistItems(logId!);

      const { error: submitErr } = await supabase
        .from("daily_material_storage_3f_logs")
        .update({
          status: "submitted",
          submitted_at: new Date().toISOString(),
          submitted_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", logId);
      if (submitErr) throw submitErr;
      setToast({ message: "제출되었습니다." });
      setCurrentLogId(logId!);
      setCurrentLogStatus("submitted");
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSaving(false);
    }
  }, [inspectionDate, currentLogId, orgCode, baseHeaderFields, user?.id, persistItems]);

  if (!loadDone) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] md:min-h-0 p-4 md:p-6 max-w-2xl mx-auto pb-20 md:pb-6">
      <div className="flex items-center gap-2 mb-4">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200 text-sm">데일리</Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/material-storage-3f" className="text-slate-400 hover:text-slate-200 text-sm">원부자재 창고 점검표(3F)</Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{mode === "new" ? "새 작성" : "수정"}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">{mode === "new" ? "새 점검일지 작성" : "점검일지 수정"}</h1>

      {toast && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${toast.error ? "bg-red-900/30 text-red-200" : "bg-cyan-900/30 text-cyan-200"}`}>
          {toast.message}
        </div>
      )}

      {currentLogStatus === "approved" && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm bg-emerald-900/20 border border-emerald-700/50 text-emerald-200">
          승인 완료된 일지입니다. 필요 시 수정 후 저장할 수 있습니다.
        </div>
      )}

      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-400 mb-1">점검일자</label>
        <input
          type="date"
          value={inspectionDate}
          onChange={(e) => setInspectionDate(e.target.value)}
          disabled={!canEdit}
          className="w-full max-w-[200px] px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 disabled:opacity-60"
        />
      </div>

      {MATERIAL_STORAGE_3F_ROOMS.map((room) => (
        <section key={room.key} className="rounded-xl border border-slate-700/60 bg-slate-800/50 overflow-hidden mb-6">
          <h2 className="px-4 py-3 text-sm font-semibold text-cyan-300 bg-slate-800/80 border-b border-slate-700/60">{room.name}</h2>
          <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3 border-b border-slate-700/50">
            <div>
              <label className="block text-xs text-slate-500 mb-1">온도 (℃, 기준 10~35)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={temps[room.key]}
                onChange={(e) => setTemps((prev) => ({ ...prev, [room.key]: e.target.value }))}
                disabled={!canEdit}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm disabled:opacity-70"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">습도 (%, 기준 50 이하)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={humidities[room.key]}
                onChange={(e) => setHumidities((prev) => ({ ...prev, [room.key]: e.target.value }))}
                disabled={!canEdit}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm disabled:opacity-70"
              />
            </div>
          </div>
          <ul className="divide-y divide-slate-700/50">
            {MATERIAL_STORAGE_3F_QUESTIONS.map((question, qi) => {
              const key = keyForResult(room.key, qi);
              const value = results[key] ?? "";
              return (
                <li key={key} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                  <p className="flex-1 text-sm text-slate-300">{question}</p>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" disabled={!canEdit} onClick={() => setRoomResult(room.key, qi, "O")} className={`px-4 py-2 rounded-lg text-sm font-medium border ${value === "O" ? "bg-emerald-600 border-emerald-500 text-white" : "bg-slate-800/80 border-slate-600 text-slate-300 hover:bg-slate-700/60"} disabled:opacity-50`}>적합</button>
                    <button type="button" disabled={!canEdit} onClick={() => setRoomResult(room.key, qi, "X")} className={`px-4 py-2 rounded-lg text-sm font-medium border ${value === "X" ? "bg-amber-700 border-amber-500 text-white" : "bg-slate-800/80 border-slate-600 text-slate-300 hover:bg-slate-700/60"} disabled:opacity-50`}>부적합</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {hasAnyIssue && (
        <section className={`rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8 ${!canEdit ? "opacity-80 pointer-events-none" : ""}`}>
          <h2 className="text-sm font-semibold text-amber-300 mb-1">개선조치</h2>
          <div className="grid gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">일시</label>
              <input type="datetime-local" value={corrective.datetime} onChange={(e) => { setCorrectiveDatetimeManuallyEdited(true); setCorrective((c) => ({ ...c, datetime: e.target.value })); }} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">이탈내용 (자동 생성, 필요 시 수정)</label>
              <textarea value={corrective.deviation} onChange={(e) => { setDeviationManuallyEdited(true); setCorrective((c) => ({ ...c, deviation: e.target.value })); }} rows={5} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none disabled:opacity-70" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">개선조치내용</label>
              <textarea value={corrective.detail} onChange={(e) => setCorrective((c) => ({ ...c, detail: e.target.value }))} rows={2} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none disabled:opacity-70" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">비고</label>
              <textarea value={corrective.remarks} onChange={(e) => setCorrective((c) => ({ ...c, remarks: e.target.value }))} rows={2} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none disabled:opacity-70" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">개선조치자</label>
              <input type="text" value={corrective.actor} onChange={(e) => setCorrective((c) => ({ ...c, actor: e.target.value }))} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm disabled:opacity-70" />
            </div>
          </div>
        </section>
      )}

      <div className="flex flex-wrap justify-end gap-2 mb-10">
        <button type="button" onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white font-medium text-sm">
          {saving ? "저장 중…" : "저장"}
        </button>
        {canSubmit && (
          <button type="button" onClick={handleSubmit} disabled={saving} className="px-6 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium text-sm">
            {saving ? "처리 중…" : "제출"}
          </button>
        )}
      </div>

      <div className="flex justify-end">
        <Link href="/daily/material-storage-3f" className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm">
          목록으로
        </Link>
      </div>
    </div>
  );
}
