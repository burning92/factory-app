"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  COLD_STORAGE_HYGIENE_CHECKLIST,
  coldStorageQuestionText,
} from "@/features/daily/coldStorageHygieneChecklist";
import {
  applyFreezerSignOnBlur,
  buildColdStorageAutoDeviationText,
  COLD_STORAGE_FREEZER_KEYS,
  COLD_STORAGE_TEMPERATURE_DEFS,
  emptyTempRow,
  hasAnyChecklistFail,
  hasAnyTemperatureDeviation,
  parseOptionalNum,
  roundOneDecimal,
  type ColdStorageTempKey,
} from "@/features/daily/coldStorageHygieneTemperature";
import type { HygieneFormResults, HygieneItemResult } from "@/features/daily/hygieneChecklist";

type LogStatus = "draft" | "submitted" | "approved" | "rejected";

type CorrectiveState = {
  datetime: string;
  deviation: string;
  detail: string;
  remarks: string;
  actor: string;
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function syncDateToDatetimeLocal(existing: string, date: string): string {
  if (!date) return existing;
  const timePart = existing.includes("T") ? existing.slice(11, 16) : "00:00";
  const safeTime = timePart.length === 5 ? timePart : "00:00";
  return `${date}T${safeTime}`;
}

/** 신규 작성 화면 전용: 마운트 시 1회만 사용 (08:00~08:30, 분 단위 임의) */
function randomDefaultMorningMeasureTime(): string {
  const minMin = 8 * 60;
  const maxMin = 8 * 60 + 30;
  const total = Math.floor(Math.random() * (maxMin - minMin + 1)) + minMin;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 신규 작성 화면 전용: 마운트 시 1회만 사용 (16:30~17:50, 분 단위 임의) */
function randomDefaultAfternoonMeasureTime(): string {
  const minMin = 16 * 60 + 30;
  const maxMin = 17 * 60 + 50;
  const total = Math.floor(Math.random() * (maxMin - minMin + 1)) + minMin;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatNumForInput(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "";
  return String(roundOneDecimal(Number(n)));
}

type HeaderRow = {
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

function headerToAmPm(header: HeaderRow): {
  amTime: string;
  pmTime: string;
  am: Record<ColdStorageTempKey, string>;
  pm: Record<ColdStorageTempKey, string>;
} {
  return {
    amTime: header.am_measure_time ?? "",
    pmTime: header.pm_measure_time ?? "",
    am: {
      floor1_refrigerator: formatNumForInput(header.am_temp_floor1_refrigerator_c),
      floor1_freezer: formatNumForInput(header.am_temp_floor1_freezer_c),
      dough_aging: formatNumForInput(header.am_temp_dough_aging_c),
      topping_refrigerator: formatNumForInput(header.am_temp_topping_refrigerator_c),
      blast_freezer_1: formatNumForInput(header.am_temp_blast_freezer_1_c),
      blast_freezer_2: formatNumForInput(header.am_temp_blast_freezer_2_c),
    },
    pm: {
      floor1_refrigerator: formatNumForInput(header.pm_temp_floor1_refrigerator_c),
      floor1_freezer: formatNumForInput(header.pm_temp_floor1_freezer_c),
      dough_aging: formatNumForInput(header.pm_temp_dough_aging_c),
      topping_refrigerator: formatNumForInput(header.pm_temp_topping_refrigerator_c),
      blast_freezer_1: formatNumForInput(header.pm_temp_blast_freezer_1_c),
      blast_freezer_2: formatNumForInput(header.pm_temp_blast_freezer_2_c),
    },
  };
}

function buildTempHeaderPatch(
  amTime: string,
  pmTime: string,
  am: Record<ColdStorageTempKey, string>,
  pm: Record<ColdStorageTempKey, string>
): HeaderRow {
  return {
    am_measure_time: amTime.trim() || null,
    pm_measure_time: pmTime.trim() || null,
    am_temp_floor1_refrigerator_c: parseOptionalNum(am.floor1_refrigerator),
    am_temp_floor1_freezer_c: parseOptionalNum(am.floor1_freezer),
    am_temp_dough_aging_c: parseOptionalNum(am.dough_aging),
    am_temp_topping_refrigerator_c: parseOptionalNum(am.topping_refrigerator),
    am_temp_blast_freezer_1_c: parseOptionalNum(am.blast_freezer_1),
    am_temp_blast_freezer_2_c: parseOptionalNum(am.blast_freezer_2),
    pm_temp_floor1_refrigerator_c: parseOptionalNum(pm.floor1_refrigerator),
    pm_temp_floor1_freezer_c: parseOptionalNum(pm.floor1_freezer),
    pm_temp_dough_aging_c: parseOptionalNum(pm.dough_aging),
    pm_temp_topping_refrigerator_c: parseOptionalNum(pm.topping_refrigerator),
    pm_temp_blast_freezer_1_c: parseOptionalNum(pm.blast_freezer_1),
    pm_temp_blast_freezer_2_c: parseOptionalNum(pm.blast_freezer_2),
  };
}

type Props = { mode: "new" | "edit"; editLogId?: string };

export function ColdStorageHygieneForm({ mode, editLogId }: Props) {
  const { user, profile, viewOrganizationCode } = useAuth();
  const [inspectionDate, setInspectionDate] = useState(todayStr);
  const [results, setResults] = useState<HygieneFormResults>({});
  const [amTime, setAmTime] = useState(() =>
    mode === "new" ? randomDefaultMorningMeasureTime() : ""
  );
  const [pmTime, setPmTime] = useState(() =>
    mode === "new" ? randomDefaultAfternoonMeasureTime() : ""
  );
  const [amTemps, setAmTemps] = useState<Record<ColdStorageTempKey, string>>(emptyTempRow);
  const [pmTemps, setPmTemps] = useState<Record<ColdStorageTempKey, string>>(emptyTempRow);
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

  const hasAnyIssue = useMemo(
    () => hasAnyChecklistFail(results) || hasAnyTemperatureDeviation(amTemps, pmTemps),
    [results, amTemps, pmTemps]
  );

  const autoDeviationText = useMemo(
    () => buildColdStorageAutoDeviationText(results, amTemps, pmTemps),
    [results, amTemps, pmTemps]
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

  const setItemResult = useCallback((key: string, value: HygieneItemResult) => {
    setResults((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    if (mode === "new" && authorName) {
      setCorrective((c) => ({ ...c, actor: c.actor || authorName }));
    }
  }, [mode, authorName]);

  useEffect(() => {
    if (mode !== "edit" || !editLogId) {
      setLoadDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: logData, error } = await supabase
        .from("daily_cold_storage_hygiene_logs")
        .select(
          "id, inspection_date, status, corrective_datetime, corrective_deviation, corrective_detail, corrective_remarks, corrective_actor, am_measure_time, pm_measure_time, am_temp_floor1_refrigerator_c, am_temp_floor1_freezer_c, am_temp_dough_aging_c, am_temp_topping_refrigerator_c, am_temp_blast_freezer_1_c, am_temp_blast_freezer_2_c, pm_temp_floor1_refrigerator_c, pm_temp_floor1_freezer_c, pm_temp_dough_aging_c, pm_temp_topping_refrigerator_c, pm_temp_blast_freezer_1_c, pm_temp_blast_freezer_2_c"
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
      } & HeaderRow;
      setCurrentLogId(log.id);
      setCurrentLogStatus(log.status);
      setInspectionDate(log.inspection_date ?? todayStr());
      const temps = headerToAmPm(log);
      setAmTime(temps.amTime);
      setPmTime(temps.pmTime);
      setAmTemps(temps.am);
      setPmTemps(temps.pm);

      const { data: itemsData } = await supabase
        .from("daily_cold_storage_hygiene_log_items")
        .select("category, question_index, question_text, result")
        .eq("log_id", log.id);
      if (cancelled) return;
      const nextResults: HygieneFormResults = {};
      COLD_STORAGE_HYGIENE_CHECKLIST.forEach((cat, ci) => {
        cat.items.forEach((item, qi) => {
          const row = (itemsData ?? []).find(
            (r: { category: string; question_index: number }) =>
              r.category === cat.title && r.question_index === qi + 1
          ) as { result: string } | undefined;
          if (row && (row.result === "O" || row.result === "X")) {
            nextResults[`${ci}-${qi}`] = row.result as HygieneItemResult;
          }
        });
      });
      const autoFromLoaded = buildColdStorageAutoDeviationText(nextResults, temps.am, temps.pm);
      const loadedDev = (log.corrective_deviation ?? "").trim();
      setDeviationManuallyEdited(loadedDev !== "" && loadedDev !== autoFromLoaded.trim());
      setCorrective({
        datetime: log.corrective_datetime ? String(log.corrective_datetime).slice(0, 16) : "",
        deviation: log.corrective_deviation ?? "",
        detail: log.corrective_detail ?? "",
        remarks: log.corrective_remarks ?? "",
        actor: log.corrective_actor ?? authorName,
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
      corrective_datetime: corrective.datetime ? corrective.datetime : null,
      corrective_deviation: corrective.deviation || null,
      corrective_detail: corrective.detail || null,
      corrective_remarks: corrective.remarks || null,
      corrective_actor: corrective.actor || null,
    };
  }, [hasAnyIssue, corrective]);

  const persistItems = useCallback(
    async (logId: string) => {
      const { error: delErr } = await supabase
        .from("daily_cold_storage_hygiene_log_items")
        .delete()
        .eq("log_id", logId);
      if (delErr) throw delErr;
      const rows: {
        log_id: string;
        category: string;
        question_index: number;
        question_text: string;
        result: string;
      }[] = [];
      COLD_STORAGE_HYGIENE_CHECKLIST.forEach((cat, ci) => {
        cat.items.forEach((item, qi) => {
          const key = `${ci}-${qi}`;
          const r = results[key];
          if (r === "O" || r === "X") {
            rows.push({
              log_id: logId,
              category: cat.title,
              question_index: qi + 1,
              question_text: coldStorageQuestionText(item),
              result: r,
            });
          }
        });
      });
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("daily_cold_storage_hygiene_log_items").insert(rows);
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
      ...correctivePayload,
      ...buildTempHeaderPatch(amTime, pmTime, amTemps, pmTemps),
      updated_at: new Date().toISOString(),
    };
  }, [orgCode, inspectionDate, authorName, correctivePayload, amTime, pmTime, amTemps, pmTemps]);

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
          .from("daily_cold_storage_hygiene_logs")
          .update(payload)
          .eq("id", currentLogId);
        if (updateErr) throw updateErr;
        logId = currentLogId;
      } else {
        const { data: existing } = await supabase
          .from("daily_cold_storage_hygiene_logs")
          .select("id, status")
          .eq("organization_code", orgCode)
          .eq("inspection_date", date)
          .maybeSingle();
        const existingRow = existing as { id: string; status: LogStatus } | null;
        if (existingRow) {
          const { error: updateErr } = await supabase
            .from("daily_cold_storage_hygiene_logs")
            .update(payload)
            .eq("id", existingRow.id);
          if (updateErr) throw updateErr;
          logId = existingRow.id;
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("daily_cold_storage_hygiene_logs")
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
  }, [
    mode,
    orgCode,
    inspectionDate,
    baseHeaderFields,
    user?.id,
    currentLogId,
    currentLogStatus,
    persistItems,
  ]);

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
          .from("daily_cold_storage_hygiene_logs")
          .select("id, status")
          .eq("organization_code", orgCode)
          .eq("inspection_date", date)
          .maybeSingle();
        const existingRow = existing as { id: string; status: LogStatus } | null;
        if (existingRow) {
          logId = existingRow.id;
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("daily_cold_storage_hygiene_logs")
            .insert({
              organization_code: orgCode,
              inspection_date: date,
              author_name: authorName || null,
              author_user_id: user?.id ?? null,
              status: "draft",
              ...correctivePayload,
              ...buildTempHeaderPatch(amTime, pmTime, amTemps, pmTemps),
              updated_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (insertErr) throw insertErr;
          logId = (inserted as { id: string }).id;
        }
      }

      const headerPatch = baseHeaderFields();
      const { error: patchErr } = await supabase
        .from("daily_cold_storage_hygiene_logs")
        .update(headerPatch)
        .eq("id", logId);
      if (patchErr) throw patchErr;
      await persistItems(logId!);

      const { error: submitErr } = await supabase
        .from("daily_cold_storage_hygiene_logs")
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
  }, [
    inspectionDate,
    orgCode,
    currentLogId,
    user?.id,
    authorName,
    correctivePayload,
    amTime,
    pmTime,
    amTemps,
    pmTemps,
    persistItems,
    baseHeaderFields,
  ]);

  const setTempField = (
    period: "am" | "pm",
    key: ColdStorageTempKey,
    value: string,
    inputMode: "raw" | "freezerBlur"
  ) => {
    const nextVal =
      inputMode === "freezerBlur" && COLD_STORAGE_FREEZER_KEYS.has(key)
        ? applyFreezerSignOnBlur(value)
        : value;
    if (period === "am") {
      setAmTemps((prev) => ({ ...prev, [key]: nextVal }));
    } else {
      setPmTemps((prev) => ({ ...prev, [key]: nextVal }));
    }
  };

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
        <Link href="/daily/cold-storage-hygiene" className="text-slate-400 hover:text-slate-200 text-sm">
          냉장 · 냉동온도 및 위생 점검일지
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{mode === "new" ? "새 작성" : "수정"}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">
        {mode === "new" ? "새 점검일지 작성" : "점검일지 수정"}
      </h1>
      <p className="text-slate-500 text-sm mb-4">
        점검 항목과 오전·오후 온도를 입력합니다. 부적합 또는 온도 기준 이탈 시 이탈내용이 자동 생성됩니다.
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

      {currentLogStatus != null && (
        <div className="mb-4 px-4 py-2 rounded-lg text-sm bg-slate-800/80 border border-slate-600">
          <span className="text-slate-400">상태: </span>
          <span
            className={
              currentLogStatus === "approved"
                ? "text-emerald-400 font-medium"
                : currentLogStatus === "submitted"
                  ? "text-cyan-400"
                  : currentLogStatus === "rejected"
                    ? "text-amber-400"
                    : "text-slate-300"
            }
          >
            {currentLogStatus === "draft" && "작성중"}
            {currentLogStatus === "submitted" && "제출됨"}
            {currentLogStatus === "approved" && "승인 완료"}
            {currentLogStatus === "rejected" && "반려"}
          </span>
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
          className="w-full max-w-[200px] px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 disabled:opacity-60 disabled:cursor-not-allowed"
        />
      </div>

      <div className="space-y-6 mb-8">
        {COLD_STORAGE_HYGIENE_CHECKLIST.map((category, catIndex) => (
          <section key={category.title} className="rounded-xl border border-slate-700/60 bg-slate-800/50 overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-semibold text-cyan-300 bg-slate-800/80 border-b border-slate-700/60">
              {category.title}
            </h2>
            <ul className="divide-y divide-slate-700/50">
              {category.items.map((item, qIndex) => {
                const key = `${catIndex}-${qIndex}`;
                const value = results[key] ?? "";
                return (
                  <li key={key} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                    <p className="flex-1 text-sm text-slate-300 min-w-0">
                      {coldStorageQuestionText(item)}
                    </p>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => setItemResult(key, "O")}
                        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          value === "O"
                            ? "bg-emerald-600 border-emerald-500 text-white"
                            : "bg-slate-800/80 border-slate-600 text-slate-300 hover:bg-slate-700/60"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        적합
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => setItemResult(key, "X")}
                        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          value === "X"
                            ? "bg-amber-700 border-amber-500 text-white"
                            : "bg-slate-800/80 border-slate-600 text-slate-300 hover:bg-slate-700/60"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
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

      <section className="rounded-xl border border-slate-700/60 bg-slate-800/50 overflow-hidden mb-8">
        <h2 className="px-4 py-3 text-sm font-semibold text-cyan-300 bg-slate-800/80 border-b border-slate-700/60">
          온도 측정
        </h2>
        <div className="px-4 py-3 space-y-2 text-xs text-slate-400 border-b border-slate-700/60">
          <p>냉동고 계열은 숫자만 입력하면 자동으로 음수 처리됩니다.</p>
          <p>측정 당시 제상 중이면 이탈내용 또는 특이사항에 &apos;제상&apos;이라고 입력해주세요.</p>
        </div>

        {(["am", "pm"] as const).map((period) => {
          const label = period === "am" ? "오전" : "오후";
          const temps = period === "am" ? amTemps : pmTemps;
          const setTime = period === "am" ? setAmTime : setPmTime;
          const timeVal = period === "am" ? amTime : pmTime;
          return (
            <div key={period} className="px-4 py-4 border-b border-slate-700/50 last:border-b-0">
              <h3 className="text-sm font-medium text-slate-200 mb-3">{label}</h3>
              <div className="mb-4">
                <label className="block text-xs text-slate-500 mb-1">측정 시간</label>
                <input
                  type="time"
                  value={timeVal}
                  onChange={(e) => setTime(e.target.value)}
                  disabled={!canEdit}
                  className="w-full max-w-[180px] px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm disabled:opacity-70"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {COLD_STORAGE_TEMPERATURE_DEFS.map((def) => {
                  const v = temps[def.key];
                  const isFreezer = def.autoNegative;
                  return (
                    <div key={`${period}-${def.key}`}>
                      <label className="block text-xs text-slate-500 mb-1">
                        {def.label} (℃)
                        {def.kind === "chill_0_10" && (
                          <span className="text-slate-600 ml-1">(기준 0~10℃)</span>
                        )}
                        {def.kind === "freezer_le18" && (
                          <span className="text-slate-600 ml-1">(기준 -18℃ 이하)</span>
                        )}
                        {def.kind === "freezer_le30" && (
                          <span className="text-slate-600 ml-1">(기준 -30℃ 이하)</span>
                        )}
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={v}
                        onChange={(e) => setTempField(period, def.key, e.target.value, "raw")}
                        onBlur={(e) => {
                          if (isFreezer) setTempField(period, def.key, e.currentTarget.value, "freezerBlur");
                        }}
                        disabled={!canEdit}
                        placeholder={isFreezer ? "예: 18 → -18.0" : ""}
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm disabled:opacity-70"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      {hasAnyIssue && (
        <section
          className={`rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8 ${
            !canEdit ? "opacity-80 pointer-events-none" : ""
          }`}
        >
          <h2 className="text-sm font-semibold text-amber-300 mb-1">개선조치</h2>
          <p className="text-xs text-slate-500 mb-4">승인자는 일지 승인 시 자동으로 기록됩니다.</p>
          <div className="grid gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">일시</label>
              <input
                type="datetime-local"
                value={corrective.datetime}
                onChange={(e) => { setCorrectiveDatetimeManuallyEdited(true); setCorrective((c) => ({ ...c, datetime: e.target.value })); }}
                disabled={!canEdit}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">이탈내용 (자동 생성, 필요 시 수정)</label>
              <textarea
                value={corrective.deviation}
                onChange={(e) => {
                  setDeviationManuallyEdited(true);
                  setCorrective((c) => ({ ...c, deviation: e.target.value }));
                }}
                rows={5}
                disabled={!canEdit}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none disabled:opacity-70"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">개선조치내용</label>
              <textarea
                value={corrective.detail}
                onChange={(e) => setCorrective((c) => ({ ...c, detail: e.target.value }))}
                rows={2}
                disabled={!canEdit}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none disabled:opacity-70"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">비고</label>
              <textarea
                value={corrective.remarks}
                onChange={(e) => setCorrective((c) => ({ ...c, remarks: e.target.value }))}
                rows={2}
                disabled={!canEdit}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none disabled:opacity-70"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">개선조치자</label>
              <input
                type="text"
                value={corrective.actor}
                onChange={(e) => setCorrective((c) => ({ ...c, actor: e.target.value }))}
                disabled={!canEdit}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm disabled:opacity-70"
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
          href="/daily/cold-storage-hygiene"
          className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
        >
          목록으로
        </Link>
      </div>
    </div>
  );
}
