"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { parseProductLabel } from "@/features/production/history/productLabel";
import {
  PROCESS_CONTROL_BREAD_STAGES,
  buildProcessControlBreadAutoDeviationText,
  hasAnyProcessControlBreadFail,
  type ProcessControlBreadResult,
  type ProcessControlBreadResultMap,
} from "@/features/daily/processControlBreadChecklist";

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

function randomTimeInRange(startHour: number, startMinute: number, endHour: number, endMinute: number): string {
  const minMin = startHour * 60 + startMinute;
  const maxMin = endHour * 60 + endMinute;
  const total = Math.floor(Math.random() * (maxMin - minMin + 1)) + minMin;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function combineDateAndTime(date: string, time: string): string {
  if (!date || !time) return "";
  return `${date}T${time}`;
}

function parseOptionalNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n;
}

function syncDateToDatetimeLocal(existing: string, date: string): string {
  if (!date) return existing;
  const timePart = existing.includes("T") ? existing.slice(11, 16) : "00:00";
  const safeTime = timePart.length === 5 ? timePart : "00:00";
  return `${date}T${safeTime}`;
}

export function ProcessControlBreadForm({ mode, editLogId }: Props) {
  const router = useRouter();
  const { user, profile, viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const authorName = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();
  const role = profile?.role ?? "worker";
  const isManager = role === "manager" || role === "admin";

  const defaultTimesRef = useRef({
    workStart: randomTimeInRange(8, 0, 8, 10),
    workEnd: randomTimeInRange(17, 50, 18, 0),
    fermentationStart: randomTimeInRange(7, 15, 7, 40),
    fermentationEnd: randomTimeInRange(7, 53, 8, 0),
  });

  const [inspectionDate, setInspectionDate] = useState(todayStr);
  const [productName, setProductName] = useState("");
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [productOptionsLoading, setProductOptionsLoading] = useState(false);
  const [productHint, setProductHint] = useState<string | null>(null);
  const [workStartTime, setWorkStartTime] = useState(() => (mode === "new" ? defaultTimesRef.current.workStart : ""));
  const [workEndTime, setWorkEndTime] = useState(() => (mode === "new" ? defaultTimesRef.current.workEnd : ""));
  const [fermentationStartAt, setFermentationStartAt] = useState("");
  const [fermentationEndAt, setFermentationEndAt] = useState("");
  const [toppingWeightCheckG, setToppingWeightCheckG] = useState("");
  const [notes, setNotes] = useState("");
  const [results, setResults] = useState<ProcessControlBreadResultMap>({});
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

  const fermentationStartTouchedRef = useRef(false);
  const fermentationEndTouchedRef = useRef(false);

  const hasAnyIssue = useMemo(() => hasAnyProcessControlBreadFail(results), [results]);
  const autoDeviationText = useMemo(
    () => buildProcessControlBreadAutoDeviationText(results),
    [results]
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

  const isApproved = currentLogStatus === "approved";
  const isLockedForWorker = isApproved && !isManager;
  const canEdit = !isLockedForWorker && currentLogStatus !== "submitted";
  const canSubmit =
    !isLockedForWorker &&
    (currentLogStatus === "draft" || currentLogStatus === "rejected" || currentLogStatus === null);

  const setItemResult = useCallback((index: number, value: ProcessControlBreadResult) => {
    setResults((prev) => ({ ...prev, [String(index)]: value }));
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
        .from("daily_process_control_bread_logs")
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
        product_name: string | null;
        work_start_time: string | null;
        work_end_time: string | null;
        fermentation_start_at: string | null;
        fermentation_end_at: string | null;
        topping_weight_check_g: number | null;
        notes: string | null;
        status: LogStatus;
        corrective_datetime: string | null;
        corrective_deviation: string | null;
        corrective_detail: string | null;
        corrective_remarks: string | null;
        corrective_actor: string | null;
      };
      if (log.status === "submitted" || (log.status === "approved" && !isManager)) {
        router.replace(`/daily/process-control-bread/${editLogId}`);
        return;
      }
      setCurrentLogId(log.id);
      setCurrentLogStatus(log.status);
      setInspectionDate(log.inspection_date ?? todayStr());
      setProductName(log.product_name ?? "");
      setWorkStartTime(log.work_start_time ?? "");
      setWorkEndTime(log.work_end_time ?? "");
      setFermentationStartAt(log.fermentation_start_at ? String(log.fermentation_start_at).slice(0, 16) : "");
      setFermentationEndAt(log.fermentation_end_at ? String(log.fermentation_end_at).slice(0, 16) : "");
      setToppingWeightCheckG(
        log.topping_weight_check_g != null && Number.isFinite(Number(log.topping_weight_check_g))
          ? String(log.topping_weight_check_g)
          : ""
      );
      setNotes(log.notes ?? "");
      setCorrective({
        datetime: log.corrective_datetime ? String(log.corrective_datetime).slice(0, 16) : "",
        deviation: log.corrective_deviation ?? "",
        detail: log.corrective_detail ?? "",
        remarks: log.corrective_remarks ?? "",
        actor: log.corrective_actor ?? authorName,
      });

      const { data: itemsData } = await supabase
        .from("daily_process_control_bread_log_items")
        .select("stage_index, result")
        .eq("log_id", log.id)
        .order("stage_index");
      if (cancelled) return;
      const nextResults: ProcessControlBreadResultMap = {};
      (itemsData ?? []).forEach((row: { stage_index: number; result: string }) => {
        if (row.result === "O" || row.result === "X") nextResults[String(row.stage_index - 1)] = row.result;
      });
      setResults(nextResults);
      setLoadDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, editLogId, router, isManager, authorName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!inspectionDate) return;
      setProductOptionsLoading(true);
      const { data: productRows, error: productErr } = await supabase
        .from("production_logs")
        .select("product_name")
        .eq("production_date", inspectionDate);

      if (!cancelled) {
        if (productErr) {
          setProductOptions([]);
          setProductHint("생산 제품 목록을 불러오지 못했습니다.");
          setProductName("");
        } else {
          const seen = new Set<string>();
          const names: string[] = [];
          (productRows ?? []).forEach((row: { product_name: string | null }) => {
            const n = (row.product_name ?? "").trim();
            if (!n) return;
            const parsed = parseProductLabel(n);
            const base = parsed.baseProductName.trim() || n;
            if (seen.has(base)) return;
            seen.add(base);
            names.push(base);
          });
          setProductOptions(names);
          setProductHint(names.length === 0 ? "해당 점검일자와 일치하는 생산 제품이 없습니다." : null);
          setProductName(names.join(", "));
        }
        setProductOptionsLoading(false);
      }

      const { data: doughRows, error: doughErr } = await supabase
        .from("dough_logs")
        .select("dough_date")
        .eq("usage_date", inspectionDate)
        .not("dough_date", "is", null)
        .order("dough_date", { ascending: true })
        .limit(1);

      if (cancelled || mode !== "new") return;
      if (!fermentationEndTouchedRef.current) {
        setFermentationEndAt(
          combineDateAndTime(inspectionDate, defaultTimesRef.current.fermentationEnd)
        );
      }
      if (!fermentationStartTouchedRef.current) {
        if (!doughErr) {
          const doughDate = (doughRows?.[0] as { dough_date?: string } | undefined)?.dough_date?.slice(0, 10) ?? "";
          if (doughDate) {
            setFermentationStartAt(
              combineDateAndTime(doughDate, defaultTimesRef.current.fermentationStart)
            );
          } else {
            setFermentationStartAt("");
          }
        } else {
          setFermentationStartAt("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inspectionDate, mode]);

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
        .from("daily_process_control_bread_log_items")
        .delete()
        .eq("log_id", logId);
      if (delErr) throw delErr;
      const rows = PROCESS_CONTROL_BREAD_STAGES.map((stage, idx) => {
        const result = results[String(idx)];
        if (result !== "O" && result !== "X") return null;
        return {
          log_id: logId,
          stage_index: idx + 1,
          stage_name: stage,
          result,
        };
      }).filter(Boolean);
      if (rows.length > 0) {
        const { error: insErr } = await supabase
          .from("daily_process_control_bread_log_items")
          .insert(rows as Array<{ log_id: string; stage_index: number; stage_name: string; result: "O" | "X" }>);
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
      product_name: productName.trim() || null,
      work_start_time: workStartTime.trim() || null,
      work_end_time: workEndTime.trim() || null,
      fermentation_start_at: fermentationStartAt || null,
      fermentation_end_at: fermentationEndAt || null,
      topping_weight_check_g: parseOptionalNum(toppingWeightCheckG),
      notes: notes.trim() || null,
      ...correctivePayload,
      updated_at: new Date().toISOString(),
    };
  }, [
    orgCode,
    inspectionDate,
    authorName,
    productName,
    workStartTime,
    workEndTime,
    fermentationStartAt,
    fermentationEndAt,
    toppingWeightCheckG,
    notes,
    correctivePayload,
  ]);

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
          .from("daily_process_control_bread_logs")
          .update(payload)
          .eq("id", currentLogId);
        if (updateErr) throw updateErr;
        logId = currentLogId;
      } else {
        const { data: existing } = await supabase
          .from("daily_process_control_bread_logs")
          .select("id, status")
          .eq("organization_code", orgCode)
          .eq("inspection_date", date)
          .maybeSingle();
        const existingRow = existing as { id: string; status: LogStatus } | null;
        if (existingRow?.status === "approved" && !isManager) {
          setToast({ message: "승인 완료된 일지는 수정할 수 없습니다.", error: true });
          setSaving(false);
          return;
        }
        if (existingRow) {
          const { error: updateErr } = await supabase
            .from("daily_process_control_bread_logs")
            .update(payload)
            .eq("id", existingRow.id);
          if (updateErr) throw updateErr;
          logId = existingRow.id;
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("daily_process_control_bread_logs")
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
  }, [inspectionDate, baseHeaderFields, mode, currentLogId, orgCode, isManager, user?.id, persistItems, currentLogStatus]);

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
          .from("daily_process_control_bread_logs")
          .select("id, status")
          .eq("organization_code", orgCode)
          .eq("inspection_date", date)
          .maybeSingle();
        const existingRow = existing as { id: string; status: LogStatus } | null;
        if (existingRow?.status === "approved" && !isManager) {
          setToast({ message: "승인 완료된 일지는 수정할 수 없습니다.", error: true });
          setSaving(false);
          return;
        }
        if (existingRow) {
          logId = existingRow.id;
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("daily_process_control_bread_logs")
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
        .from("daily_process_control_bread_logs")
        .update(baseHeaderFields())
        .eq("id", logId);
      if (patchErr) throw patchErr;
      await persistItems(logId!);

      const { error: submitErr } = await supabase
        .from("daily_process_control_bread_logs")
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
  }, [inspectionDate, currentLogId, orgCode, isManager, baseHeaderFields, user?.id, persistItems]);

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
        <Link href="/daily/process-control-bread" className="text-slate-400 hover:text-slate-200 text-sm">
          공정관리 점검일지(빵류)
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{mode === "new" ? "새 작성" : "수정"}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">{mode === "new" ? "새 점검일지 작성" : "점검일지 수정"}</h1>

      {toast && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${toast.error ? "bg-red-900/30 text-red-200" : "bg-cyan-900/30 text-cyan-200"}`}>
          {toast.message}
        </div>
      )}

      {currentLogStatus != null && (
        <div className="mb-4 px-4 py-2 rounded-lg text-sm bg-slate-800/80 border border-slate-600">
          <span className="text-slate-400">상태: </span>
          <span className={currentLogStatus === "approved" ? "text-emerald-400 font-medium" : currentLogStatus === "submitted" ? "text-cyan-400" : currentLogStatus === "rejected" ? "text-amber-400" : "text-slate-300"}>
            {currentLogStatus === "draft" && "작성중"}
            {currentLogStatus === "submitted" && "제출됨"}
            {currentLogStatus === "approved" && "승인 완료"}
            {currentLogStatus === "rejected" && "반려"}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">점검일자</label>
          <input
            type="date"
            value={inspectionDate}
            onChange={(e) => setInspectionDate(e.target.value)}
            disabled={!canEdit}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">제품명 (점검일자 생산 품목)</label>
          <textarea
            value={productName}
            readOnly
            rows={2}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none"
          />
          {!productOptionsLoading && productOptions.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">{productOptions.length}개 품목 자동 반영</p>
          )}
          {productOptionsLoading && <p className="text-xs text-slate-500 mt-1">생산 제품 목록을 불러오는 중…</p>}
          {productHint && <p className="text-xs text-slate-500 mt-1">{productHint}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">작업시작시간</label>
          <input type="time" value={workStartTime} onChange={(e) => setWorkStartTime(e.target.value)} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 disabled:opacity-60" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">작업종료시간</label>
          <input type="time" value={workEndTime} onChange={(e) => setWorkEndTime(e.target.value)} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 disabled:opacity-60" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">숙성 시작 (월/일/시간)</label>
          <input
            type="datetime-local"
            value={fermentationStartAt}
            onChange={(e) => {
              fermentationStartTouchedRef.current = true;
              setFermentationStartAt(e.target.value);
            }}
            disabled={!canEdit}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 disabled:opacity-60"
          />
          {!fermentationStartAt && mode === "new" && (
            <p className="text-xs text-slate-500 mt-1">반죽 데이터(사용일자=점검일자) 없으면 자동 입력되지 않습니다.</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">숙성 종료 (월/일/시간)</label>
          <input
            type="datetime-local"
            value={fermentationEndAt}
            onChange={(e) => {
              fermentationEndTouchedRef.current = true;
              setFermentationEndAt(e.target.value);
            }}
            disabled={!canEdit}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 disabled:opacity-60"
          />
        </div>
      </div>

      <div className="space-y-2 mb-8">
        {PROCESS_CONTROL_BREAD_STAGES.map((stage, idx) => {
          const key = String(idx);
          const value = results[key] ?? "";
          return (
            <div key={stage} className="px-4 py-3 rounded-xl border border-slate-700/60 bg-slate-800/50 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <p className="flex-1 text-sm text-slate-300">{stage}</p>
              <div className="flex gap-2 shrink-0">
                <button type="button" disabled={!canEdit} onClick={() => setItemResult(idx, "O")} className={`px-4 py-2 rounded-lg text-sm font-medium border ${value === "O" ? "bg-emerald-600 border-emerald-500 text-white" : "bg-slate-800/80 border-slate-600 text-slate-300 hover:bg-slate-700/60"} disabled:opacity-50`}>적합</button>
                <button type="button" disabled={!canEdit} onClick={() => setItemResult(idx, "X")} className={`px-4 py-2 rounded-lg text-sm font-medium border ${value === "X" ? "bg-amber-700 border-amber-500 text-white" : "bg-slate-800/80 border-slate-600 text-slate-300 hover:bg-slate-700/60"} disabled:opacity-50`}>부적합</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-1">토핑 원료중량체크 평균 (g)</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={toppingWeightCheckG}
            onChange={(e) => setToppingWeightCheckG(e.target.value)}
            disabled={!canEdit}
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 disabled:opacity-60"
          />
        </div>
      </div>

      <div className="mb-8">
        <label className="block text-sm font-medium text-slate-400 mb-1">특이사항</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          disabled={!canEdit}
          className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none disabled:opacity-60"
        />
      </div>

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
              <textarea value={corrective.deviation} onChange={(e) => { setDeviationManuallyEdited(true); setCorrective((c) => ({ ...c, deviation: e.target.value })); }} rows={4} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none disabled:opacity-70" />
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
        {!isLockedForWorker && (
          <button type="button" onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white font-medium text-sm">
            {saving ? "저장 중…" : "저장"}
          </button>
        )}
        {canSubmit && (
          <button type="button" onClick={handleSubmit} disabled={saving} className="px-6 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium text-sm">
            {saving ? "처리 중…" : "제출"}
          </button>
        )}
      </div>

      <div className="flex justify-end">
        <Link href="/daily/process-control-bread" className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm">
          목록으로
        </Link>
      </div>
    </div>
  );
}
