"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { MANUFACTURING_EQUIPMENT_CHECKLIST } from "@/features/daily/manufacturingEquipmentChecklist";

type LogStatus = "draft" | "submitted" | "approved" | "rejected";
type ItemResult = "O" | "X";
type ResultMap = Record<string, ItemResult>;
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

export function ManufacturingEquipmentForm({ mode, editLogId }: Props) {
  const { user, profile, viewOrganizationCode } = useAuth();
  const [inspectionDate, setInspectionDate] = useState(todayStr);
  const [results, setResults] = useState<ResultMap>({});
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
  const authorName = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();
  const canSubmit = currentLogStatus === "draft" || currentLogStatus === "rejected" || currentLogStatus === null;
  const hasAnyX = useMemo(() => Object.values(results).some((v) => v === "X"), [results]);

  const autoDeviationText = useMemo(() => {
    const lines: string[] = [];
    MANUFACTURING_EQUIPMENT_CHECKLIST.forEach((cat, ci) => {
      cat.questions.forEach((q, qi) => {
        const key = `${ci}-${qi}`;
        if (results[key] === "X") lines.push(`${cat.title} - ${q} 부적합`);
      });
    });
    return lines.join("\n");
  }, [results]);

  const setItemResult = useCallback((key: string, value: ItemResult) => {
    setResults((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    if (mode === "new" && authorName) {
      setCorrective((c) => ({ ...c, actor: c.actor || authorName }));
    }
  }, [mode, authorName]);

  useEffect(() => {
    if (hasAnyX && !deviationManuallyEdited) {
      setCorrective((c) => ({ ...c, deviation: autoDeviationText }));
    }
    if (!hasAnyX) {
      setCorrective((c) => ({
        ...c,
        datetime: "",
        deviation: "",
        detail: "",
        remarks: "",
      }));
      setDeviationManuallyEdited(false);
      setCorrectiveDatetimeManuallyEdited(false);
    }
  }, [hasAnyX, deviationManuallyEdited, autoDeviationText]);

  useEffect(() => {
    if (!hasAnyX || !inspectionDate || correctiveDatetimeManuallyEdited) return;
    setCorrective((c) => {
      const timePart = c.datetime.includes("T") ? c.datetime.slice(11, 16) : "00:00";
      const safeTime = timePart.length === 5 ? timePart : "00:00";
      const next = `${inspectionDate}T${safeTime}`;
      if (next === c.datetime) return c;
      return { ...c, datetime: next };
    });
  }, [hasAnyX, inspectionDate, correctiveDatetimeManuallyEdited]);

  useEffect(() => {
    if (mode !== "edit" || !editLogId) {
      setLoadDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: logData, error } = await supabase
        .from("daily_manufacturing_equipment_logs")
        .select(
          "id, inspection_date, status, corrective_datetime, corrective_deviation, corrective_detail, corrective_remarks, corrective_actor"
        )
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
      setCorrective({
        datetime: log.corrective_datetime ? String(log.corrective_datetime).slice(0, 16) : "",
        deviation: log.corrective_deviation ?? "",
        detail: log.corrective_detail ?? "",
        remarks: log.corrective_remarks ?? "",
        actor: log.corrective_actor ?? authorName,
      });

      const { data: itemsData } = await supabase
        .from("daily_manufacturing_equipment_log_items")
        .select("category, question_index, question_text, result, nonconformity_note")
        .eq("log_id", log.id);
      if (cancelled) return;

      const nextResults: ResultMap = {};
      const legacyNotes: string[] = [];
      MANUFACTURING_EQUIPMENT_CHECKLIST.forEach((cat, ci) => {
        cat.questions.forEach((_, qi) => {
          const item = (itemsData ?? []).find(
            (r: { category: string; question_index: number }) =>
              r.category === cat.title && r.question_index === qi + 1
          ) as { result: ItemResult; question_text: string; nonconformity_note: string | null } | undefined;
          if (item) {
            const key = `${ci}-${qi}`;
            nextResults[key] = item.result;
            if (item.nonconformity_note && item.nonconformity_note.trim()) {
              legacyNotes.push(`${cat.title} - ${item.question_text}: ${item.nonconformity_note.trim()}`);
            }
          }
        });
      });
      const hasHeaderCorrective =
        !!(log.corrective_datetime || log.corrective_deviation || log.corrective_detail || log.corrective_remarks || log.corrective_actor);
      if (!hasHeaderCorrective && legacyNotes.length > 0) {
        setCorrective((prev) => ({
          ...prev,
          deviation: legacyNotes.join("\n"),
        }));
      }
      setResults(nextResults);
      setLoadDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, editLogId, authorName]);

  const buildItemsPayload = useCallback((logId: string) => {
    const items: {
      log_id: string;
      category: string;
      question_index: number;
      question_text: string;
      result: ItemResult;
      nonconformity_note: string | null;
    }[] = [];
    MANUFACTURING_EQUIPMENT_CHECKLIST.forEach((cat, ci) => {
      cat.questions.forEach((q, qi) => {
        const key = `${ci}-${qi}`;
        const r = results[key];
        if (r === "O" || r === "X") {
          items.push({
            log_id: logId,
            category: cat.title,
            question_index: qi + 1,
            question_text: q,
            result: r,
            nonconformity_note: null,
          });
        }
      });
    });
    return items;
  }, [results]);

  const saveHeader = useCallback(async () => {
    const date = inspectionDate.trim();
    const payload = {
      organization_code: orgCode,
      inspection_date: date,
      author_name: authorName || null,
      corrective_datetime: hasAnyX && corrective.datetime ? corrective.datetime : null,
      corrective_deviation: hasAnyX ? corrective.deviation || null : null,
      corrective_detail: hasAnyX ? corrective.detail || null : null,
      corrective_remarks: hasAnyX ? corrective.remarks || null : null,
      corrective_actor: hasAnyX ? corrective.actor || null : null,
      updated_at: new Date().toISOString(),
    };
    let logId: string;
    if (mode === "edit" && currentLogId) {
      const { error: updateErr } = await supabase
        .from("daily_manufacturing_equipment_logs")
        .update(payload)
        .eq("id", currentLogId);
      if (updateErr) throw updateErr;
      logId = currentLogId;
    } else {
      const { data: existing } = await supabase
        .from("daily_manufacturing_equipment_logs")
        .select("id, status")
        .eq("organization_code", orgCode)
        .eq("inspection_date", date)
        .maybeSingle();
      const existingRow = existing as { id: string; status: LogStatus } | null;
      if (existingRow) {
        const { error: updateErr } = await supabase
          .from("daily_manufacturing_equipment_logs")
          .update(payload)
          .eq("id", existingRow.id);
        if (updateErr) throw updateErr;
        logId = existingRow.id;
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from("daily_manufacturing_equipment_logs")
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
    return logId;
  }, [inspectionDate, orgCode, authorName, hasAnyX, corrective, mode, currentLogId, user?.id]);

  const handleSave = useCallback(async () => {
    if (!inspectionDate.trim()) {
      setToast({ message: "점검일자를 선택해 주세요.", error: true });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      const logId = await saveHeader();
      const { error: delErr } = await supabase
        .from("daily_manufacturing_equipment_log_items")
        .delete()
        .eq("log_id", logId);
      if (delErr) throw delErr;
      const items = buildItemsPayload(logId);
      if (items.length > 0) {
        const { error: itemsErr } = await supabase.from("daily_manufacturing_equipment_log_items").insert(items);
        if (itemsErr) throw itemsErr;
      }
      setToast({ message: "저장되었습니다." });
      setCurrentLogId(logId);
      setCurrentLogStatus(mode === "edit" ? currentLogStatus : "draft");
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSaving(false);
    }
  }, [inspectionDate, saveHeader, buildItemsPayload, mode, currentLogStatus]);

  const handleSubmit = useCallback(async () => {
    if (!inspectionDate.trim()) {
      setToast({ message: "점검일자를 선택해 주세요.", error: true });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      const logId = await saveHeader();
      const { error: delErr } = await supabase
        .from("daily_manufacturing_equipment_log_items")
        .delete()
        .eq("log_id", logId);
      if (delErr) throw delErr;
      const rows = buildItemsPayload(logId);
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("daily_manufacturing_equipment_log_items").insert(rows);
        if (insErr) throw insErr;
      }
      const { error: submitErr } = await supabase
        .from("daily_manufacturing_equipment_logs")
        .update({
          status: "submitted",
          submitted_at: new Date().toISOString(),
          submitted_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", logId);
      if (submitErr) throw submitErr;
      setToast({ message: "제출되었습니다." });
      setCurrentLogId(logId);
      setCurrentLogStatus("submitted");
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setSaving(false);
    }
  }, [inspectionDate, saveHeader, buildItemsPayload, user?.id]);

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
        <Link href="/daily" className="text-slate-400 hover:text-slate-200 text-sm">
          데일리
        </Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/manufacturing-equipment" className="text-slate-400 hover:text-slate-200 text-sm">
          제조설비 점검표
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{mode === "new" ? "새 작성" : "수정"}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">
        {mode === "new" ? "제조설비 점검표 — 새 작성" : "제조설비 점검표 — 수정"}
      </h1>
      <p className="text-slate-500 text-sm mb-4">항목별 적합/부적합을 선택하세요. 부적합이 있으면 개선조치를 입력합니다.</p>

      {toast && (
        <div
          className={`mb-4 px-4 py-2 rounded-lg text-sm ${
            toast.error ? "bg-red-900/30 text-red-200" : "bg-cyan-900/30 text-cyan-200"
          }`}
        >
          {toast.message}
        </div>
      )}

      {currentLogStatus != null && (
        <div className="mb-4 px-4 py-2 rounded-lg text-sm bg-slate-800/80 border border-slate-600">
          <span className="text-slate-400">상태: </span>
          <span className="text-slate-300">
            {currentLogStatus === "draft" && "작성 중"}
            {currentLogStatus === "submitted" && "제출 완료"}
            {currentLogStatus === "approved" && "승인 완료"}
            {currentLogStatus === "rejected" && "반려"}
          </span>
        </div>
      )}

      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-400 mb-1">점검일자</label>
        <input
          type="date"
          value={inspectionDate}
          onChange={(e) => setInspectionDate(e.target.value)}
          className="w-full max-w-[200px] px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100"
        />
      </div>

      <div className="space-y-6 mb-8">
        {MANUFACTURING_EQUIPMENT_CHECKLIST.map((category, catIndex) => (
          <section key={category.title} className="rounded-xl border border-slate-700/60 bg-slate-800/50 overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-semibold text-cyan-300 bg-slate-800/80 border-b border-slate-700/60">
              {category.title}
            </h2>
            <ul className="divide-y divide-slate-700/50">
              {category.questions.map((question, qIndex) => {
                const key = `${catIndex}-${qIndex}`;
                const value = results[key] ?? "";
                return (
                  <li key={key} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                    <p className="flex-1 text-sm text-slate-300 min-w-0">{question}</p>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setItemResult(key, "O")}
                        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          value === "O"
                            ? "bg-emerald-600 border-emerald-500 text-white"
                            : "bg-slate-800/80 border-slate-600 text-slate-300 hover:bg-slate-700/60"
                        }`}
                      >
                        적합
                      </button>
                      <button
                        type="button"
                        onClick={() => setItemResult(key, "X")}
                        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          value === "X"
                            ? "bg-amber-700 border-amber-500 text-white"
                            : "bg-slate-800/80 border-slate-600 text-slate-300 hover:bg-slate-700/60"
                        }`}
                      >
                        부적합
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {hasAnyX && (
        <section className="rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8">
          <h2 className="text-sm font-semibold text-amber-300 mb-1">개선조치</h2>
          <p className="text-xs text-slate-500 mb-4">승인자는 일지 승인 시 자동으로 기록됩니다.</p>
          <div className="grid gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">일시</label>
              <input
                type="datetime-local"
                value={corrective.datetime}
                onChange={(e) => {
                  setCorrectiveDatetimeManuallyEdited(true);
                  setCorrective((c) => ({ ...c, datetime: e.target.value }));
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
                  setCorrective((c) => ({ ...c, deviation: e.target.value }));
                }}
                rows={4}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">개선 조치 내용</label>
              <textarea
                value={corrective.detail}
                onChange={(e) => setCorrective((c) => ({ ...c, detail: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">비고</label>
              <textarea
                value={corrective.remarks}
                onChange={(e) => setCorrective((c) => ({ ...c, remarks: e.target.value }))}
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">개선 조치자</label>
              <input
                type="text"
                value={corrective.actor}
                onChange={(e) => setCorrective((c) => ({ ...c, actor: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
              />
            </div>
          </div>
        </section>
      )}

      <div className="flex flex-wrap justify-end gap-2 mb-10">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white font-medium text-sm"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        {canSubmit && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium text-sm"
          >
            {saving ? "처리 중…" : "제출"}
          </button>
        )}
      </div>

      <div className="flex justify-end">
        <Link
          href="/daily/manufacturing-equipment"
          className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
        >
          목록으로
        </Link>
      </div>
    </div>
  );
}
