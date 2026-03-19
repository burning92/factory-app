"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  HYGIENE_CHECKLIST,
  type HygieneFormResults,
  type HygieneCorrectiveInput,
  type HygieneItemResult,
} from "@/features/daily/hygieneChecklist";

type HygieneLogStatus = "draft" | "submitted" | "approved" | "rejected";

const initialCorrective: HygieneCorrectiveInput = {
  content: "",
  datetime: "",
  deviation: "",
  detail: "",
  actor: "",
  approver: "",
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

type Props = {
  mode: "new" | "edit";
  editLogId?: string;
};

export function HygieneForm({ mode, editLogId }: Props) {
  const router = useRouter();
  const { user, profile, viewOrganizationCode } = useAuth();
  const [inspectionDate, setInspectionDate] = useState(todayStr);
  const [results, setResults] = useState<HygieneFormResults>({});
  const [corrective, setCorrective] = useState<HygieneCorrectiveInput>(initialCorrective);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [currentLogId, setCurrentLogId] = useState<string | null>(null);
  const [currentLogStatus, setCurrentLogStatus] = useState<HygieneLogStatus | null>(null);
  const [loadDone, setLoadDone] = useState(mode === "new");

  const orgCode = viewOrganizationCode ?? "100";
  const authorName = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();
  const hasAnyX = useMemo(() => Object.values(results).some((v) => v === "X"), [results]);
  const isLocked = currentLogStatus === "approved";
  const canEdit = !isLocked && currentLogStatus !== "submitted";
  const canSubmit = !isLocked && (currentLogStatus === "draft" || currentLogStatus === "rejected" || currentLogStatus === null);

  const setItemResult = useCallback((key: string, value: HygieneItemResult) => {
    setResults((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    if (mode !== "edit" || !editLogId) {
      setLoadDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: logData, error } = await supabase
        .from("daily_hygiene_logs")
        .select("id, inspection_date, status, corrective_content, corrective_datetime, corrective_deviation, corrective_detail, corrective_actor, corrective_approver")
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
        status: HygieneLogStatus;
        corrective_content: string | null;
        corrective_datetime: string | null;
        corrective_deviation: string | null;
        corrective_detail: string | null;
        corrective_actor: string | null;
        corrective_approver: string | null;
      };
      if (log.status === "approved" || log.status === "submitted") {
        router.replace(`/daily/hygiene/${editLogId}`);
        return;
      }
      setCurrentLogId(log.id);
      setCurrentLogStatus(log.status);
      setInspectionDate(log.inspection_date ?? todayStr());
      setCorrective({
        content: log.corrective_content ?? "",
        datetime: log.corrective_datetime ? String(log.corrective_datetime).slice(0, 16) : "",
        deviation: log.corrective_deviation ?? "",
        detail: log.corrective_detail ?? "",
        actor: log.corrective_actor ?? "",
        approver: log.corrective_approver ?? "",
      });
      const { data: itemsData } = await supabase
        .from("daily_hygiene_log_items")
        .select("category, question_index, question_text, result")
        .eq("log_id", log.id);
      if (cancelled) return;
      const nextResults: HygieneFormResults = {};
      HYGIENE_CHECKLIST.forEach((cat, ci) => {
        cat.questions.forEach((_, qi) => {
          const item = (itemsData ?? []).find(
            (r: { category: string; question_index: number }) =>
              r.category === cat.title && r.question_index === qi + 1
          ) as { result: string } | undefined;
          if (item) nextResults[`${ci}-${qi}`] = item.result as HygieneItemResult;
        });
      });
      setResults(nextResults);
      setLoadDone(true);
    })();
    return () => { cancelled = true; };
  }, [mode, editLogId, router]);

  const handleSave = useCallback(async () => {
    const date = inspectionDate.trim();
    if (!date) {
      setToast({ message: "점검일자를 선택해 주세요.", error: true });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      const payload = {
        organization_code: orgCode,
        inspection_date: date,
        author_name: authorName || null,
        corrective_content: hasAnyX ? (corrective.content || null) : null,
        corrective_datetime: hasAnyX && corrective.datetime ? corrective.datetime : null,
        corrective_deviation: hasAnyX ? (corrective.deviation || null) : null,
        corrective_detail: hasAnyX ? (corrective.detail || null) : null,
        corrective_actor: hasAnyX ? (corrective.actor || null) : null,
        corrective_approver: hasAnyX ? (corrective.approver || null) : null,
        updated_at: new Date().toISOString(),
      };

      let logId: string;
      if (mode === "edit" && currentLogId) {
        const { error: updateErr } = await supabase
          .from("daily_hygiene_logs")
          .update(payload)
          .eq("id", currentLogId);
        if (updateErr) throw updateErr;
        logId = currentLogId;
      } else {
        const { data: existing } = await supabase
          .from("daily_hygiene_logs")
          .select("id, status")
          .eq("organization_code", orgCode)
          .eq("inspection_date", date)
          .maybeSingle();
        const existingRow = existing as { id: string; status: HygieneLogStatus } | null;
        if (existingRow?.status === "approved") {
          setToast({ message: "승인 완료된 일지는 수정할 수 없습니다.", error: true });
          setSaving(false);
          return;
        }
        if (existingRow) {
          const { error: updateErr } = await supabase
            .from("daily_hygiene_logs")
            .update(payload)
            .eq("id", existingRow.id);
          if (updateErr) throw updateErr;
          logId = existingRow.id;
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("daily_hygiene_logs")
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

      const { error: delErr } = await supabase.from("daily_hygiene_log_items").delete().eq("log_id", logId);
      if (delErr) throw delErr;

      const items: { log_id: string; category: string; question_index: number; question_text: string; result: string }[] = [];
      HYGIENE_CHECKLIST.forEach((cat, ci) => {
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
            });
          }
        });
      });
      if (items.length > 0) {
        const { error: itemsErr } = await supabase.from("daily_hygiene_log_items").insert(items);
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
  }, [
    mode,
    orgCode,
    inspectionDate,
    authorName,
    results,
    corrective,
    hasAnyX,
    user?.id,
    currentLogId,
    currentLogStatus,
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
          .from("daily_hygiene_logs")
          .select("id, status")
          .eq("organization_code", orgCode)
          .eq("inspection_date", date)
          .maybeSingle();
        const existingRow = existing as { id: string; status: HygieneLogStatus } | null;
        if (existingRow?.status === "approved") {
          setToast({ message: "승인 완료된 일지는 수정할 수 없습니다.", error: true });
          setSaving(false);
          return;
        }
        if (existingRow) {
          logId = existingRow.id;
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("daily_hygiene_logs")
            .insert({
              organization_code: orgCode,
              inspection_date: date,
              author_name: authorName || null,
              author_user_id: user?.id ?? null,
              status: "draft",
              corrective_content: hasAnyX ? (corrective.content || null) : null,
              corrective_datetime: hasAnyX && corrective.datetime ? corrective.datetime : null,
              corrective_deviation: hasAnyX ? (corrective.deviation || null) : null,
              corrective_detail: hasAnyX ? (corrective.detail || null) : null,
              corrective_actor: hasAnyX ? (corrective.actor || null) : null,
              corrective_approver: hasAnyX ? (corrective.approver || null) : null,
              updated_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (insertErr) throw insertErr;
          logId = (inserted as { id: string }).id;
          const items: { log_id: string; category: string; question_index: number; question_text: string; result: string }[] = [];
          HYGIENE_CHECKLIST.forEach((cat, ci) => {
            cat.questions.forEach((q, qi) => {
              const key = `${ci}-${qi}`;
              const r = results[key];
              if (r === "O" || r === "X") {
                items.push({
                  log_id: logId!,
                  category: cat.title,
                  question_index: qi + 1,
                  question_text: q,
                  result: r,
                });
              }
            });
          });
          if (items.length > 0) {
            const { error: itemsErr } = await supabase.from("daily_hygiene_log_items").insert(items);
            if (itemsErr) throw itemsErr;
          }
        }
      }
      const { error: submitErr } = await supabase
        .from("daily_hygiene_logs")
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
    results,
    corrective,
    hasAnyX,
  ]);

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
        <Link href="/daily/hygiene" className="text-slate-400 hover:text-slate-200 text-sm">영업장환경위생점검일지</Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{mode === "new" ? "새 작성" : "수정"}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">
        {mode === "new" ? "새 점검일지 작성" : "점검일지 수정"}
      </h1>
      <p className="text-slate-500 text-sm mb-4">점검일자 선택 후 O/X 입력, 부적합 시 조치 내용을 입력한 뒤 저장하세요.</p>

      {toast && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${toast.error ? "bg-red-900/30 text-red-200" : "bg-cyan-900/30 text-cyan-200"}`}>
          {toast.message}
        </div>
      )}

      {currentLogStatus != null && (
        <div className="mb-4 px-4 py-2 rounded-lg text-sm bg-slate-800/80 border border-slate-600">
          <span className="text-slate-400">상태: </span>
          <span className={
            currentLogStatus === "approved" ? "text-emerald-400 font-medium" :
            currentLogStatus === "submitted" ? "text-cyan-400" :
            currentLogStatus === "rejected" ? "text-amber-400" : "text-slate-300"
          }>
            {currentLogStatus === "draft" && "작성중"}
            {currentLogStatus === "submitted" && "제출됨"}
            {currentLogStatus === "approved" && "승인 완료"}
            {currentLogStatus === "rejected" && "반려"}
          </span>
        </div>
      )}

      {isLocked && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-900/20 border border-amber-700/50 text-amber-200 text-sm">
          승인 완료된 일지입니다. 수정할 수 없습니다.
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
        {HYGIENE_CHECKLIST.map((category, catIndex) => (
          <section key={category.title} className="rounded-xl border border-slate-700/60 bg-slate-800/50 overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-semibold text-cyan-300 bg-slate-800/80 border-b border-slate-700/60">{category.title}</h2>
            <ul className="divide-y divide-slate-700/50">
              {category.questions.map((question, qIndex) => {
                const key = `${catIndex}-${qIndex}`;
                const value = results[key] ?? "";
                return (
                  <li key={key} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <p className="flex-1 text-sm text-slate-300 min-w-0">{question}</p>
                    <div className="flex gap-3 shrink-0">
                      <label className={`flex items-center gap-1.5 ${!canEdit ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
                        <input type="radio" name={key} checked={value === "O"} onChange={() => setItemResult(key, "O")} disabled={!canEdit} className="rounded border-slate-500 text-cyan-500 focus:ring-cyan-500/50 disabled:cursor-not-allowed" />
                        <span className="text-sm text-slate-300">O</span>
                      </label>
                      <label className={`flex items-center gap-1.5 ${!canEdit ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}>
                        <input type="radio" name={key} checked={value === "X"} onChange={() => setItemResult(key, "X")} disabled={!canEdit} className="rounded border-slate-500 text-cyan-500 focus:ring-cyan-500/50 disabled:cursor-not-allowed" />
                        <span className="text-sm text-slate-300">X</span>
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {hasAnyX && (
        <section className={`rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8 ${!canEdit ? "opacity-80 pointer-events-none" : ""}`}>
          <h2 className="text-sm font-semibold text-amber-300 mb-4">부적합 조치</h2>
          <div className="grid gap-4 sm:grid-cols-1">
            <div>
              <label className="block text-xs text-slate-500 mb-1">내용</label>
              <input type="text" value={corrective.content} onChange={(e) => setCorrective((c) => ({ ...c, content: e.target.value }))} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm disabled:opacity-70" placeholder="내용" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">일시</label>
              <input type="datetime-local" value={corrective.datetime} onChange={(e) => setCorrective((c) => ({ ...c, datetime: e.target.value }))} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">이탈내용</label>
              <textarea value={corrective.deviation} onChange={(e) => setCorrective((c) => ({ ...c, deviation: e.target.value }))} rows={2} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none disabled:opacity-70" placeholder="이탈내용" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">세부 개선 조치 내역</label>
              <textarea value={corrective.detail} onChange={(e) => setCorrective((c) => ({ ...c, detail: e.target.value }))} rows={2} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm resize-none disabled:opacity-70" placeholder="세부 개선 조치 내역" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">개선조치자</label>
                <input type="text" value={corrective.actor} onChange={(e) => setCorrective((c) => ({ ...c, actor: e.target.value }))} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm disabled:opacity-70" />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">승인자</label>
                <input type="text" value={corrective.approver} onChange={(e) => setCorrective((c) => ({ ...c, approver: e.target.value }))} disabled={!canEdit} className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm disabled:opacity-70" />
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="flex flex-wrap justify-end gap-2 mb-10">
        {!isLocked && (
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
        <Link href="/daily/hygiene" className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm">
          목록으로
        </Link>
      </div>
    </div>
  );
}
