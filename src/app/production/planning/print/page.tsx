"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Printer, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { getKoreanHolidayName, isKoreanPublicHoliday, monthDays, weekdayOfFirstDay, ymd } from "@/features/production/planning/calculations";
import { computeMonthlyCategoryTotals } from "@/features/production/planning/computeMonthlyCategoryTotals";
import { formatMiniPlanningLabel, isMiniProductKind, rollupQtyForPlanning } from "@/features/production/planning/productClassification";
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

function cleanupCategorySuffix(name: string): string {
  return name.replace(/\((브레드|피자|파베이크)\)/g, "").replace(/\s{2,}/g, " ").trim();
}

/** 인쇄용: 제품명·수량만 (일반/브레드/파베이크사용 등 조건 문구는 생략) */
function formatPrintProductLine(productSnapshot: string, qty: number): { name: string; qtyText: string } {
  const sp = splitProductName(productSnapshot);
  const base = cleanupCategorySuffix(normalizedPrintName(sp.base));
  const name = isMiniProductKind(sp.kind) ? formatMiniPlanningLabel(base) : base;
  return {
    name,
    qtyText: qty.toLocaleString("ko-KR"),
  };
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

function stripOtherPrefix(noteText: string): string {
  return noteText.replace(/^\[기타\]\s*/, "").trim();
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function weekdayLabelOf(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return WEEKDAY_LABELS[d.getDay()] ?? "";
}

function isWeekendLabel(label: string): boolean {
  return label === "토" || label === "일";
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
  const canView =
    profile?.role === "admin" || profile?.role === "manager" || profile?.role === "headquarters";

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

  const weekGroups = useMemo(() => {
    const firstWeekday = weekdayOfFirstDay(year, month);
    const totalDays = monthDays(year, month);
    const weekCount = Math.ceil((firstWeekday + totalDays) / 7);
    const groups = Array.from({ length: weekCount }, (_, idx) => ({
      weekNo: idx + 1,
      dates: [] as string[],
    }));
    for (let day = 1; day <= totalDays; day += 1) {
      const dateKey = ymd(year, month, day);
      const rowIdx = Math.floor((firstWeekday + (day - 1)) / 7);
      groups[rowIdx]?.dates.push(dateKey);
    }
    return groups;
  }, [month, year]);

  type WeekRenderRow = {
    dateKey: string;
    weekdayLabel: string;
    isSun: boolean;
    isSat: boolean;
    holidayName: string | null;
    list: Array<{ product: string; qty: number }>;
    annualLeaveNames: string[];
    halfLeaveNames: string[];
    otherLine: string[];
    plainNotes: string[];
    hasAnyInfo: boolean;
  };

  const renderedWeeks = useMemo(() => {
    const weeks = weekGroups
      .map((week) => {
        const rows: WeekRenderRow[] = week.dates
          .map((dateKey) => {
            const list = entriesByDate.get(dateKey) ?? [];
            const dayLeaves = leavesByDate.get(dateKey) ?? [];
            const dayNotes = notesByDate.get(dateKey) ?? [];
            const annualLeaveNames = dayLeaves.filter((x) => x.type === "annual").map((x) => x.person);
            const halfLeaveNames = dayLeaves.filter((x) => x.type === "half").map((x) => x.person);
            const parsedOthers = dayNotes
              .map((note) => parseOtherNoteText(note))
              .filter((x): x is { detail: string; person: string } => x !== null);
            const otherLine = parsedOthers.map((x) => `${x.person}(${x.detail})`);
            const plainNotes = dayNotes
              .filter((note) => parseOtherNoteText(note) === null)
              .map((note) => stripOtherPrefix(note))
              .filter(Boolean);
            const holidayName = isKoreanPublicHoliday(dateKey) ? getKoreanHolidayName(dateKey) : null;
            const weekdayLabel = weekdayLabelOf(dateKey);
            const hasAnyInfo =
              list.length > 0 ||
              annualLeaveNames.length > 0 ||
              halfLeaveNames.length > 0 ||
              otherLine.length > 0 ||
              plainNotes.length > 0 ||
              Boolean(holidayName);
            return {
              dateKey,
              weekdayLabel,
              isSun: weekdayLabel === "일",
              isSat: weekdayLabel === "토",
              holidayName,
              list,
              annualLeaveNames,
              halfLeaveNames,
              otherLine,
              plainNotes,
              hasAnyInfo,
            };
          })
          .filter((row) => !(isWeekendLabel(row.weekdayLabel) && !row.hasAnyInfo));
        return { weekNo: week.weekNo, rows };
      })
      .filter((w) => w.rows.length > 0);

    const totalRows = weeks.reduce((sum, w) => sum + w.rows.length, 0);
    const normalWeeks = weeks.filter((w) => w.rows.length >= 3);
    const totalNormalRows = normalWeeks.reduce((sum, w) => sum + w.rows.length, 0);
    return weeks.map((w) => {
      const isCompact = w.rows.length <= 2;
      if (isCompact) {
        // 저행수 주차는 과확장을 막기 위해 compact 고정 가중치
        const compactGrow = w.rows.length <= 1 ? 0.22 : 0.3;
        return { ...w, isCompact, weekGrow: compactGrow };
      }
      const proportional = totalNormalRows > 0 ? (w.rows.length / totalNormalRows) * Math.max(1, normalWeeks.length) : 1;
      const weekGrow = Math.max(1, proportional);
      return { ...w, isCompact, weekGrow };
    });
  }, [entriesByDate, leavesByDate, notesByDate, weekGroups]);

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
              <p className="planning-a3-subtitle">출력일 {printDate}</p>
            </div>
            <div className="planning-a3-monthmark">{year}년 {month}월</div>
          </header>
          <div className="planning-a3-summary-line">
            <div className="planning-a3-summary-card">
              <p className="label">총</p>
              <p className="value">{rollup.totalQty.toLocaleString("ko-KR")}</p>
            </div>
            <div className="planning-a3-summary-card">
              <p className="label">피자</p>
              <p className="value">{rollup.pizzaQty.toLocaleString("ko-KR")}</p>
            </div>
            <div className="planning-a3-summary-card">
              <p className="label">브레드</p>
              <p className="value">{rollup.breadQty.toLocaleString("ko-KR")}</p>
            </div>
            <div className="planning-a3-summary-card">
              <p className="label">파베이크</p>
              <p className="value">{rollup.parbakeTotal.toLocaleString("ko-KR")}</p>
            </div>
          </div>

          <section className="planning-a3-list">
            {renderedWeeks.map((week) => (
                <section
                  key={`week-${week.weekNo}`}
                  className={`planning-week-block ${week.isCompact ? "compact" : "normal"}`}
                  style={{ ["--week-grow" as string]: String(week.weekGrow), ["--week-row-count" as string]: String(week.rows.length) }}
                >
                  <div className="planning-week-label" aria-label={`${week.weekNo}주차`}>
                    <span className="planning-week-label-stack">
                      {`${week.weekNo}주차`.split("").map((ch, i) => (
                        <span key={`week-${week.weekNo}-ch-${i}`} className="char">{ch}</span>
                      ))}
                    </span>
                  </div>
                  <div className="planning-week-main">
                    <div className="planning-week-head">
                      <div>날짜</div>
                      <div>생산계획</div>
                      <div>인원 / 특이사항</div>
                    </div>
                    {week.rows.map((row) => {
                      return (
                        <div key={row.dateKey} className="planning-week-row">
                          <div className={`planning-week-date ${row.holidayName ? "holiday" : row.isSun ? "sun" : row.isSat ? "sat" : ""}`}>
                            <p className="date-main">
                              {Number(row.dateKey.slice(5, 7))}/{Number(row.dateKey.slice(8, 10))} ({row.weekdayLabel})
                            </p>
                          </div>
                          <div className="planning-week-plan">
                            {row.holidayName ? <p className="holiday-inline">{row.holidayName}</p> : null}
                            {row.list.length === 0 && !row.holidayName ? (
                              <span className="dash">-</span>
                            ) : (
                              row.list.map((item, i) => {
                                const qty = rollupQtyForPlanning(item.product, item.qty);
                                const line = formatPrintProductLine(item.product, qty);
                                return (
                                  <span key={`${row.dateKey}-prod-${i}`} className="plan-item">
                                    <span className="name">{line.name}</span> <span className="qty">{line.qtyText}</span>
                                    {i < row.list.length - 1 ? <span className="sep"> / </span> : null}
                                  </span>
                                );
                              })
                            )}
                          </div>
                          <div className="planning-week-meta">
                            {!row.hasAnyInfo ? <span className="dash">-</span> : null}
                            {row.annualLeaveNames.length > 0 ? (
                              <p className="meta-line leave">
                                <span className="tag">휴무:</span> {row.annualLeaveNames.join(", ")}
                              </p>
                            ) : null}
                            {row.halfLeaveNames.length > 0 ? (
                              <p className="meta-line half">
                                <span className="tag">반차:</span> {row.halfLeaveNames.join(", ")}
                              </p>
                            ) : null}
                            {row.otherLine.length > 0 ? (
                              <p className="meta-line other">
                                <span className="tag">기타:</span> {row.otherLine.join(", ")}
                              </p>
                            ) : null}
                            {row.plainNotes.length > 0 ? (
                              <p className="meta-line note">
                                <span className="tag">비고:</span> {row.plainNotes.join(", ")}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
            ))}
          </section>
          <footer className="planning-a3-legend">
            <span><em>휴무:</em> 연차 / 휴무</span>
            <span><em>반차:</em> 반차</span>
            <span><em>기타:</em> 기타 사유</span>
            <span><em>비고:</em> 참고 사항</span>
          </footer>
        </main>
      ) : null}
    </div>
  );
}
