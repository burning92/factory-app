"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { TEMP_HUMIDITY_ZONES, type TempHumidityZone } from "@/features/daily/tempHumidityZones";

type LogStatus = "draft" | "submitted" | "approved" | "rejected";

type ZoneReading = { temp: string; humidity: string };

type CorrectiveState = {
  datetime: string;
  deviation: string;
  detail: string;
  remarks: string;
  actor: string;
};

const emptyReadings = (): Record<string, ZoneReading> =>
  Object.fromEntries(TEMP_HUMIDITY_ZONES.map((z) => [z.id, { temp: "", humidity: "" }]));

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseOptionalNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function zoneDeviation(z: TempHumidityZone, r: ZoneReading): boolean {
  const t = parseOptionalNum(r.temp);
  const h = parseOptionalNum(r.humidity);
  return (t != null && t > z.maxTempC) || (h != null && h > z.maxHumidityPct);
}

/** 기준 이탈 구역별로 "구역명 온도/습도 초과" 문구를 줄바꿈으로 이어 붙임 */
function buildAutoDeviationText(
  zones: TempHumidityZone[],
  readings: Record<string, ZoneReading>
): string {
  const lines: string[] = [];
  zones.forEach((z) => {
    const r = readings[z.id] ?? { temp: "", humidity: "" };
    const t = parseOptionalNum(r.temp);
    const h = parseOptionalNum(r.humidity);
    if (t != null && t > z.maxTempC) lines.push(`${z.name} 온도 초과`);
    if (h != null && h > z.maxHumidityPct) lines.push(`${z.name} 습도 초과`);
  });
  return lines.join("\n");
}

type Props = { mode: "new" | "edit"; editLogId?: string };

