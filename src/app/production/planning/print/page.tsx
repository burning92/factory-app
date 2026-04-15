"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Printer, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { getKoreanHolidayName, isKoreanPublicHoliday, monthDays, weekdayOfFirstDay, ymd } from "@/features/production/planning/calculations";
import { computeMonthlyCategoryTotals } from "@/features/production/planning/computeMonthlyCategoryTotals";
import type { PlanningMonthData } from "@/features/production/planning/types";

type LeaveTag = { type: "annual" | "half"; person: string };

function safeNum(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function splitProductName(full: string): { base: string; kind: string } {
  const raw = full.trim();
  const idx = raw.indexOf(" - ");
  if (idx < 0) return { base: raw, kind: "" };
  return { base: raw.slice(0, idx).trim(), kind: raw.slice(idx + 3).trim() };
}

function normalizedPrintName(base: string): string {
  let n = base.trim();
  if (!n) return n;
  if (n.includes("파베이크") && !n.includes("우주인")) {
    n = n.replaceAll("선인", "판매용");
  }
  // 인쇄 전용: 브랜드명 축약 (포노부오노 시그니처/바질&허니/리코타&허니 등 공통)
  n = n.replaceAll("포노부오노", "포노");
  return n;
}

function adjustedQty(productName: string, qty: number): number {
  return productName.includes("(2입)") ? qty * 2 : qty;
}

function cleanupCategorySuffix(name: string): string {
  return name.replace(/\((브레드|피자|파베이크)\)/g, "").replace(/\s{2,}/g, " ").trim();
}

/** 인쇄용: 제품명·수량만 (일반/브레드/파베이크사용 등 조건 문구는 생략) */
function formatPrintProductLine(productSnapshot: string, qty: number): { name: string; qtyText: string } {
  const sp = splitProductName(productSnapshot);
  const base = cleanupCategorySuffix(normalizedPrintName(sp.base));
  return {
    name: base,
    qtyText: qty.toLocaleString("ko-KR"),
  };
}

function productToneClass(name: string): "parbake" | "bread" | "pizza" {
  if (name.includes("파베이크")) return "parbake";
  if (name.includes("브레드") || name.includes("포노")) return "bread";
  return "pizza";
}

function parseOtherNoteText(noteText: string): { detail: string; person: string } | null {
  const prefix = "[기타]";
  const t = noteText.trim();
  if (!t.startsWith(prefix)) return null;
  const body = t.slice(prefix.length).trim();
  const idx = body.lastIndexOf(" : ");
  if (idx <= 0) return null;
  const detail = body.slice(0, idx).trim();
  const person = body.slice(idx + 3).trim();
  if (!detail || !person) return null;
  return { detail, person };
}

export default function PlanningPrintPage() {
  const now = new Date();
  const sp = useSearchParams();
  const year = safeNum(sp.get("year"), now.getFullYear());
  const month = safeNum(sp.get("month"), now.getMonth() + 1);
  const [data, setData] = useState<PlanningMonthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { profile, loading: authLoading } = useAuth();
  const canView = profile?.role === "admin" || profile?.role === "manager";

  const loadMonth = useCallback(async () => {
    if (authLoading) return;
    if (!canView) {
      setError("월간 플래닝 인쇄는 관리자/매니저만 사용할 수 있습니다.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token || !session?.refresh_token) {
      setError("로그인 세션이 없습니다.");
      setLoading(false);
      return;
    }
    const qs = new URLSearchParams({ year: String(year), month: String(month) });
    const res = await fetch(`/api/production/planning/month?${qs.toString()}`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token,
      },
    });
    const json = (await res.json()) as { ok?: boolean; data?: PlanningMonthData; error?: string; message?: string };
    if (!res.ok || !json.ok || !json.data) {
      setError(json.message ?? json.error ?? "인쇄 데이터를 불러오지 못했습니다.");
      setLoading(false);
      return;
    }
    setData(json.data);
    setLoading(false);
  }, [authLoading, canView, month, year]);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, Array<{ product: string; qty: number }>>();
    for (const e of data?.entries ?? []) {
      const list = map.get(e.plan_date) ?? [];
      list.push({ product: e.product_name_snapshot, qty: Number(e.qty) || 0 });
      map.set(e.plan_date, list);
    }
    for (const [k, list] of Array.from(map.entries())) {
      map.set(k, list.sort((a, b) => b.qty - a.qty));
    }
    return map;
  }, [data?.entries]);

  const leavesByDate = useMemo(() => {
    const map = new Map<string, LeaveTag[]>();
    for (const l of data?.leaves ?? []) {
      const list = map.get(l.plan_date) ?? [];
      list.push({ type: l.leave_type, person: l.person_name });
      map.set(l.plan_date, list);
    }
    return map;
  }, [data?.leaves]);

  const notesByDate = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of data?.notes ?? []) {
      const list = map.get(n.plan_date) ?? [];
      list.push(n.note_text);
      map.set(n.plan_date, list);
    }
    return map;
  }, [data?.notes]);

  const calendarCells = useMemo(() => {
    const firstWeekday = weekdayOfFirstDay(year, month);
    const totalDays = monthDays(year, month);
    const cells: Array<string | null> = [];
    for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
    for (let d = 1; d <= totalDays; d += 1) cells.push(ymd(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month, year]);

  const rollup = useMemo(() => (data ? computeMonthlyCategoryTotals(data.entries) : null), [data]);

  const printDate = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  return (
    <div className="planning-a3-wrap">
      <div className="print:hidden mx-auto flex w-full max-w-[1200px] items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-3 text-sm">
          <Link href="/production/planning" className="text-cyan-300 hover:underline">
            ← 월간 플래닝으로 돌아가기
          </Link>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 새로고침
          </button>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1 rounded bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500"
        >
          <Printer className="h-4 w-4" /> A3 인쇄
        </button>
      </div>

      {loading ? <p className="px-4 py-10 text-sm text-slate-300">인쇄 데이터를 불러오는 중...</p> : null}
      {error ? <p className="px-4 py-10 text-sm text-rose-300">{error}</p> : null}

      {!loading && !error && data && rollup ? (
        <main className="planning-a3-page">
          <header className="planning-a3-header">
            <div>
              <h1 className="planning-a3-title">월간 생산계획표</h1>
              <p className="planning-a3-subtitle">
                {year}년 {month}월 · 출력일 {printDate}
              </p>
            </div>
            <div className="planning-a3-monthmark">{year}년 {month}월</div>
          </header>
          <div className="planning-a3-summary-line">
            <span>총 {rollup.totalQty.toLocaleString("ko-KR")}</span>
            <span>피자 {rollup.pizzaQty.toLocaleString("ko-KR")}</span>
            <span>브레드 {rollup.breadQty.toLocaleString("ko-KR")}</span>
            <span>파베이크 {rollup.parbakeTotal.toLocaleString("ko-KR")}</span>
          </div>

          <section className="planning-a3-calendar">
            {["일", "월", "화", "수", "목", "금", "토"].map((w, idx) => (
              <div key={w} className={`planning-a3-weekday ${idx === 0 ? "sun" : idx === 6 ? "sat" : ""}`}>
                {w}
              </div>
            ))}
            {calendarCells.map((dateKey, idx) => {
              if (!dateKey) return <div key={`empty-${idx}`} className="planning-a3-cell empty" />;
              const list = entriesByDate.get(dateKey) ?? [];
              const dayLeaves = leavesByDate.get(dateKey) ?? [];
              const dayNotes = notesByDate.get(dateKey) ?? [];
              const holidayName = isKoreanPublicHoliday(dateKey) ? getKoreanHolidayName(dateKey) : null;
              const weekday = idx % 7;
              const isSunday = weekday === 0;
              const isSaturday = weekday === 6;
              const isWeekend = isSunday || isSaturday;
              return (
                <div key={dateKey} className={`planning-a3-cell ${isWeekend ? "weekend" : "weekday"}`}>
                  <div className="planning-a3-cell-head">
                    <span
                      className={`date ${holidayName || isSunday ? "holiday" : isSaturday ? "sat" : ""}`}
                    >
                      {Number(dateKey.slice(8, 10))}
                    </span>
                  </div>
                  <div className="planning-a3-cell-main">
                    {holidayName ? <p className="planning-a3-holiday">🔴 {holidayName}</p> : null}
                    <div className="planning-a3-products">
                      {list.map((row, i) => {
                        const qty = adjustedQty(row.product, row.qty);
                        const line = formatPrintProductLine(row.product, qty);
                        const tone = productToneClass(line.name);
                        return (
                          <p key={`${row.product}-${i}`} className={`planning-a3-product-row ${tone}`}>
                            <span className="name">{line.name}</span>
                            <span className="qty">{line.qtyText}</span>
                          </p>
                        );
                      })}
                    </div>
                  </div>
                  <div className="planning-a3-cell-meta">
                    {dayLeaves.filter((x) => x.type === "annual").length > 0 ? (
                      <p className="planning-a3-meta leave">
                        <span className="planning-a3-meta-label">🟥휴무:</span>
                        <span className="planning-a3-meta-names">
                          {dayLeaves.filter((x) => x.type === "annual").map((x) => x.person).join(", ")}
                        </span>
                      </p>
                    ) : null}
                    {dayLeaves.filter((x) => x.type === "half").length > 0 ? (
                      <p className="planning-a3-meta half">
                        <span className="planning-a3-meta-label">🟨반차:</span>
                        <span className="planning-a3-meta-names">
                          {dayLeaves.filter((x) => x.type === "half").map((x) => x.person).join(", ")}
                        </span>
                      </p>
                    ) : null}
                    {dayNotes.length > 0 ? (
                      <div className="planning-a3-meta-list">
                        {dayNotes.slice(0, 1).map((n, i) => {
                          const parsed = parseOtherNoteText(n);
                          return (
                            <p key={`${dateKey}-note-${i}`} className={`note ${parsed ? "" : "alert"}`}>
                              {parsed ? `🟩기타: ${parsed.detail} : ${parsed.person}` : `■ 비고: ${n}`}
                            </p>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </section>
        </main>
      ) : null}
    </div>
  );
}
