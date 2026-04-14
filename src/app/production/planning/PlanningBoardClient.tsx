"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Save, Copy, Plus, Trash2, Download, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  computeActualManpower,
  computeMaterialRequirements,
  computeMonthlySummary,
  computeProcessedRows,
  isKoreanPublicHoliday,
  monthDays,
  weekdayOfFirstDay,
  ymd,
} from "@/features/production/planning/calculations";
import { computeMonthlyCategoryTotals } from "@/features/production/planning/computeMonthlyCategoryTotals";
import { computeMonthlyOperationalMetrics } from "@/features/production/planning/computeMonthlyOperationalMetrics";
import { computeMonthlyProductTotals } from "@/features/production/planning/computeMonthlyProductTotals";
import { categoryBadgeClassName, getPlanningEntryToneClass } from "@/features/production/planning/productClassification";
import { listUnclassifiedProductBases } from "@/features/production/planning/listUnclassifiedProductBases";
import type { MaterialRequirementRow, PlanningDayEntryInput, PlanningMonthData } from "@/features/production/planning/types";
import { supabase } from "@/lib/supabase";

type DayDraft = {
  entries: Array<{
    productBase: string;
    productKind: string;
    qtyText: string;
    sort_order: number;
  }>;
  leaves: { leave_type: "annual" | "half"; person_name: string }[];
  otherItems: { person_name: string; detail: string }[];
  notes: string[];
  noteInput: string;
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

const OTHER_NOTE_PREFIX = "[기타]";

function encodeOtherAsNote(detail: string, personName: string): string {
  return `${OTHER_NOTE_PREFIX}${detail.trim()} : ${personName.trim()}`;
}

function parseOtherNoteText(noteText: string): { detail: string; person_name: string } | null {
  const t = noteText.trim();
  if (!t.startsWith(OTHER_NOTE_PREFIX)) return null;
  const body = t.slice(OTHER_NOTE_PREFIX.length).trim();
  const idx = body.lastIndexOf(" : ");
  if (idx <= 0) return null;
  const detail = body.slice(0, idx).trim();
  const person_name = body.slice(idx + 3).trim();
  if (!detail || !person_name) return null;
  return { detail, person_name };
}

export default function PlanningBoardClient() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<PlanningMonthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string>(() => ymd(now.getFullYear(), now.getMonth() + 1, now.getDate()));
  const [draft, setDraft] = useState<DayDraft>({
    entries: [],
    leaves: [],
    otherItems: [],
    notes: [],
    noteInput: "",
  });
  const [detailMode, setDetailMode] = useState<"production" | "leave">("production");
  const [originalSerialized, setOriginalSerialized] = useState("");
  /** 날짜 상세 입력은 Drawer에서만 */
  const [dayDrawerOpen, setDayDrawerOpen] = useState(false);
  /** 원료 탭: shortage = 발주 필요 > 0 만, all = 필요량 > 0 전체(계산 결과 전체) */
  const [materialViewMode, setMaterialViewMode] = useState<"shortage" | "all">("shortage");
  const [rightPanelTab, setRightPanelTab] = useState<"summary" | "products" | "materials" | "processed">("summary");
  const [productPlanExpanded, setProductPlanExpanded] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);

  const { profile, loading: authLoading } = useAuth();
  const canView = profile?.role === "admin" || profile?.role === "manager";
  const canEdit = canView;
  const yearOptions = useMemo(() => {
    const start = 2026;
    const end = Math.max(2032, now.getFullYear() + 5);
    const arr: number[] = [];
    for (let y = start; y <= end; y += 1) arr.push(y);
    return arr;
  }, [now]);
  const monthOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);

  const loadMonth = useCallback(async () => {
    if (authLoading) return;
    if (!canView) {
      setData(null);
      setLoading(false);
      setError("월간 생산계획 보드는 관리자/매니저만 조회할 수 있습니다.");
      return;
    }
    setLoading(true);
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token || !session?.refresh_token) {
      setLoading(false);
      setError("로그인 세션이 없습니다.");
      return;
    }
    const qs = new URLSearchParams({
      year: String(year),
      month: String(month),
    });
    const res = await fetch(`/api/production/planning/month?${qs.toString()}`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token,
      },
    });
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
  }, [authLoading, canView, month, year]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  useEffect(() => {
    setDayDrawerOpen(false);
  }, [year, month]);

  useEffect(() => {
    setRightPanelTab("summary");
    setProductPlanExpanded(false);
    setMaterialViewMode("shortage");
  }, [year, month]);

  useEffect(() => {
    if (!dayDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDayDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dayDrawerOpen]);

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
    const rawNotes = notesByDate.get(selectedDate) ?? [];
    const notes: string[] = [];
    const otherItems: { person_name: string; detail: string }[] = [];
    for (const note of rawNotes) {
      const parsed = parseOtherNoteText(note);
      if (parsed) otherItems.push(parsed);
      else notes.push(note);
    }
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
      otherItems,
      notes: notes.map((n) => String(n)),
      noteInput: "",
    };
    const serialized = JSON.stringify(next);
    setDraft(next);
    setOriginalSerialized(serialized);
    setShowNoteInput(notes.length > 0);
  }, [data, entriesByDate, leavesByDate, notesByDate, selectedDate]);

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

  /** 월간 보드: 해당 월 전체 기간 필요원료 (기존 computeMaterialRequirements 재사용) */
  const monthlyMaterialRequirements = useMemo(() => {
    if (!data) return [] as MaterialRequirementRow[];
    const startOfMonth = ymd(year, month, 1);
    const end = ymd(year, month, monthDays(year, month));
    const today = new Date();
    const todayIso = ymd(today.getFullYear(), today.getMonth() + 1, today.getDate());
    // 현재 월은 오늘 이후 생산분 기준으로만 필요원료를 본다.
    const start = todayIso > startOfMonth && todayIso <= end ? todayIso : startOfMonth;
    return computeMaterialRequirements({
      entries: data.entries,
      bomRows: data.bomRows,
      materialRows: data.materialRows,
      inventoryRows: data.inventoryRows,
      startDate: start,
      endDate: end,
    });
  }, [data, month, year]);

  const shortageMaterialRows = useMemo(
    () => monthlyMaterialRequirements.filter((r) => r.order_required_g > 0),
    [monthlyMaterialRequirements]
  );

  const displayedMaterialRequirements = useMemo(
    () => (materialViewMode === "shortage" ? shortageMaterialRows : monthlyMaterialRequirements),
    [materialViewMode, monthlyMaterialRequirements, shortageMaterialRows]
  );

  const unclassifiedBases = useMemo(
    () => (data?.entries ? listUnclassifiedProductBases(data.entries) : []),
    [data?.entries]
  );

  const categoryRollup = useMemo(() => (data ? computeMonthlyCategoryTotals(data.entries) : null), [data]);

  const productTotals = useMemo(() => (data ? computeMonthlyProductTotals(data.entries) : []), [data]);

  const productRowsForPanel = useMemo(
    () => (productPlanExpanded ? productTotals : productTotals.slice(0, 5)),
    [productPlanExpanded, productTotals]
  );

  const operationalMetrics = useMemo(() => {
    if (!data) return null;
    return computeMonthlyOperationalMetrics({
      year,
      month,
      entries: data.entries,
      baselineHeadcount: Number(data.month.baseline_headcount) || 25,
      totalMembers: data.totalMembers ?? 0,
    });
  }, [data, month, year]);

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
    draft.otherItems.filter((x) => x.person_name.trim() && x.detail.trim()).length
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
      notes: [
        ...draft.notes.map((n) => n.trim()).filter(Boolean),
        ...draft.otherItems
          .filter((x) => x.person_name.trim() && x.detail.trim())
          .map((x) => encodeOtherAsNote(x.detail, x.person_name)),
      ],
      annual_leave_count: annualCount,
      half_day_count: halfCount,
      other_count: draft.otherItems.filter((x) => x.person_name.trim() && x.detail.trim()).length,
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
      notes: [
        ...draft.notes.map((n) => n.trim()).filter(Boolean),
        ...draft.otherItems
          .filter((x) => x.person_name.trim() && x.detail.trim())
          .map((x) => encodeOtherAsNote(x.detail, x.person_name)),
      ],
      annual_leave_count: annualCount,
      half_day_count: halfCount,
      other_count: draft.otherItems.filter((x) => x.person_name.trim() && x.detail.trim()).length,
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
        <div className="space-y-4">
          {categoryRollup ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-500/40 bg-gradient-to-br from-slate-800/90 to-space-900/80 px-4 py-4 shadow-lg shadow-black/20">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">총 수량</p>
                <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-white sm:text-3xl">
                  {categoryRollup.totalQty.toLocaleString("ko-KR")}
                </p>
              </div>
              <div className="rounded-xl border border-cyan-500/35 bg-gradient-to-br from-cyan-950/50 to-space-900/80 px-4 py-4 shadow-lg shadow-black/20">
                <p className="text-[11px] font-medium uppercase tracking-wide text-cyan-200/80">피자</p>
                <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-cyan-100 sm:text-3xl">
                  {categoryRollup.pizzaQty.toLocaleString("ko-KR")}
                </p>
              </div>
              <div className="rounded-xl border border-amber-500/35 bg-gradient-to-br from-amber-950/45 to-space-900/80 px-4 py-4 shadow-lg shadow-black/20">
                <p className="text-[11px] font-medium uppercase tracking-wide text-amber-200/80">브레드</p>
                <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-amber-100 sm:text-3xl">
                  {categoryRollup.breadQty.toLocaleString("ko-KR")}
                </p>
              </div>
              <div className="rounded-xl border border-violet-500/35 bg-gradient-to-br from-violet-950/45 to-space-900/80 px-4 py-4 shadow-lg shadow-black/20">
                <p className="text-[11px] font-medium uppercase tracking-wide text-violet-200/80">파베이크</p>
                <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-violet-100 sm:text-3xl">
                  {categoryRollup.parbakeTotal.toLocaleString("ko-KR")}
                </p>
              </div>
            </div>
          ) : null}

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
                const topProducts = dayEntries.slice().sort((a, b) => b.qty - a.qty).slice(0, 2);
                const extraCount = Math.max(0, dayEntries.length - 2);
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
                      if (!dateKey) return;
                      setSelectedDate(dateKey);
                      setDayDrawerOpen(true);
                    }}
                    className={`min-h-[150px] border-r border-b border-slate-700/50 p-2 text-left [&:nth-child(7n)]:border-r-0 ${
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
                                className={`rounded-md px-1.5 py-1 text-[10px] leading-snug ${getPlanningEntryToneClass(p.product_name_snapshot)}`}
                              >
                                <p className="font-medium break-words whitespace-normal leading-tight">{d.base}</p>
                                <p className="text-[10px] opacity-90">{d.kind || "기본"}</p>
                                <p className="text-[10px] opacity-80">수량 {p.qty.toLocaleString("ko-KR")}</p>
                              </div>
                            );
                          })}
                          {extraCount > 0 ? (
                            <p className="text-[10px] text-cyan-300/90 px-1 font-medium">+{extraCount}개 더보기</p>
                          ) : null}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                          {(dateKey ? notesByDate.get(dateKey) ?? [] : []).map((note, ni) => {
                            const otherParsed = parseOtherNoteText(note);
                            if (otherParsed) {
                              return (
                                <span key={`${dateKey}-other-${ni}`} className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-100">
                                  {otherParsed.detail} : {otherParsed.person_name}
                                </span>
                              );
                            }
                            return (
                              <span key={`${dateKey}-note-${ni}`} className="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-100">
                                비고: {note}
                              </span>
                            );
                          })}
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

          <aside className="flex min-h-[min(70vh,52rem)] min-h-0 flex-col rounded-xl border border-slate-700 bg-space-800/60 overflow-hidden xl:max-h-[calc(100vh-12rem)]">
            <div className="shrink-0 border-b border-slate-700/80 bg-space-900/50 px-4 py-3">
              <h2 className="text-sm font-semibold text-cyan-200/90">월간 운영 패널</h2>
              <p className="text-[11px] text-slate-500 mt-0.5">{formatMonthTitle(year, month)} · 달력에서 날짜를 누르면 상세 입력</p>
            </div>

            <div className="sticky top-0 z-[2] shrink-0 border-b border-slate-700/80 bg-space-900/95 px-2 py-2 backdrop-blur-sm">
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {(
                  [
                    { id: "summary" as const, label: "월 요약" },
                    { id: "products" as const, label: "제품 계획" },
                    { id: "materials" as const, label: "원료 / 발주" },
                    { id: "processed" as const, label: "가공 데이터" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setRightPanelTab(t.id)}
                    className={`rounded-lg px-2 py-2.5 text-center text-[11px] font-semibold leading-tight transition ${
                      rightPanelTab === t.id
                        ? "bg-cyan-600 text-white shadow-md shadow-cyan-900/40"
                        : "border border-slate-700/90 bg-space-900/70 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {operationalMetrics && categoryRollup && monthSummary ? (
                <>
                  {rightPanelTab === "summary" ? (
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-100">운영 지표</h3>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div className="rounded-xl border border-slate-600/70 bg-space-900/55 p-3">
                            <p className="text-[10px] font-medium text-slate-500">기준 인원</p>
                            <p className="mt-1 text-xl font-semibold tabular-nums text-slate-100">
                              {operationalMetrics.baselineHeadcount.toLocaleString("ko-KR")}
                            </p>
                            <p className="text-[10px] text-slate-500 mt-1">활성 프로필 {operationalMetrics.totalMembers}명 (참고)</p>
                          </div>
                          <div className="rounded-xl border border-slate-600/70 bg-space-900/55 p-3">
                            <p className="text-[10px] font-medium text-slate-500">총 가동일</p>
                            <p className="mt-1 text-xl font-semibold tabular-nums text-slate-100">{operationalMetrics.plannedOperationDayCount}</p>
                            <p className="text-[10px] text-slate-500 mt-1">생산 1건 이상인 날</p>
                          </div>
                          <div className="rounded-xl border border-slate-600/70 bg-space-900/55 p-3 col-span-2">
                            <p className="text-[10px] font-medium text-slate-500">주말 근무 (토·일)</p>
                            <p className="mt-1 text-xl font-semibold tabular-nums text-sky-200/90">{operationalMetrics.weekendPlannedDayCount}회</p>
                            <p className="text-[10px] text-slate-500 mt-1">토·일 중 생산 계획이 있는 날만 집계 (연차만인 날은 미제외)</p>
                          </div>
                        </div>
                        <p className="mt-3 text-[11px] text-slate-500">
                          부족 원료 종류: <span className="text-amber-300/90 tabular-nums">{monthSummary.shortageMaterialsCount}</span>
                        </p>
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold text-slate-100">대분류 생산 합계</h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">상단 KPI와 동일 수치</p>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/25 p-3">
                            <p className="text-[10px] text-cyan-200/80">피자</p>
                            <p className="text-lg font-semibold tabular-nums text-cyan-100">{categoryRollup.pizzaQty.toLocaleString("ko-KR")}</p>
                          </div>
                          <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3">
                            <p className="text-[10px] text-amber-200/80">브레드</p>
                            <p className="text-lg font-semibold tabular-nums text-amber-100">{categoryRollup.breadQty.toLocaleString("ko-KR")}</p>
                          </div>
                          <div className="rounded-xl border border-violet-500/30 bg-violet-950/25 p-3">
                            <p className="text-[10px] text-violet-200/80">파베이크</p>
                            <p className="text-lg font-semibold tabular-nums text-violet-100">{categoryRollup.parbakeTotal.toLocaleString("ko-KR")}</p>
                          </div>
                          <div className="rounded-xl border border-slate-500/40 bg-space-900/80 p-3">
                            <p className="text-[10px] text-slate-500">총 수량</p>
                            <p className="text-lg font-semibold tabular-nums text-white">{categoryRollup.totalQty.toLocaleString("ko-KR")}</p>
                          </div>
                        </div>
                        {categoryRollup.unclassifiedQty > 0 ? (
                          <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 py-2 space-y-1.5">
                            <p className="text-[11px] text-rose-100/90">
                              미분류 합계{" "}
                              <span className="tabular-nums font-medium">{categoryRollup.unclassifiedQty.toLocaleString("ko-KR")}</span>
                              <span className="text-rose-200/70">
                                {" "}
                                · <code className="text-rose-100/90">productClassification.ts</code>에 베이스명 추가 시 반영
                              </span>
                            </p>
                            {unclassifiedBases.length > 0 ? (
                              <ul className="text-[10px] text-rose-100/80 space-y-0.5 max-h-[120px] overflow-y-auto">
                                {unclassifiedBases.map((u) => (
                                  <li key={u.base} className="flex justify-between gap-2 border-b border-rose-500/10 pb-0.5 last:border-0">
                                    <span className="break-words min-w-0">{u.base}</span>
                                    <span className="tabular-nums shrink-0 text-rose-200">{u.monthQty.toLocaleString("ko-KR")}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold text-slate-100">피자 세부</h3>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="rounded-lg border border-slate-600/80 bg-space-900/50 p-2.5">
                            <p className="text-[10px] text-slate-500">라이트</p>
                            <p className="text-base font-semibold tabular-nums text-slate-100">{categoryRollup.pizzaLight.toLocaleString("ko-KR")}</p>
                          </div>
                          <div className="rounded-lg border border-slate-600/80 bg-space-900/50 p-2.5">
                            <p className="text-[10px] text-slate-500">헤비</p>
                            <p className="text-base font-semibold tabular-nums text-slate-100">{categoryRollup.pizzaHeavy.toLocaleString("ko-KR")}</p>
                          </div>
                          <div className="rounded-lg border border-slate-600/80 bg-space-900/50 p-2.5">
                            <p className="text-[10px] text-slate-500">미니</p>
                            <p className="text-base font-semibold tabular-nums text-slate-100">{categoryRollup.pizzaMini.toLocaleString("ko-KR")}</p>
                          </div>
                          <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/25 p-2.5">
                            <p className="text-[10px] text-slate-500">피자 계</p>
                            <p className="text-base font-semibold tabular-nums text-cyan-100">{categoryRollup.pizzaSum.toLocaleString("ko-KR")}</p>
                          </div>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold text-slate-100">브레드</h3>
                        <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-950/15 px-4 py-4">
                          <p className="text-2xl font-semibold tabular-nums text-amber-100">{categoryRollup.breadQty.toLocaleString("ko-KR")}</p>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold text-slate-100">파베이크</h3>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div className="rounded-lg border border-sky-500/25 bg-sky-950/20 p-3">
                            <p className="text-[10px] text-slate-500">보관용(우주인)</p>
                            <p className="text-lg font-semibold tabular-nums text-sky-100">{categoryRollup.parbakeStorageQty.toLocaleString("ko-KR")}</p>
                          </div>
                          <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/15 p-3">
                            <p className="text-[10px] text-slate-500">판매용(선인)</p>
                            <p className="text-lg font-semibold tabular-nums text-emerald-100">{categoryRollup.parbakeSaleQty.toLocaleString("ko-KR")}</p>
                          </div>
                          <div className="rounded-lg border border-violet-500/30 bg-violet-950/20 p-3 sm:col-span-1">
                            <p className="text-[10px] text-slate-500">파베이크 계</p>
                            <p className="text-lg font-semibold tabular-nums text-violet-100">{categoryRollup.parbakeTotal.toLocaleString("ko-KR")}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {rightPanelTab === "products" ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">제품별 월 생산 예정</h3>
                          <p className="text-[10px] text-slate-500 mt-0.5">수량 상위 기준 · 기본 5개만 표시</p>
                        </div>
                        {productTotals.length > 5 ? (
                          <button
                            type="button"
                            onClick={() => setProductPlanExpanded((v) => !v)}
                            className="shrink-0 rounded-lg border border-slate-600 px-2.5 py-1.5 text-[11px] font-medium text-cyan-200 hover:bg-slate-800"
                          >
                            {productPlanExpanded ? "접기" : "전체 보기"}
                          </button>
                        ) : null}
                      </div>
                      <div className="max-h-[min(52vh,28rem)] overflow-y-auto rounded-xl border border-slate-700">
                        <table className="w-full text-[11px]">
                          <thead className="sticky top-0 z-[1] bg-space-900/98 text-slate-400 border-b border-slate-700">
                            <tr>
                              <th className="p-2.5 text-left font-medium">제품명</th>
                              <th className="p-2.5 text-left font-medium">구분</th>
                              <th className="p-2.5 text-right font-medium">월 합계</th>
                            </tr>
                          </thead>
                          <tbody>
                            {productRowsForPanel.map((row) => (
                              <tr key={row.productBase} className="border-t border-slate-800/90 text-slate-300">
                                <td className="p-2.5 align-top font-medium text-slate-200">{row.displayName}</td>
                                <td className="p-2.5 align-top">
                                  <span
                                    className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold ${categoryBadgeClassName(row.classification)}`}
                                  >
                                    {row.badgeLabel}
                                  </span>
                                </td>
                                <td className="p-2.5 text-right tabular-nums font-semibold text-slate-100">{row.monthQty.toLocaleString("ko-KR")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  {rightPanelTab === "materials" ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">원료 / 재고 / 발주</h3>
                          <p className="text-[10px] text-slate-500 mt-0.5">현재 월은 오늘 이후 구간 · 단위 g · 재고는 재고현황 qty</p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => setMaterialViewMode("shortage")}
                            className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
                              materialViewMode === "shortage"
                                ? "bg-amber-600/90 text-white"
                                : "border border-slate-600 text-slate-400 hover:bg-slate-800"
                            }`}
                          >
                            부족 원료
                          </button>
                          <button
                            type="button"
                            onClick={() => setMaterialViewMode("all")}
                            className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
                              materialViewMode === "all"
                                ? "bg-slate-600 text-white"
                                : "border border-slate-600 text-slate-400 hover:bg-slate-800"
                            }`}
                          >
                            전체 필요 원료
                          </button>
                        </div>
                      </div>
                      <div className="max-h-[min(52vh,28rem)] overflow-y-auto rounded-xl border border-slate-700">
                        <table className="w-full text-[11px]">
                          <thead className="sticky top-0 z-[1] bg-space-900/98 text-slate-400 border-b border-slate-700">
                            <tr>
                              <th className="p-2.5 text-left font-medium">필요원료명</th>
                              <th className="p-2.5 text-right font-medium">총 필요량</th>
                              <th className="p-2.5 text-right font-medium">이카운트 재고</th>
                              <th className="p-2.5 text-right font-medium">발주 필요</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayedMaterialRequirements.map((r) => (
                              <tr key={r.material_name} className="border-t border-slate-800 text-slate-300">
                                <td className="p-2.5 text-left">{r.material_name}</td>
                                <td className="p-2.5 text-right tabular-nums text-slate-200">{r.required_g.toLocaleString("ko-KR")}</td>
                                <td className="p-2.5 text-right tabular-nums text-slate-400">{r.stock_g.toLocaleString("ko-KR")}</td>
                                <td
                                  className={`p-2.5 text-right tabular-nums font-semibold ${
                                    r.order_required_g > 0 ? "text-amber-200 bg-amber-500/15" : "text-slate-500"
                                  }`}
                                >
                                  {r.order_required_g.toLocaleString("ko-KR")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {materialViewMode === "shortage" && shortageMaterialRows.length === 0 ? (
                          <p className="p-6 text-center text-sm text-emerald-200/90">이번 달 부족 원료 없음</p>
                        ) : null}
                        {materialViewMode === "all" && displayedMaterialRequirements.length === 0 ? (
                          <p className="p-6 text-center text-[11px] text-slate-500">표시할 필요 원료가 없습니다.</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {rightPanelTab === "processed" ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-100">가공 데이터</h3>
                          <p className="text-[10px] text-slate-500 mt-0.5">가공 시트 연동 행 · 스크롤 또는 CSV</p>
                        </div>
                        <button
                          type="button"
                          onClick={downloadProcessedCsv}
                          className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-2.5 py-1.5 text-[11px] font-medium text-cyan-200 hover:bg-cyan-950/50"
                        >
                          <Download className="w-3 h-3" /> CSV 내려받기
                        </button>
                      </div>
                      <div className="max-h-[min(52vh,28rem)] overflow-y-auto rounded-xl border border-slate-700/80">
                        <table className="w-full text-[11px]">
                          <thead className="sticky top-0 z-[1] bg-space-900/98 text-slate-500 border-b border-slate-700/80">
                            <tr>
                              <th className="p-2 text-left">날짜</th>
                              <th className="p-2 text-left">제품명</th>
                              <th className="p-2 text-right">수량</th>
                              <th className="p-2 text-right">투입 인원</th>
                            </tr>
                          </thead>
                          <tbody>
                            {processedRows.map((r, idx) => (
                              <tr key={`${r.plan_date}-${r.product_name}-${idx}`} className="border-t border-slate-800/80 text-slate-400">
                                <td className="p-2 whitespace-nowrap">{r.plan_date}</td>
                                <td className="p-2">{r.product_name}</td>
                                <td className="p-2 text-right tabular-nums">{r.qty.toLocaleString("ko-KR")}</td>
                                <td className="p-2 text-right tabular-nums">{r.manpower.toLocaleString("ko-KR")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {processedRows.length === 0 ? (
                          <p className="p-6 text-center text-[11px] text-slate-500">가공 데이터 행이 없습니다.</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </aside>
        </div>

          {dayDrawerOpen && data ? (
            <>
              <button
                type="button"
                aria-label="닫기"
                className="fixed inset-0 z-[300] bg-black/55"
                onClick={() => setDayDrawerOpen(false)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="planning-day-drawer-title"
                className="fixed inset-y-0 right-0 z-[310] flex h-[100dvh] max-h-[100dvh] w-full min-w-0 max-w-[min(100vw,28rem)] flex-col border-l border-slate-600 bg-space-900 shadow-2xl shadow-black/50"
              >
                <div className="sticky top-0 z-[1] flex shrink-0 items-center justify-between gap-2 border-b border-slate-700 bg-space-900/95 px-4 py-3 backdrop-blur-sm">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">날짜 상세</p>
                    <p id="planning-day-drawer-title" className="text-lg font-semibold text-cyan-100">
                      {selectedDate}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {dirty ? <span className="text-[11px] text-amber-300">저장 안됨</span> : <span className="text-[11px] text-slate-500">저장됨</span>}
                    <button
                      type="button"
                      onClick={() => setDayDrawerOpen(false)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-4 pb-2">
                  <div className="flex gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setDetailMode("production")}
                      className={`flex-1 rounded px-2 py-2 ${detailMode === "production" ? "bg-cyan-600 text-white" : "bg-slate-700 text-slate-200"}`}
                    >
                      생산계획
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailMode("leave")}
                      className={`flex-1 rounded px-2 py-2 ${detailMode === "leave" ? "bg-violet-600 text-white" : "bg-slate-700 text-slate-200"}`}
                    >
                      연월차
                    </button>
                  </div>

                  {detailMode === "production" ? (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-400">제품별 생산계획</p>
                        {canEdit ? (
                          <button type="button" className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200" onClick={addEntryRow}>
                            <Plus className="w-3 h-3" /> 제품 추가
                          </button>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_110px_76px_28px] items-center gap-1.5 px-1 text-[10px] font-medium text-slate-500">
                        <span>제품명</span>
                        <span>조건</span>
                        <span className="text-right">수량</span>
                        <span />
                      </div>
                      <div className="space-y-2 max-h-[min(40vh,320px)] overflow-y-auto pr-1">
                        {draft.entries.map((entry, idx) => (
                          <div key={`entry-${idx}`} className="grid grid-cols-[minmax(0,1fr)_110px_76px_28px] gap-1.5 items-center">
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
                              className="min-w-0 px-2 py-2 rounded-lg border border-slate-600 bg-space-800 text-xs text-slate-100"
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
                              className="min-w-0 px-2 py-2 rounded-lg border border-slate-600 bg-space-800 text-xs text-slate-100"
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
                              className="min-w-0 px-2 py-2 rounded-lg border border-slate-600 bg-space-800 text-xs text-slate-100 text-right"
                              placeholder="수량"
                            />
                            {canEdit ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    entries: prev.entries.filter((_, i) => i !== idx).map((x, i) => ({ ...x, sort_order: i })),
                                  }))
                                }
                                className="text-rose-400 hover:text-rose-300"
                                title="행 삭제"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <span />
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-400">연차/반차/기타 인원</p>
                        {canEdit ? (
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
                              onClick={() =>
                                setDraft((prev) => ({
                                  ...prev,
                                  leaves: [...prev.leaves, { leave_type: "annual", person_name: "" }],
                                }))
                              }
                            >
                              <Plus className="w-3 h-3" /> 연차
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
                              onClick={() =>
                                setDraft((prev) => ({
                                  ...prev,
                                  leaves: [...prev.leaves, { leave_type: "half", person_name: "" }],
                                }))
                              }
                            >
                              <Plus className="w-3 h-3" /> 반차
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200"
                              onClick={() =>
                                setDraft((prev) => ({
                                  ...prev,
                                  otherItems: [...prev.otherItems, { person_name: "", detail: "" }],
                                }))
                              }
                            >
                              <Plus className="w-3 h-3" /> 기타
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div className="space-y-1.5 max-h-[min(32vh,260px)] overflow-y-auto">
                        {draft.leaves.map((leave, idx) => (
                          <div key={`leave-${idx}`} className="grid grid-cols-[72px_1fr_28px] gap-1.5 items-center">
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
                              className="px-1 py-2 rounded-lg border border-slate-600 bg-space-800 text-xs text-slate-100"
                            >
                              <option value="annual">연차</option>
                              <option value="half">반차</option>
                            </select>
                            <input
                              list="planning-people-drawer"
                              value={leave.person_name}
                              disabled={!canEdit}
                              onChange={(e) =>
                                setDraft((prev) => {
                                  const next = prev.leaves.slice();
                                  next[idx] = { ...next[idx], person_name: e.target.value };
                                  return { ...prev, leaves: next };
                                })
                              }
                              className="px-2 py-2 rounded-lg border border-slate-600 bg-space-800 text-xs text-slate-100"
                              placeholder="이름"
                            />
                            {canEdit ? (
                              <button
                                type="button"
                                className="text-rose-400 hover:text-rose-300"
                                onClick={() => setDraft((prev) => ({ ...prev, leaves: prev.leaves.filter((_, i) => i !== idx) }))}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      <datalist id="planning-people-drawer">
                        {data.people.map((p) => (
                          <option key={p.id} value={p.name} />
                        ))}
                      </datalist>

                      <div className="space-y-1.5">
                        <p className="text-[11px] text-slate-500">기타(내용 : 이름)</p>
                        {draft.otherItems.map((item, idx) => (
                          <div key={`other-${idx}`} className="grid grid-cols-[1fr_1fr_28px] gap-1.5 items-center">
                            <input
                              value={item.detail}
                              disabled={!canEdit}
                              onChange={(e) =>
                                setDraft((prev) => {
                                  const next = prev.otherItems.slice();
                                  next[idx] = { ...next[idx], detail: e.target.value };
                                  return { ...prev, otherItems: next };
                                })
                              }
                              className="px-2 py-2 rounded-lg border border-slate-600 bg-space-800 text-xs text-slate-100"
                              placeholder="내용(예: 외근)"
                            />
                            <input
                              list="planning-people-drawer"
                              value={item.person_name}
                              disabled={!canEdit}
                              onChange={(e) =>
                                setDraft((prev) => {
                                  const next = prev.otherItems.slice();
                                  next[idx] = { ...next[idx], person_name: e.target.value };
                                  return { ...prev, otherItems: next };
                                })
                              }
                              className="px-2 py-2 rounded-lg border border-slate-600 bg-space-800 text-xs text-slate-100"
                              placeholder="이름"
                            />
                            {canEdit ? (
                              <button
                                type="button"
                                className="text-rose-400 hover:text-rose-300"
                                onClick={() =>
                                  setDraft((prev) => ({ ...prev, otherItems: prev.otherItems.filter((_, i) => i !== idx) }))
                                }
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <span />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {detailMode === "production" ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-slate-400">비고</label>
                        {canEdit ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs text-yellow-300 hover:text-yellow-200"
                            onClick={() => setShowNoteInput((prev) => !prev)}
                          >
                            <Plus className="w-3 h-3" /> 비고추가
                          </button>
                        ) : null}
                      </div>
                      <div className="space-y-1 max-h-[100px] overflow-y-auto">
                        {draft.notes.map((note, idx) => (
                          <div key={`note-${idx}`} className="grid grid-cols-[1fr_28px] gap-1 items-center">
                            <div className="px-2 py-1.5 rounded-lg border border-slate-700 bg-space-800/50 text-xs text-yellow-100">{note}</div>
                            {canEdit ? (
                              <button
                                type="button"
                                className="text-rose-400 hover:text-rose-300"
                                onClick={() => setDraft((prev) => ({ ...prev, notes: prev.notes.filter((_, i) => i !== idx) }))}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      {showNoteInput || draft.notes.length > 0 ? (
                        <div className="flex gap-1.5">
                          <input
                            value={draft.noteInput}
                            onChange={(e) => setDraft((prev) => ({ ...prev, noteInput: e.target.value }))}
                            disabled={!canEdit}
                            placeholder="비고 입력"
                            className="w-full px-3 py-2 rounded-lg border border-slate-600 bg-space-800 text-xs text-slate-100"
                          />
                          {canEdit ? (
                            <button
                              type="button"
                              className="px-2.5 py-2 rounded-lg border border-rose-600/60 text-rose-200 hover:bg-rose-500/10 text-xs"
                              onClick={() => {
                                setDraft((prev) => ({ ...prev, noteInput: "" }));
                                if (draft.notes.length === 0) setShowNoteInput(false);
                              }}
                            >
                              삭제
                            </button>
                          ) : null}
                          {canEdit ? (
                            <button
                              type="button"
                              className="px-2.5 py-2 rounded-lg border border-yellow-600/60 text-yellow-200 hover:bg-yellow-500/10 text-xs"
                              onClick={() =>
                                setDraft((prev) => {
                                  const text = prev.noteInput.trim();
                                  if (!text) return prev;
                                  return { ...prev, notes: [...prev.notes, text], noteInput: "" };
                                })
                              }
                            >
                              추가
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="rounded-lg border border-slate-700 bg-space-800/60 p-3 text-xs space-y-1">
                    <p className="text-slate-400">
                      당일 총 생산량 <span className="text-slate-100 tabular-nums font-medium">{selectedDayTotal.toLocaleString("ko-KR")}</span>
                    </p>
                    <p className="text-slate-400">
                      실투입인원(자동){" "}
                      <span className="text-cyan-200 tabular-nums font-medium">{selectedActualManpower.toLocaleString("ko-KR")}</span>
                      <span className="text-slate-500"> (기준 {baselineHeadcount})</span>
                    </p>
                    <p className="text-slate-500">연차 {annualCount} · 반차 {halfCount}</p>
                  </div>

                  <div className="rounded-lg border border-slate-700 bg-space-800/40 p-3 text-xs">
                    <p className="text-slate-500 mb-1">미리보기</p>
                    <div className="space-y-1">
                      {draft.entries
                        .filter((e) => e.productBase.trim() && toNumber(e.qtyText) > 0)
                        .slice(0, 4)
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
                      {draft.otherItems
                        .filter((x) => x.person_name.trim() && x.detail.trim())
                        .slice(0, 3)
                        .map((x, i) => (
                          <p key={`preview-other-${i}`} className="text-amber-200 truncate">
                            {x.detail.trim()} : {x.person_name.trim()}
                          </p>
                        ))}
                    </div>
                  </div>

                </div>
                <div className="shrink-0 border-t border-slate-700 bg-space-900/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={saveDay}
                      disabled={!canEdit || saving}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-sm font-medium"
                    >
                      <Save className="w-4 h-4" /> {saving ? "저장 중..." : "저장"}
                    </button>
                    <button
                      type="button"
                      onClick={duplicateToAnotherDate}
                      disabled={!canEdit}
                      className="px-4 py-3 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 text-sm inline-flex items-center gap-1 shrink-0"
                    >
                      <Copy className="w-4 h-4" /> 복제
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