export function TempHumidityForm({ mode, editLogId }: Props) {
  const router = useRouter();
  const { user, profile, viewOrganizationCode } = useAuth();
  const [inspectionDate, setInspectionDate] = useState(todayStr);
  const [readings, setReadings] = useState<Record<string, ZoneReading>>(emptyReadings);
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

  const orgCode = viewOrganizationCode ?? "100";
  const authorName = (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim();
  const role = profile?.role ?? "worker";
  const isManager = role === "manager" || role === "admin";

  const hasDeviation = useMemo(
    () => TEMP_HUMIDITY_ZONES.some((z) => zoneDeviation(z, readings[z.id] ?? { temp: "", humidity: "" })),
    [readings]
  );

  const autoDeviationText = useMemo(
    () => buildAutoDeviationText(TEMP_HUMIDITY_ZONES, readings),
    [readings]
  );

  useEffect(() => {
    if (hasDeviation && !deviationManuallyEdited) {
      setCorrective((c) => ({ ...c, deviation: autoDeviationText }));
    }
    if (!hasDeviation) {
      setCorrective((c) => ({ ...c, deviation: "" }));
      setDeviationManuallyEdited(false);
    }
  }, [hasDeviation, deviationManuallyEdited, autoDeviationText]);

  const isApproved = currentLogStatus === "approved";
  const isLockedForWorker = isApproved && !isManager;
  const canEdit = !isLockedForWorker && currentLogStatus !== "submitted";
  const canSubmit =
    !isLockedForWorker &&
    (currentLogStatus === "draft" || currentLogStatus === "rejected" || currentLogStatus === null);

  useEffect(() => {
    if (mode === "new" && authorName) {
      setCorrective((c) => ({ ...c, actor: c.actor || authorName }));
    }
  }, [mode, authorName]);

  const buildItemsRows = useCallback(
    (logId: string) =>
      TEMP_HUMIDITY_ZONES.map((z, i) => {
        const r = readings[z.id] ?? { temp: "", humidity: "" };
        return {
          log_id: logId,
          zone_index: i + 1,
          zone_name: z.name,
          max_temp_c: z.maxTempC,
          max_humidity_pct: z.maxHumidityPct,
          actual_temp_c: parseOptionalNum(r.temp),
          actual_humidity_pct: parseOptionalNum(r.humidity),
        };
      }),
    [readings]
  );

  useEffect(() => {
    if (mode !== "edit" || !editLogId) {
      setLoadDone(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data: logData, error } = await supabase
        .from("daily_temp_humidity_logs")
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
      if (log.status === "submitted" || (log.status === "approved" && !isManager)) {
        router.replace(`/daily/temperature-humidity/${editLogId}`);
        return;
      }
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
        .from("daily_temp_humidity_log_items")
        .select("zone_index, actual_temp_c, actual_humidity_pct")
        .eq("log_id", log.id);
      if (cancelled) return;
      const next = emptyReadings();
      (itemsData ?? []).forEach((row: { zone_index: number; actual_temp_c: number | null; actual_humidity_pct: number | null }) => {
        const z = TEMP_HUMIDITY_ZONES[row.zone_index - 1];
        if (!z) return;
        next[z.id] = {
          temp: row.actual_temp_c != null ? String(row.actual_temp_c) : "",
          humidity: row.actual_humidity_pct != null ? String(row.actual_humidity_pct) : "",
        };
      });
      setReadings(next);
      setLoadDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, editLogId, router, isManager, authorName]);

  const correctivePayload = useMemo(() => {
    if (!hasDeviation) {
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
  }, [hasDeviation, corrective]);

  const persistItems = useCallback(
    async (logId: string) => {
      const { error: delErr } = await supabase.from("daily_temp_humidity_log_items").delete().eq("log_id", logId);
      if (delErr) throw delErr;
      const rows = buildItemsRows(logId);
      const { error: insErr } = await supabase.from("daily_temp_humidity_log_items").insert(rows);
      if (insErr) throw insErr;
    },
    [buildItemsRows]
  );

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
        ...correctivePayload,
        updated_at: new Date().toISOString(),
      };

      let logId: string;
      if (mode === "edit" && currentLogId) {
        const { error: updateErr } = await supabase
          .from("daily_temp_humidity_logs")
          .update(payload)
          .eq("id", currentLogId);
        if (updateErr) throw updateErr;
        logId = currentLogId;
      } else {
        const { data: existing } = await supabase
          .from("daily_temp_humidity_logs")
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
            .from("daily_temp_humidity_logs")
            .update(payload)
            .eq("id", existingRow.id);
          if (updateErr) throw updateErr;
          logId = existingRow.id;
        } else {
          const { data: inserted, error: insertErr } = await supabase
            .from("daily_temp_humidity_logs")
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
    authorName,
    correctivePayload,
    user?.id,
    currentLogId,
    currentLogStatus,
    persistItems,
    isManager,
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
          .from("daily_temp_humidity_logs")
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
            .from("daily_temp_humidity_logs")
            .insert({
              organization_code: orgCode,
              inspection_date: date,
              author_name: authorName || null,
              author_user_id: user?.id ?? null,
              status: "draft",
              ...correctivePayload,
              updated_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (insertErr) throw insertErr;
          logId = (inserted as { id: string }).id;
        }
      }

      const headerPatch = {
        organization_code: orgCode,
        inspection_date: date,
        author_name: authorName || null,
        ...correctivePayload,
        updated_at: new Date().toISOString(),
      };
      const { error: patchErr } = await supabase.from("daily_temp_humidity_logs").update(headerPatch).eq("id", logId);
      if (patchErr) throw patchErr;
      await persistItems(logId!);

      const { error: submitErr } = await supabase
        .from("daily_temp_humidity_logs")
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
    persistItems,
    isManager,
  ]);

  const setReading = (zoneId: string, field: keyof ZoneReading, value: string) => {
    setReadings((prev) => ({
      ...prev,
      [zoneId]: { ...(prev[zoneId] ?? { temp: "", humidity: "" }), [field]: value },
    }));
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
        <Link href="/daily/temperature-humidity" className="text-slate-400 hover:text-slate-200 text-sm">
          영업장 온·습도점검일지
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">{mode === "new" ? "새 작성" : "수정"}</span>
      </div>
      <h1 className="text-lg font-semibold text-slate-100 mb-1">
        {mode === "new" ? "새 점검일지 작성" : "점검일지 수정"}
      </h1>
      <p className="text-slate-500 text-sm mb-4">
        구역별 실측 온도·습도를 입력하세요. 기준을 초과하면 개선조치를 작성할 수 있습니다.
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

      {isApproved && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm ${
            isLockedForWorker
              ? "bg-amber-900/20 border border-amber-700/50 text-amber-200"
              : "bg-emerald-900/20 border border-emerald-700/50 text-emerald-200"
          }`}
        >
          {isLockedForWorker
            ? "승인 완료되어 수정할 수 없습니다."
            : "승인 완료된 일지이지만 관리자 권한으로 수정 가능합니다."}
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

      <div className="space-y-3 mb-8">
        {TEMP_HUMIDITY_ZONES.map((z) => {
          const r = readings[z.id] ?? { temp: "", humidity: "" };
          const dev = zoneDeviation(z, r);
          return (
            <section
              key={z.id}
              className={`rounded-xl border overflow-hidden ${
                dev ? "border-amber-600/60 bg-amber-950/10" : "border-slate-700/60 bg-slate-800/50"
              }`}
            >
              <div className="px-4 py-3 border-b border-slate-700/60 bg-slate-800/80">
                <h2 className="text-sm font-semibold text-cyan-300">{z.name}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  온도 기준: {z.maxTempC}°C 이하 · 습도 기준: {z.maxHumidityPct}% 이하
                </p>
              </div>
              <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">실제 온도 (°C)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min={-50}
                    max={100}
                    value={r.temp}
                    onChange={(e) => setReading(z.id, "temp", e.target.value)}
                    disabled={!canEdit}
                    placeholder={`≤ ${z.maxTempC}`}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm disabled:opacity-70"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">실제 습도 (%)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min={0}
                    max={100}
                    value={r.humidity}
                    onChange={(e) => setReading(z.id, "humidity", e.target.value)}
                    disabled={!canEdit}
                    placeholder={`≤ ${z.maxHumidityPct}`}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm disabled:opacity-70"
                  />
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {hasDeviation && (
        <section
          className={`rounded-xl border border-amber-700/50 bg-slate-800/50 p-4 mb-8 ${
            !canEdit ? "opacity-80 pointer-events-none" : ""
          }`}
        >
          <h2 className="text-sm font-semibold text-amber-300 mb-1">개선조치</h2>
          <p className="text-xs text-slate-500 mb-4">
            기준 이탈 구역이 있습니다. 조치 내용을 입력하세요. 승인자는 일지 승인 시 자동으로 기록됩니다.
          </p>
          <div className="grid gap-4">
            <div>
              <label className="block text-xs text-slate-500 mb-1">일시</label>
              <input
                type="datetime-local"
                value={corrective.datetime}
                onChange={(e) => setCorrective((c) => ({ ...c, datetime: e.target.value }))}
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
                rows={3}
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
        {!isLockedForWorker && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2.5 rounded-lg bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white font-medium text-sm"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        )}
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
          href="/daily/temperature-humidity"
          className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
        >
          목록으로
        </Link>
      </div>
    </div>
  );
}
