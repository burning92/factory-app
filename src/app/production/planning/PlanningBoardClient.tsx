"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Save, Copy, Plus, Trash2, Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  computeActualManpower,
  computeMaterialRequirements,
  computeMonthlySummary,
  computeProcessedRows,
  getDateRange,
  isKoreanPublicHoliday,
  monthDays,
  weekdayOfFirstDay,
  ymd,
} from "@/features/production/planning/calculations";
import type {
  MaterialRequirementRow,
  PlanningDayEntryInput,
  PlanningMonthData,
  PlanningRangeMode,
} from "@/features/production/planning/types";
import { supabase } from "@/lib/supabase";

type DayDraft = {
  entries: Array<{
    productBase: string;
    productKind: string;
    qtyText: string;
    sort_order: number;
  }>;
  leaves: { leave_type: "annual" | "half"; person_name: string }[];
  notes: string[];
  noteInput: string;
  otherCount: number;
};

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function formatMonthTitle(year: number, month: number): string {
  return `${year}년 ${month}월`;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function toNumber(input: string): number {
  const n = Number(String(input).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function splitProductName(full: string): { base: string; kind: string } {
  const raw = full.trim();
  const idx = raw.indexOf(" - ");
  if (idx < 0) return { base: raw, kind: "" };
  return {
    base: raw.slice(0, idx).trim(),
    kind: raw.slice(idx + 3).trim(),
  };
}

function composeProductName(base: string, kind: string): string {
  if (!kind.trim()) return base.trim();
  return `${base.trim()} - ${kind.trim()}`;
}

function splitForDisplay(full: string): { base: string; kind: string } {
  const { base, kind } = splitProductName(full);
  return { base, kind };
}

function getPlanEntryClass(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("파베이크")) return "bg-sky-500/20 text-sky-100 border border-sky-500/40";
  if (n.includes("미니") || n.includes("판매용")) return "bg-emerald-500/20 text-emerald-100 border border-emerald-500/40";
  return "bg-cyan-500/20 text-cyan-100 border border-cyan-500/40";
}

export default function PlanningBoardClient() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tab, setTab] = useState<"detail" | "materials" | "summary" | "processed">("detail");
  const [data, setData] = useState<PlanningMonthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string>(() => ymd(now.getFullYear(), now.getMonth() + 1, now.getDate()));
  const [draft, setDraft] = useState<DayDraft>({
    entries: [],
    leaves: [],
    notes: [],
    noteInput: "",
    otherCount: 0,
  });
  const [detailMode, setDetailMode] = useState<"production" | "leave">("production");
  const [originalSerialized, setOriginalSerialized] = useState("");
  const [rangeMode, setRangeMode] = useState<PlanningRangeMode>("from_selected");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showOnlyShortage, setShowOnlyShortage] = useState(false);

  const { profile } = useAuth();
  const canEdit = profile?.role === "admin" || profile?.role === "manager";
  const yearOptions = useMemo(() => {
    const start = 2026;
    const end = Math.max(2032, now.getFullYear() + 5);
    const arr: number[] = [];
    for (let y = start; y <= end; y += 1) arr.push(y);
    return arr;
  }, [now]);
  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);

  const loadMonth = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      year: String(year),
      month: String(month),
    });
    const res = await fetch(`/api/production/planning/month?${qs.toString()}`);
    const json = (await res.json()) as { ok?: boolean; data?: PlanningMonthData; error?: string; message?: string };
    setLoading(false);
    if (!res.ok || !json.ok || !json.data) {
      setError(json.message ?? json.error ?? "월간 계획을 불러오지 못했습니다.");
      return;
    }
    setData(json.data);
    const start = ymd(year, month, 1);
    const end = ymd(year, month, monthDays(year, month));
    setSelectedDate((prev) => (prev < start || prev > end ? start : prev));
  }, [month, year]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  const notesByDate = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of data?.notes ?? []) {
      const list = map.get(n.plan_date) ?? [];
      list.push(n.note_text);
      map.set(n.plan_date, list);
    }
    return map;
  }, [data?.notes]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, PlanningDayEntryInput[]>();
    for (const e of data?.entries ?? []) {
      const list = map.get(e.plan_date) ?? [];
      list.push({
        product_name_snapshot: e.product_name_snapshot,
        qty: e.qty,
        sort_order: e.sort_order,
      });
      map.set(e.plan_date, list);
    }
    for (const [key, list] of Array.from(map.entries())) {
      map.set(key, list.sort((a, b) => a.sort_order - b.sort_order));
    }
    return map;
  }, [data?.entries]);

  const manpowerByDate = useMemo(() => {
    const map = new Map<string, { annual: number; half: number; other: number; actual: number }>();
    for (const m of data?.manpower ?? []) {
      map.set(m.plan_date, {
        annual: m.annual_leave_count,
        half: m.half_day_count,
        other: m.other_count,
        actual: Number(m.actual_manpower ?? 0),
      });
    }
    return map;
  }, [data?.manpower]);

  const productOptionMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of data?.products ?? []) {
      const { base, kind } = splitProductName(p);
      if (!base) continue;
      const list = map.get(base) ?? [];
      if (kind && !list.includes(kind)) list.push(kind);
      map.set(base, list);
    }
    for (const [k, list] of Array.from(map.entries())) {
      map.set(k, list.sort((a, b) => a.localeCompare(b)));
    }
    return map;
  }, [data?.products]);

  const baseProductOptions = useMemo(() => Array.from(productOptionMap.keys()).sort((a, b) => a.localeCompare(b)), [productOptionMap]);

  const leavesByDate = useMemo(() => {
    const map = new Map<string, { leave_type: "annual" | "half"; person_name: string }[]>();
    for (const l of data?.leaves ?? []) {
      const list = map.get(l.plan_date) ?? [];
      list.push({ leave_type: l.leave_type, person_name: l.person_name });
      map.set(l.plan_date, list);
    }
    return map;
  }, [data?.leaves]);

  useEffect(() => {
    if (!data) return;
    const dayEntries = entriesByDate.get(selectedDate) ?? [];
    const notes = notesByDate.get(selectedDate) ?? [];
    const mp = manpowerByDate.get(selectedDate) ?? { annual: 0, half: 0, other: 0, actual: 0 };
    const next: DayDraft = {
      entries: dayEntries.map((e, idx) => {
        const { base, kind } = splitProductName(e.product_name_snapshot);
        return {
          productBase: base,
          productKind: kind,
          qtyText: Number(e.qty || 0).toLocaleString("ko-KR"),
          sort_order: idx,
        };
      }),
      leaves: (leavesByDate.get(selectedDate) ?? []).map((l) => ({ ...l })),
      notes: notes.map((n) => String(n)),
      noteInput: "",
      otherCount: mp.other,
    };
    const serialized = JSON.stringify(next);
    setDraft(next);
    setOriginalSerialized(serialized);
  }, [data, entriesByDate, leavesByDate, manpowerByDate, notesByDate, selectedDate]);

  const dirty = useMemo(() => JSON.stringify(draft) !== originalSerialized, [draft, originalSerialized]);

  const firstWeekday = weekdayOfFirstDay(year, month);
  const daysInMonth = monthDays(year, month);
  const dayCells = useMemo(() => {
    const arr: Array<string | null> = [];
    for (let i = 0; i < firstWeekday; i += 1) arr.push(null);
    for (let d = 1; d <= daysInMonth; d += 1) arr.push(ymd(year, month, d));
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [daysInMonth, firstWeekday, month, year]);

  const monthEnd = ymd(year, month, daysInMonth);

  const monthSummary = useMemo(() => {
    if (!data) return null;
    return computeMonthlySummary({
      year,
      month,
      entries: data.entries,
      notes: data.notes,
      materialRows: data.materialRows,
      bomRows: data.bomRows,
      inventoryRows: data.inventoryRows,
    });
  }, [data, month, year]);

  const materialRows = useMemo(() => {
    if (!data) return [] as MaterialRequirementRow[];
    const range = getDateRange({
      year,
      month,
      selectedDate,
      mode: rangeMode,
      customStart,
      customEnd,
    });
    const rows = computeMaterialRequirements({
      entries: data.entries,
      bomRows: data.bomRows,
      materialRows: data.materialRows,
      inventoryRows: data.inventoryRows,
      startDate: range.start,
      endDate: range.end,
    });
    return showOnlyShortage ? rows.filter((r) => r.shortage_g > 0) : rows;
  }, [customEnd, customStart, data, month, rangeMode, selectedDate, showOnlyShortage, year]);

  const processedRows = useMemo(() => {
    if (!data) return [];
    return computeProcessedRows({
      entries: data.entries,
      notes: data.notes,
      manpowerRows: data.manpower,
    });
  }, [data]);

  const selectedDayTotal = useMemo(() => draft.entries.reduce((s, e) => s + (toNumber(e.qtyText) || 0), 0), [draft.entries]);
  const annualCount = useMemo(
    () => draft.leaves.filter((l) => l.leave_type === "annual" && l.person_name.trim().length > 0).length,
    [draft.leaves]
  );
  const halfCount = useMemo(
    () => draft.leaves.filter((l) => l.leave_type === "half" && l.person_name.trim().length > 0).length,
    [draft.leaves]
  );
  const baselineHeadcount = data?.month.baseline_headcount ?? Math.max(1, data?.totalMembers ?? 25);
  const selectedActualManpower = computeActualManpower(
    baselineHeadcount,
    annualCount,
    halfCount,
    draft.otherCount
  );

  const saveDay = async () => {
    if (!data || !canEdit) return;
    setSaving(true);
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setSaving(false);
      setError("로그인 세션이 없습니다.");
      return;
    }

    const payload = {
      month_id: data.month.id,
      plan_date: selectedDate,
      entries: draft.entries.map((e, idx) => ({
        product_name_snapshot: composeProductName(e.productBase, e.productKind),
        qty: toNumber(e.qtyText) || 0,
        sort_order: idx,
      })),
      leaves: draft.leaves
        .map((l) => ({ leave_type: l.leave_type, person_name: l.person_name.trim() }))
        .filter((l) => l.person_name.length > 0),
      notes: draft.notes.map((n) => n.trim()).filter(Boolean),
      annual_leave_count: annualCount,
      half_day_count: halfCount,
      other_count: Number(draft.otherCount) || 0,
      baseline_headcount: baselineHeadcount,
    };

    const res = await fetch("/api/production/planning/day", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        payload,
      }),
    });
    const json = (await res.json()) as { error?: string; message?: string };
    setSaving(false);
    if (!res.ok) {
      setError(json.message ?? json.error ?? "저장 실패");
      return;
    }
    await loadMonth();
  };

  const addEntryRow = () => {
    const base = baseProductOptions[0] ?? "";
    const kind = base ? (productOptionMap.get(base)?.[0] ?? "") : "";
    setDraft((prev) => ({
      ...prev,
      entries: [...prev.entries, { productBase: base, productKind: kind, qtyText: "0", sort_order: prev.entries.length }],
    }));
  };

  const duplicateToAnotherDate = async () => {
    const target = window.prompt("복제 대상 날짜(YYYY-MM-DD)");
    if (!target || !/^\d{4}-\d{2}-\d{2}$/.test(target) || !data) return;
    const nextPayload = {
      month_id: data.month.id,
      plan_date: target,
      entries: draft.entries.map((e, idx) => ({
        product_name_snapshot: composeProductName(e.productBase, e.productKind),
        qty: toNumber(e.qtyText) || 0,
        sort_order: idx,
      })),
      leaves: draft.leaves
        .map((l) => ({ leave_type: l.leave_type, person_name: l.person_name.trim() }))
        .filter((l) => l.person_name.length > 0),
      notes: draft.notes.map((n) => n.trim()).filter(Boolean),
      annual_leave_count: annualCount,
      half_day_count: halfCount,
      other_count: Number(draft.otherCount) || 0,
      baseline_headcount: baselineHeadcount,
    };
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError("로그인 세션이 없습니다.");
      return;
    }
    const res = await fetch("/api/production/planning/day", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        payload: nextPayload,
      }),
    });
    if (!res.ok) {
      setError("날짜 복제 저장 실패");
      return;
    }
    await loadMonth();
  };

  const downloadProcessedCsv = () => {
    const header = ["날짜", "제품명", "수량", "투입인원", "비고"];
    const lines = processedRows.map((r) => [r.plan_date, r.product_name, String(r.qty), String(r.manpower), (r.note ?? "").replaceAll("\n", " / ")]);
    const csv = [header, ...lines]
      .map((row) =>
        row
          .map((cell) => {
            const escaped = String(cell).replaceAll('"', '""');
            return `"${escaped}"`;
          })
          .join(",")
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `production-plan-processed-${monthKey(year, month)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700 bg-space-900/40 p-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-cyan-300" />
          <h1 className="text-lg font-semibold text-slate-100">월간 생산계획 보드</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || year)}
            className="px-2 py-1 rounded border border-slate-600 bg-space-900 text-slate-200"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value) || month)}
            className="px-2 py-1 rounded border border-slate-600 bg-space-900 text-slate-200"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {m}월
              </option>
            ))}
          </select>
          <span className="px-2 py-1 rounded bg-slate-800 text-slate-300">{formatMonthTitle(year, month)}</span>
        </div>
      </div>

      {error ? <p className="text-red-400 text-sm">{error}</p> : null}
      {loading || !data ? (
        <div className="rounded-xl border border-slate-700 bg-space-800/60 p-8 text-slate-400 text-sm">월간 계획을 불러오는 중...</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[7fr_3fr] gap-4">
          <section className="rounded-xl border border-slate-700 bg-space-800/50 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-slate-700/80 bg-space-900/30">
              {WEEKDAY_LABELS.map((w, i) => (
                <div
                  key={w}
                  className={`px-2 py-2 text-center text-[11px] font-semibold border-r border-slate-700/60 [&:nth-child(7n)]:border-r-0 ${
                    i === 0 ? "text-rose-300" : i === 6 ? "text-sky-300" : "text-slate-400"
                  }`}
                >
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {dayCells.map((dateKey, idx) => {
                const dayEntries = dateKey ? entriesByDate.get(dateKey) ?? [] : [];
                const dayLeaves = dateKey ? leavesByDate.get(dateKey) ?? [] : [];
                const total = dayEntries.reduce((s, e) => s + e.qty, 0);
                const topProducts = dayEntries.slice().sort((a, b) => b.qty - a.qty).slice(0, 3);
                const extraCount = Math.max(0, dayEntries.length - 3);
                const selected = dateKey === selectedDate;
                const weekday = idx % 7;
                const isHoliday = dateKey ? isKoreanPublicHoliday(dateKey) : false;
                const isSunday = weekday === 0 || isHoliday;
                const isSaturday = weekday === 6;
                return (
                  <button
                    key={`${dateKey ?? "empty"}-${idx}`}
                    disabled={!dateKey}
                    onClick={() => {
                      if (dateKey) setSelectedDate(dateKey);
                    }}
                    className={`min-h-[176px] border-r border-b border-slate-700/50 p-2 text-left [&:nth-child(7n)]:border-r-0 ${
                      selected
                        ? "bg-cyan-950/[0.2] ring-1 ring-inset ring-cyan-500/40"
                        : isSunday
                          ? "bg-rose-950/15 hover:bg-rose-950/25"
                          : isSaturday
                            ? "bg-sky-950/15 hover:bg-sky-950/25"
                            : "bg-space-900/10 hover:bg-slate-900/35"
                    }`}
                  >
                    {dateKey ? (
                      <>
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`text-sm font-bold ${
                              selected
                                ? "text-cyan-200"
                                : isSunday
                                  ? "text-rose-300"
                                  : isSaturday
                                    ? "text-sky-300"
                                    : "text-slate-200"
                            }`}
                          >
                            {Number(dateKey.slice(8, 10))}
                          </span>
                          {null}
                        </div>
                        <div className="space-y-1">
                          {topProducts.map((p, i) => {
                            const d = splitForDisplay(p.product_name_snapshot);
                            return (
                              <div
                                key={`${p.product_name_snapshot}-${i}`}
                                className={`rounded-md px-1.5 py-1 text-[10px] leading-snug ${getPlanEntryClass(p.product_name_snapshot)}`}
                              >
                                <p className="font-medium break-words whitespace-normal leading-tight">{d.base}</p>
                                <p className="text-[10px] opacity-90">{d.kind || "기본"}</p>
                                <p className="text-[10px] opacity-80">수량 {p.qty.toLocaleString("ko-KR")}</p>
                              </div>
                            );
                          })}
                          {extraCount > 0 ? <p className="text-[10px] text-slate-500 px-1">외 {extraCount}개</p> : null}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                          {(dateKey ? notesByDate.get(dateKey) ?? [] : []).map((note, ni) => (
                            <span key={`${dateKey}-note-${ni}`} className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-100">
                              비고: {note}
                            </span>
                          ))}
                          {dayLeaves.map((leave, li) => (
                            <span
                              key={`${dateKey}-leave-${li}-${leave.person_name}`}
                              className={`px-1.5 py-0.5 rounded ${
                                leave.leave_type === "half"
                                  ? "bg-violet-500/20 text-violet-100"
                                  : "bg-orange-500/20 text-orange-100"
                              }`}
                            >
                              {leave.leave_type === "half" ? "반:" : "휴:"} {leave.person_name}
                            </span>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="rounded-xl border border-slate-700 bg-space-800/60 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100">{selectedDate}</h2>
              {dirty ? <span className="text-[11px] text-amber-300">저장 안됨</span> : <span className="text-[11px] text-slate-500">저장됨</span>}
            </div>

            <div className="flex flex-wrap gap-1 text-xs">
              <button onClick={() => setTab("detail")} className={`px-2 py-1 rounded ${tab === "detail" ? "bg-cyan-600 text-white" : "bg-slate-700 text-slate-200"}`}>
                날짜 상세
              </button>
              <button onClick={() => setTab("materials")} className={`px-2 py-1 rounded ${tab === "materials" ? "bg-cyan-600 text-white" : "bg-slate-700 text-slate-200"}`}>
                필요 원료
              </button>
              <button onClick={() => setTab("summary")} className={`px-2 py-1 rounded ${tab === "summary" ? "bg-cyan-600 text-white" : "bg-slate-700 text-slate-200"}`}>
                월 요약
              </button>
              <button onClick={() => setTab("processed")} className={`px-2 py-1 rounded ${tab === "processed" ? "bg-cyan-600 text-white" : "bg-slate-700 text-slate-200"}`}>
                가공 데이터
              </button>
            </div>

            {tab === "detail" ? (
              <div className="space-y-3">
                <div className="flex gap-1 text-xs">
                  <button
                    onClick={() => setDetailMode("production")}
                    className={`px-2 py-1 rounded ${detailMode === "production" ? "bg-cyan-600 text-white" : "bg-slate-700 text-slate-200"}`}
                  >
                    생산계획
                  </button>
                  <button
                    onClick={() => setDetailMode("leave")}
                    className={`px-2 py-1 rounded ${detailMode === "leave" ? "bg-violet-600 text-white" : "bg-slate-700 text-slate-200"}`}
                  >
                    연월차
                  </button>
                </div>

                {detailMode === "production" ? (
                  <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400">제품별 생산계획</p>
                  {canEdit ? (
                    <button className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200" onClick={addEntryRow}>
                      <Plus className="w-3 h-3" /> 제품 추가
                    </button>
                  ) : null}
                </div>
                <div className="space-y-2 max-h-[240px] overflow-y-auto">
                  {draft.entries.map((entry, idx) => (
                    <div key={`entry-${idx}`} className="grid grid-cols-[1fr_132px_84px_20px] gap-1 items-center">
                      <select
                        value={entry.productBase}
                        onChange={(e) =>
                          setDraft((prev) => {
                            const next = prev.entries.slice();
                            const nextBase = e.target.value;
                            const nextKind = productOptionMap.get(nextBase)?.[0] ?? "";
                            next[idx] = { ...next[idx], productBase: nextBase, productKind: nextKind };
                            return { ...prev, entries: next };
                          })
                        }
                        disabled={!canEdit}
                        className="px-2 py-1.5 rounded border border-slate-600 bg-space-900 text-xs text-slate-100"
                      >
                        <option value="">제품명</option>
                        {baseProductOptions.map((base) => (
                          <option key={base} value={base}>
                            {base}
                          </option>
                        ))}
                      </select>
                      <select
                        value={entry.productKind}
                        onChange={(e) =>
                          setDraft((prev) => {
                            const next = prev.entries.slice();
                            next[idx] = { ...next[idx], productKind: e.target.value };
                            return { ...prev, entries: next };
                          })
                        }
                        disabled={!canEdit}
                        className="px-2 py-1.5 rounded border border-slate-600 bg-space-900 text-xs text-slate-100"
                      >
                        <option value="">조건</option>
                        {(productOptionMap.get(entry.productBase) ?? []).map((kind) => (
                          <option key={`${entry.productBase}-${kind}`} value={kind}>
                            {kind}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={entry.qtyText}
                        onFocus={(e) => {
                          if (e.currentTarget.value === "0") {
                            setDraft((prev) => {
                              const next = prev.entries.slice();
                              next[idx] = { ...next[idx], qtyText: "" };
                              return { ...prev, entries: next };
                            });
                          }
                          e.currentTarget.select();
                        }}
                        onChange={(e) =>
                          setDraft((prev) => {
                            const next = prev.entries.slice();
                            const raw = e.target.value.replace(/[^0-9.]/g, "");
                            next[idx] = { ...next[idx], qtyText: raw };
                            return { ...prev, entries: next };
                          })
                        }
                        onBlur={() =>
                          setDraft((prev) => {
                            const next = prev.entries.slice();
                            const n = toNumber(next[idx].qtyText);
                            next[idx] = { ...next[idx], qtyText: n > 0 ? n.toLocaleString("ko-KR") : "0" };
                            return { ...prev, entries: next };
                          })
                        }
                        disabled={!canEdit}
                        className="px-2 py-1.5 rounded border border-slate-600 bg-space-900 text-xs text-slate-100 text-right"
                        placeholder="수량"
                      />
                      {canEdit ? (
                        <button
                          onClick={() =>
                            setDraft((prev) => ({ ...prev, entries: prev.entries.filter((_, i) => i !== idx).map((x, i) => ({ ...x, sort_order: i })) }))
                          }
                          className="text-rose-400 hover:text-rose-300"
                          title="행 삭제"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-400">연차/반차 인원</p>
                      {canEdit ? (
                        <div className="flex gap-1">
                          <button
                            className="inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                leaves: [...prev.leaves, { leave_type: "annual", person_name: "" }],
                              }))
                            }
                          >
                            <Plus className="w-3 h-3" /> 연차인원추가
                          </button>
                          <button
                            className="inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                leaves: [...prev.leaves, { leave_type: "half", person_name: "" }],
                              }))
                            }
                          >
                            <Plus className="w-3 h-3" /> 반차인원추가
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                      {draft.leaves.map((leave, idx) => (
                        <div key={`leave-${idx}`} className="grid grid-cols-[72px_1fr_20px] gap-1 items-center">
                          <select
                            value={leave.leave_type}
                            disabled={!canEdit}
                            onChange={(e) =>
                              setDraft((prev) => {
                                const next = prev.leaves.slice();
                                next[idx] = { ...next[idx], leave_type: e.target.value === "half" ? "half" : "annual" };
                                return { ...prev, leaves: next };
                              })
                            }
                            className="px-1 py-1 rounded border border-slate-600 bg-space-900 text-xs text-slate-100"
                          >
                            <option value="annual">연차</option>
                            <option value="half">반차</option>
                          </select>
                          <input
                            list="planning-people"
                            value={leave.person_name}
                            disabled={!canEdit}
                            onChange={(e) =>
                              setDraft((prev) => {
                                const next = prev.leaves.slice();
                                next[idx] = { ...next[idx], person_name: e.target.value };
                                return { ...prev, leaves: next };
                              })
                            }
                            className="px-2 py-1 rounded border border-slate-600 bg-space-900 text-xs text-slate-100"
                            placeholder="이름 선택/입력"
                          />
                          {canEdit ? (
                            <button
                              className="text-rose-400 hover:text-rose-300"
                              onClick={() => setDraft((prev) => ({ ...prev, leaves: prev.leaves.filter((_, i) => i !== idx) }))}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <datalist id="planning-people">
                      {data.people.map((p) => (
                        <option key={p.id} value={p.name} />
                      ))}
                    </datalist>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-400">비고</label>
                    {canEdit ? (
                      <button
                        className="inline-flex items-center gap-1 text-xs text-yellow-300 hover:text-yellow-200"
                        onClick={() =>
                          setDraft((prev) => {
                            const text = prev.noteInput.trim();
                            if (!text) return prev;
                            return { ...prev, notes: [...prev.notes, text], noteInput: "" };
                          })
                        }
                      >
                        <Plus className="w-3 h-3" /> 비고추가
                      </button>
                    ) : null}
                  </div>
                  <div className="space-y-1 max-h-[120px] overflow-y-auto">
                    {draft.notes.map((note, idx) => (
                      <div key={`note-${idx}`} className="grid grid-cols-[1fr_20px] gap-1 items-center">
                        <div className="px-2 py-1 rounded border border-slate-700 bg-space-900/50 text-xs text-yellow-100">{note}</div>
                        {canEdit ? (
                          <button
                            className="text-rose-400 hover:text-rose-300"
                            onClick={() => setDraft((prev) => ({ ...prev, notes: prev.notes.filter((_, i) => i !== idx) }))}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <input
                    value={draft.noteInput}
                    onChange={(e) => setDraft((prev) => ({ ...prev, noteInput: e.target.value }))}
                    disabled={!canEdit}
                    placeholder="비고 입력 후 비고추가"
                    className="w-full px-2 py-1.5 rounded border border-slate-600 bg-space-900 text-xs text-slate-100"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500">기타</label>
                    <input
                      type="number"
                      value={draft.otherCount}
                      onChange={(e) => setDraft((prev) => ({ ...prev, otherCount: toNumber(e.target.value) }))}
                      disabled={!canEdit}
                      className="mt-0.5 w-full px-2 py-1 rounded border border-slate-600 bg-space-900 text-xs text-slate-100"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-slate-700 bg-space-900/40 p-2 text-xs space-y-1">
                  <p className="text-slate-400">
                    총 생산량 <span className="text-slate-200 tabular-nums">{selectedDayTotal.toLocaleString("ko-KR")}</span>
                  </p>
                  <p className="text-slate-400">
                    실투입인원(자동){" "}
                    <span className="text-cyan-200 tabular-nums">
                      {selectedActualManpower.toLocaleString("ko-KR")}
                    </span>
                    <span className="text-slate-500"> (기준 인원 {baselineHeadcount})</span>
                  </p>
                  <p className="text-slate-500">연차 {annualCount}명 · 반차 {halfCount}명</p>
                </div>
                <div className="rounded-lg border border-slate-700 bg-space-900/40 p-2 text-xs">
                  <p className="text-slate-400 mb-1">당일 표시 미리보기</p>
                  <div className="space-y-1">
                    {draft.entries
                      .filter((e) => e.productBase.trim() && toNumber(e.qtyText) > 0)
                      .slice(0, 3)
                      .map((e, i) => (
                        <p key={`preview-entry-${i}`} className="text-slate-200 truncate">
                          {composeProductName(e.productBase, e.productKind)} · {toNumber(e.qtyText).toLocaleString("ko-KR")}
                        </p>
                      ))}
                    {draft.leaves.filter((l) => l.person_name.trim()).length > 0 ? (
                      <p className="text-violet-200">
                        휴무{" "}
                        {draft.leaves
                          .filter((l) => l.person_name.trim())
                          .map((l) => `${l.person_name}(${l.leave_type === "half" ? "반" : "연"})`)
                          .join(", ")}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={saveDay}
                    disabled={!canEdit || saving}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs"
                  >
                    <Save className="w-3 h-3" /> {saving ? "저장 중..." : "저장"}
                  </button>
                  <button
                    onClick={duplicateToAnotherDate}
                    disabled={!canEdit}
                    className="px-3 py-2 rounded border border-slate-600 text-slate-200 hover:bg-slate-700/50 text-xs inline-flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> 날짜복제
                  </button>
                </div>
              </div>
            ) : null}

            {tab === "materials" ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={rangeMode}
                    onChange={(e) => setRangeMode((e.target.value as PlanningRangeMode) ?? "from_selected")}
                    className="px-2 py-1.5 rounded border border-slate-600 bg-space-900 text-xs text-slate-100"
                  >
                    <option value="day">당일만</option>
                    <option value="from_selected">선택일 이후 월말</option>
                    <option value="from_today">오늘 이후 월말</option>
                    <option value="custom">사용자 지정</option>
                  </select>
                  <label className="flex items-center gap-1 text-xs text-slate-300">
                    <input type="checkbox" checked={showOnlyShortage} onChange={(e) => setShowOnlyShortage(e.target.checked)} />
                    부족만 보기
                  </label>
                </div>
                {rangeMode === "custom" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="px-2 py-1 rounded border border-slate-600 bg-space-900 text-xs text-slate-100" />
                    <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="px-2 py-1 rounded border border-slate-600 bg-space-900 text-xs text-slate-100" />
                  </div>
                ) : null}
                <div className="max-h-[410px] overflow-y-auto rounded border border-slate-700">
                  <table className="w-full text-[11px]">
                    <thead className="bg-space-900/70 text-slate-400 sticky top-0">
                      <tr>
                        <th className="p-1 text-left">원료</th>
                        <th className="p-1 text-right">필요(g)</th>
                        <th className="p-1 text-right">재고(g)</th>
                        <th className="p-1 text-right">부족(g)</th>
                        <th className="p-1 text-right">발주(g)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {materialRows.map((r) => (
                        <tr key={r.material_name} className="border-t border-slate-800 text-slate-300">
                          <td className="p-1">{r.material_name}</td>
                          <td className="p-1 text-right tabular-nums">{r.required_g.toLocaleString("ko-KR")}</td>
                          <td className="p-1 text-right tabular-nums">{r.stock_g.toLocaleString("ko-KR")}</td>
                          <td className={`p-1 text-right tabular-nums ${r.shortage_g > 0 ? "text-amber-300" : "text-slate-500"}`}>
                            {r.shortage_g.toLocaleString("ko-KR")}
                          </td>
                          <td className="p-1 text-right tabular-nums">{r.order_required_g.toLocaleString("ko-KR")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {tab === "summary" && monthSummary ? (
              <div className="space-y-2 text-xs">
                <div className="rounded border border-slate-700 p-2 space-y-1 text-slate-300">
                  <p>월 총 생산량: <span className="text-cyan-200 tabular-nums">{monthSummary.totalQty.toLocaleString("ko-KR")}</span></p>
                  <p>총 계획 일수: <span className="tabular-nums">{monthSummary.plannedDays}</span>일</p>
                  <p>메모 있는 일수: <span className="tabular-nums">{monthSummary.noteDays}</span>일</p>
                  <p>부족 예상 원료 수: <span className="tabular-nums text-amber-300">{monthSummary.shortageMaterialsCount}</span></p>
                </div>
                <div className="rounded border border-slate-700 p-2">
                  <p className="text-slate-400 mb-1">제품별 TOP 5</p>
                  <ul className="space-y-1 text-slate-200">
                    {monthSummary.topProducts.map((p) => (
                      <li key={p.productName} className="flex justify-between">
                        <span>{p.productName}</span>
                        <span className="tabular-nums">{p.qty.toLocaleString("ko-KR")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded border border-slate-700 p-2">
                  <p className="text-slate-400 mb-1">필요 원료 TOP 5</p>
                  <ul className="space-y-1 text-slate-200">
                    {monthSummary.topMaterials.map((m) => (
                      <li key={m.materialName} className="flex justify-between">
                        <span>{m.materialName}</span>
                        <span className="tabular-nums">{m.requiredG.toLocaleString("ko-KR")}g</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            {tab === "processed" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400">날짜 / 제품명 / 수량 / 투입인원 / 비고</p>
                  <button onClick={downloadProcessedCsv} className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200">
                    <Download className="w-3 h-3" /> CSV
                  </button>
                </div>
                <div className="max-h-[400px] overflow-y-auto rounded border border-slate-700">
                  <table className="w-full text-[11px]">
                    <thead className="bg-space-900/70 text-slate-400 sticky top-0">
                      <tr>
                        <th className="p-1 text-left">날짜</th>
                        <th className="p-1 text-left">제품명</th>
                        <th className="p-1 text-right">수량</th>
                        <th className="p-1 text-right">투입</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processedRows.map((r, idx) => (
                        <tr key={`${r.plan_date}-${r.product_name}-${idx}`} className="border-t border-slate-800 text-slate-300">
                          <td className="p-1">{r.plan_date}</td>
                          <td className="p-1">{r.product_name}</td>
                          <td className="p-1 text-right tabular-nums">{r.qty.toLocaleString("ko-KR")}</td>
                          <td className="p-1 text-right tabular-nums">{r.manpower.toLocaleString("ko-KR")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}
