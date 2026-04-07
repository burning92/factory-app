"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { useMasterStore } from "@/store/useMasterStore";
import { bomRowsToRefs, materialsToMeta } from "@/features/dashboard/bomMaterialAdapters";
import { loadProductionBundle } from "@/features/dashboard/loadProductionBundle";
import {
  mergeBundleDaysWithManualImportsForTable,
  rollupWasteMockFromDayRows,
  computeWasteYoySamePeriod,
  formatDeltaPctPoint,
  wasteYoYDeltaToneClass,
  type ManualWasteImportSeries,
  type WasteYoySamePeriodResult,
  type WasteRollupFromDayRows,
} from "@/features/dashboard/wasteDetailMockData";
import {
  loadPlanActualDashboardMetrics,
  planActualSparklineWindowMonths,
} from "@/features/dashboard/planVsActual";
import { loadClimateDashboardWindows, loadEquipmentIssues } from "@/features/dashboard/climateAndEquipment";
import {
  loadManpowerUtilizationMonthSummary,
  DEFAULT_DASHBOARD_BASELINE_HEADCOUNT,
  formatMonthlyOperatingDays,
} from "@/features/dashboard/manpowerUtilization";
import { AlertTriangle, CheckCircle2, Droplets, Info, LayoutDashboard, Thermometer, Zap } from "lucide-react";
import { executiveTooltipHostRowClass, executiveTooltipPanelClass } from "./executiveTooltipStyles";
import type { ProductionBundle } from "@/features/dashboard/loadProductionBundle";
import type { PlanActualDashboardMetrics } from "@/features/dashboard/planVsActual";
import type { ClimateDashboardWindows } from "@/features/dashboard/climateAndEquipment";
import type { ManpowerMonthSummary } from "@/features/dashboard/manpowerUtilization";

function pct(n: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function utilizationBarWidth(pctVal: number | null): string {
  if (pctVal == null || Number.isNaN(pctVal) || pctVal <= 0) return "0%";
  return `${Math.min(100, pctVal)}%`;
}

/** 직전 동일 기간(예: 직전 7일) 평균 대비 증감 문구 */
function climateTrendVsPrevious(
  current: number | null,
  previous: number | null,
  kind: "temp" | "humid"
): string | null {
  if (current == null || previous == null) return null;
  const d = current - previous;
  const eps = kind === "temp" ? 0.05 : 0.05;
  if (Math.abs(d) < eps) return "→ 직전 기간과 동일";
  const arrow = d > 0 ? "▲" : "▼";
  const abs = Math.abs(d).toFixed(1);
  return kind === "temp" ? `${arrow} ${abs}°C` : `${arrow} ${abs}%`;
}

function num(n: number): string {
  return n.toLocaleString("ko-KR");
}

/** 폐기율(%) 텍스트·막대 톤 — 4% 미만 안정, 4~10% 주의, 10%↑ 위험 */
function wasteRateToneClass(ratePct: number | null): string {
  if (ratePct == null || Number.isNaN(ratePct)) return "text-slate-400";
  if (ratePct >= 10) return "text-red-400";
  if (ratePct >= 4) return "text-amber-400";
  return "text-cyan-300";
}

/** 미니 바: 10%를 꽉 찬 폭으로 스케일 */
function wasteSubRateBarWidth(ratePct: number | null): string {
  if (ratePct == null || !Number.isFinite(ratePct) || ratePct <= 0) return "0%";
  return `${Math.min(100, (ratePct / 10) * 100)}%`;
}

function wasteSubRateBarFillClass(ratePct: number | null): string {
  if (ratePct == null || Number.isNaN(ratePct)) return "bg-slate-600/40";
  if (ratePct >= 10) return "bg-gradient-to-r from-red-500/85 to-red-400/65";
  if (ratePct >= 4) return "bg-gradient-to-r from-amber-500/80 to-amber-400/60";
  return "bg-gradient-to-r from-cyan-500/70 to-teal-400/55";
}

/** 미래 월 막대 높이(아직 해당 월이 오지 않음) — 실적 없음을 낮은 막대로만 표시 */
const PLAN_ACTUAL_SPARKLINE_FUTURE_PLACEHOLDER_PCT = 12;

function PlanActualYtdAchievementMiniBars({
  year,
  currentMonth,
  currentMonthAchievementPct,
  achievementPctByMonth,
}: {
  year: number;
  currentMonth: number;
  currentMonthAchievementPct: number | null;
  /** 스파크라인 구간 내 월별 종합 달성률(상세·도넛과 동일 소스). 미래 월은 키 없음. */
  achievementPctByMonth: Record<number, number | null>;
}) {
  const months = planActualSparklineWindowMonths(currentMonth);
  const values = months.map((m) => {
    if (m > currentMonth) return PLAN_ACTUAL_SPARKLINE_FUTURE_PLACEHOLDER_PCT;
    const fromApi = achievementPctByMonth[m];
    if (fromApi != null && Number.isFinite(fromApi)) return fromApi;
    if (m === currentMonth && currentMonthAchievementPct != null && Number.isFinite(currentMonthAchievementPct)) {
      return currentMonthAchievementPct;
    }
    return 0;
  });
  const maxVal = Math.max(...values, 1);

  function tooltipAchievement(m: number): number | null {
    if (m > currentMonth) return null;
    const fromApi = achievementPctByMonth[m];
    if (fromApi != null && Number.isFinite(fromApi)) return fromApi;
    if (m === currentMonth && currentMonthAchievementPct != null && Number.isFinite(currentMonthAchievementPct)) {
      return currentMonthAchievementPct;
    }
    return null;
  }

  return (
    <div className="w-full min-w-0 overflow-visible pt-1" aria-label={`${year}년 월별 달성 추이 미리보기`}>
      <p className="mb-2 text-left text-xs font-semibold text-gray-500">올해 월별 달성 추이</p>
      <div className="relative z-[65] flex h-[4.75rem] items-end justify-between gap-1 overflow-visible sm:gap-1.5">
        {months.map((m, i) => {
          const v = values[i]!;
          const hPct = Math.max(8, (v / maxVal) * 100);
          const isPast = m < currentMonth;
          const isCurrent = m === currentMonth;
          const isFuture = m > currentMonth;
          const tip = tooltipAchievement(m);
          const exceptional =
            !isFuture && tip != null && Number.isFinite(tip) && tip >= 110;
          const beatTarget =
            !isFuture &&
            tip != null &&
            Number.isFinite(tip) &&
            tip >= 100 &&
            tip < 110;
          const tipLabel =
            tip != null ? `${tip.toFixed(1)}%` : m > currentMonth ? "—" : "불러오는 중…";
          const barTone =
            isFuture
              ? "bg-slate-600/30"
              : isCurrent && !beatTarget && !exceptional
                ? "bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.35)]"
                : exceptional
                  ? "bg-gradient-to-t from-amber-900/95 via-amber-500/90 to-amber-100 shadow-[0_0_20px_rgba(251,191,36,0.48)] ring-1 ring-amber-300/35"
                  : beatTarget
                    ? "bg-gradient-to-t from-emerald-700/90 via-teal-500/85 to-cyan-300 shadow-[0_0_16px_rgba(45,212,191,0.42)] ring-1 ring-emerald-400/25"
                    : isPast
                      ? "bg-slate-600"
                      : "bg-slate-600/30";
          const tooltipToneClass = exceptional
            ? "text-amber-100"
            : beatTarget
              ? "text-emerald-200"
              : "text-[#72E3E3]";
          return (
            <div
              key={`${year}-${m}`}
              className="group relative z-[70] flex min-w-0 flex-1 cursor-default flex-col items-center gap-1 px-0.5"
            >
              <span
                role="tooltip"
                className={`pointer-events-none absolute bottom-full left-1/2 z-[110] mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-600/90 bg-slate-900/98 px-2.5 py-1.5 text-xs font-semibold tabular-nums opacity-0 shadow-lg shadow-black/60 ring-1 ring-black/40 transition-opacity duration-150 group-hover:opacity-100 ${tooltipToneClass}`}
              >
                {year}년 {m}월 · {tipLabel}
                {exceptional ? (
                  <span className="ml-1.5 font-normal text-amber-300/95">110% 이상</span>
                ) : beatTarget ? (
                  <span className="ml-1.5 font-normal text-emerald-400/90">목표 달성</span>
                ) : null}
              </span>
              <div className="flex h-14 w-full items-end justify-center">
                <div
                  className={`relative w-[min(100%,1.35rem)] rounded-sm transition-[height] duration-500 ease-out sm:w-5 ${barTone}`}
                  style={{ height: `${hPct}%` }}
                >
                  {exceptional ? (
                    <span
                      className="pointer-events-none absolute -top-0.5 left-1/2 h-1 w-[78%] -translate-x-1/2 rounded-full bg-gradient-to-r from-transparent via-amber-100/95 to-transparent shadow-[0_0_12px_rgba(254,243,199,0.9)]"
                      aria-hidden
                    />
                  ) : beatTarget ? (
                    <span
                      className="pointer-events-none absolute -top-0.5 left-1/2 h-1 w-[72%] -translate-x-1/2 rounded-full bg-gradient-to-r from-transparent via-emerald-200/95 to-transparent shadow-[0_0_10px_rgba(167,243,208,0.75)]"
                      aria-hidden
                    />
                  ) : null}
                </div>
              </div>
              <span className="text-[10px] tabular-nums text-gray-500 sm:text-xs">{m}월</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlanActualCategoryMiniDonut({
  label,
  achievementPct,
  strokeGradientId,
}: {
  label: string;
  achievementPct: number | null;
  strokeGradientId: string;
}) {
  const R = 26;
  const C = 2 * Math.PI * R;
  const valid = achievementPct != null && Number.isFinite(achievementPct);
  const clamp = valid ? Math.min(Math.max(achievementPct as number, 0), 100) : 0;
  const offset = C * (1 - clamp / 100);
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-end px-0.5 sm:px-1">
      <div className="relative mx-auto aspect-square w-[min(100%,5.25rem)]">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 64 64" aria-hidden>
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            className="text-slate-700/80"
          />
          <circle
            cx="32"
            cy="32"
            r={R}
            fill="none"
            stroke={`url(#${strokeGradientId})`}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
            className="transition-[stroke-dashoffset] duration-500 ease-out"
            style={{ filter: "drop-shadow(0 0 5px rgba(34, 211, 238, 0.2))" }}
          />
          <defs>
            <linearGradient id={strokeGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgb(103, 232, 249)" stopOpacity="0.82" />
              <stop offset="100%" stopColor="rgb(45, 212, 191)" stopOpacity="0.72" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex items-center justify-center px-0.5">
          <span className="text-center text-xs font-semibold tabular-nums leading-tight text-cyan-100/95 sm:text-sm">
            {valid ? `${(achievementPct as number).toFixed(1)}%` : "—"}
          </span>
        </div>
      </div>
      <p className="mt-2 text-center text-xs font-medium text-gray-400">{label}</p>
    </div>
  );
}

/** 데스크톱 넓은 대시보드용 공통 카드 셸 */
const dashCard =
  "rounded-xl border border-slate-700/60 bg-slate-800/50 p-5 md:p-6 lg:p-7 flex flex-col min-h-0 shadow-sm shadow-black/10";
/** 카드 헤더 타이틀 */
const dashTitle = "text-base font-bold text-white tracking-tight";
/** 대장 지표: 생산량 총합, 종합 달성률, 이번 달 투입률 */
const dashHero = "text-4xl font-extrabold tracking-tight tabular-nums";
/** 부대장 지표: 온·습도 평균, 폐기율 전체, 올해 평균 투입률 */
const dashSubHero = "text-3xl font-bold tabular-nums";
/** 서브 지표 숫자 */
const dashSubMetric = "text-base font-semibold tabular-nums";
/** 보조 설명·날짜·부가 문구 */
const dashMuted = "text-sm text-gray-400";
/** 작은 라벨(섹션 머리글 등) */
const dashLabelXs = "text-xs font-semibold uppercase tracking-wide text-gray-400";

export default function ExecutiveDashboardPage() {
  const planActualMiniDonutGradId = useId().replace(/:/g, "");
  const router = useRouter();
  const { profile, viewOrganizationCode, loading: authLoading } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const canView = profile?.role === "admin" || profile?.role === "manager";

  const materials = useMasterStore((s) => s.materials);
  const bomList = useMasterStore((s) => s.bomList);
  const materialsLoading = useMasterStore((s) => s.materialsLoading);
  const bomLoading = useMasterStore((s) => s.bomLoading);
  const fetchMaterials = useMasterStore((s) => s.fetchMaterials);
  const fetchBom = useMasterStore((s) => s.fetchBom);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ProductionBundle | null>(null);
  const [planDashboard, setPlanDashboard] = useState<PlanActualDashboardMetrics | null>(null);
  /** 스파크라인: 이번 달이 속한 4개월 창 중, 이번 달 이하 월만 집계(상세 페이지와 동일 API) */
  const [planSparklineAchievementByMonth, setPlanSparklineAchievementByMonth] = useState<
    Record<number, number | null>
  >({});
  const [climateWindows, setClimateWindows] = useState<ClimateDashboardWindows | null>(null);
  const [equipment, setEquipment] = useState<{ issueCount: number } | null>(null);
  const [manpower, setManpower] = useState<ManpowerMonthSummary | null>(null);
  /** 수동 JSONL 병합 후 올해 폐기 누적(상세 페이지와 동일 소스) */
  const [wasteMergedRollup, setWasteMergedRollup] = useState<WasteRollupFromDayRows | null>(null);
  const [wasteYoy, setWasteYoy] = useState<WasteYoySamePeriodResult | null>(null);

  const year = useMemo(() => new Date().getFullYear(), []);
  const calendarMonth = useMemo(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!canView) router.replace("/");
  }, [authLoading, canView, router]);

  useEffect(() => {
    fetchMaterials();
    fetchBom();
  }, [fetchMaterials, fetchBom]);

  useEffect(() => {
    if (!canView) return;
    if (materialsLoading || bomLoading) return;

    let cancelled = false;
    (async () => {
      setLoadError(null);
      const bomRefs = bomRowsToRefs(bomList);
      const meta = materialsToMeta(materials);
      const { bundle: b, error: be } = await loadProductionBundle(supabase, year, bomRefs, meta);
      if (cancelled) return;
      if (be) {
        setLoadError(be.message);
        setBundle(null);
        setPlanDashboard(null);
        setPlanSparklineAchievementByMonth({});
        setManpower(null);
        setWasteMergedRollup(null);
        setWasteYoy(null);
      } else {
        setBundle(b);
        try {
          const emptyManual = (): ManualWasteImportSeries => ({
            doughProductionByDate: {},
            doughWasteByDate: {},
            parbakeWasteByDate: {},
            parbakeProductionByDate: {},
          });
          const normManual = (raw: Partial<ManualWasteImportSeries>): ManualWasteImportSeries => ({
            doughProductionByDate: raw.doughProductionByDate ?? {},
            doughWasteByDate: raw.doughWasteByDate ?? {},
            parbakeWasteByDate: raw.parbakeWasteByDate ?? {},
            parbakeProductionByDate: raw.parbakeProductionByDate ?? {},
          });
          const fetchManual = async (y: number) => {
            const r = await fetch(`/api/internal/manual-imports/summary?year=${y}`);
            if (!r.ok) return emptyManual();
            return normManual((await r.json()) as Partial<ManualWasteImportSeries>);
          };
          const [bPrev, mCur, mPrev] = await Promise.all([
            loadProductionBundle(supabase, year - 1, bomRefs, meta),
            fetchManual(year),
            fetchManual(year - 1),
          ]);
          if (cancelled) return;
          if (!b?.days) {
            setWasteMergedRollup(null);
            setWasteYoy(null);
          } else {
            const rowsCur = mergeBundleDaysWithManualImportsForTable(b.days, mCur).rows;
            setWasteMergedRollup(rollupWasteMockFromDayRows(rowsCur));
            const rowsPrev = mergeBundleDaysWithManualImportsForTable(bPrev.bundle?.days ?? [], mPrev).rows;
            setWasteYoy(computeWasteYoySamePeriod(rowsCur, rowsPrev, year));
          }
        } catch {
          if (!cancelled) {
            setWasteMergedRollup(null);
            setWasteYoy(null);
          }
        }
        const sparkMonths = planActualSparklineWindowMonths(calendarMonth.m);
        const monthsToLoad = Array.from(
          new Set(sparkMonths.filter((m) => m <= calendarMonth.m))
        ).sort((a, b) => a - b);
        const planResults = await Promise.all(
          monthsToLoad.map((m) => loadPlanActualDashboardMetrics(supabase, calendarMonth.y, m))
        );
        if (cancelled) return;
        const byMonth: Record<number, number | null> = {};
        monthsToLoad.forEach((m, i) => {
          byMonth[m] = planResults[i]!.achievementPct;
        });
        setPlanSparklineAchievementByMonth(byMonth);
        const curIdx = monthsToLoad.indexOf(calendarMonth.m);
        setPlanDashboard(curIdx >= 0 ? planResults[curIdx]! : null);
        const mp = await loadManpowerUtilizationMonthSummary(
          supabase,
          calendarMonth.y,
          calendarMonth.m,
          DEFAULT_DASHBOARD_BASELINE_HEADCOUNT
        );
        if (cancelled) return;
        setManpower(mp);
      }

      const cl = await loadClimateDashboardWindows(supabase, orgCode, 7);
      const eq = await loadEquipmentIssues(supabase, orgCode, 7);
      if (cancelled) return;
      setClimateWindows(cl);
      setEquipment(eq);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    canView,
    materialsLoading,
    bomLoading,
    materials,
    bomList,
    year,
    calendarMonth.y,
    calendarMonth.m,
    orgCode,
  ]);

  if (authLoading || !profile) {
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] flex items-center justify-center p-6">
        <p className="text-slate-500 text-sm">로딩 중…</p>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] flex items-center justify-center p-6">
        <p className="text-slate-500 text-sm">이동 중…</p>
      </div>
    );
  }

  const y = bundle?.ytdProduction;
  /** 폐기 카드: 수동 JSONL 병합값 우선, 실패 시 스냅샷·이카운트 번들 ytd */
  const w = wasteMergedRollup ?? bundle?.ytdWaste;

  const totalProductionYtd =
    y != null
      ? y.lightPizza + y.heavyPizza + y.bread + y.other + y.astronautParbake + y.saleParbake
      : null;

  const mainBarMax =
    y != null ? Math.max(y.lightPizza, y.heavyPizza, y.bread, 1) : 1;
  const barPct = (v: number) => `${Math.min(100, (v / mainBarMax) * 100)}%`;

  /**
   * 인력 카드 — 1인당 일평균 생산성(완제품 개/일·인)
   * 계산식: 이번 달 총 생산량 / 이번 달 가동일 / 이번 달 평균 투입 인원
   * (이번 달 총 생산량은 대시보드 생산량 카드와 동일하게 `bundle.days`의 해당 월 `totalFinishedQty` 합)
   */
  const manpowerProductivityUnitsPerPersonDay = useMemo(() => {
    if (
      !manpower?.hasProcessedPlanData ||
      manpower.avgDailyManpower == null ||
      manpower.avgDailyUtilizationPct == null
    ) {
      return null;
    }
    const opDays = manpower.daysWithManpower;
    const avgHead = manpower.avgDailyManpower;
    if (opDays <= 0 || avgHead <= 0) return null;
    if (bundle?.days == null) return null;
    const prefix = `${calendarMonth.y}-${String(calendarMonth.m).padStart(2, "0")}`;
    let monthTotalProd = 0;
    for (const d of bundle.days) {
      if (d.date.startsWith(prefix)) monthTotalProd += d.totalFinishedQty;
    }
    return monthTotalProd / opDays / avgHead;
  }, [
    bundle?.days,
    manpower?.hasProcessedPlanData,
    manpower?.daysWithManpower,
    manpower?.avgDailyManpower,
    manpower?.avgDailyUtilizationPct,
    calendarMonth.y,
    calendarMonth.m,
  ]);

  const climateDashboardCard = useMemo(() => {
    if (!climateWindows || climateWindows.current.dayCount <= 0) return null;
    const c = climateWindows.current;
    const p = climateWindows.previous;
    const tempTrend = climateTrendVsPrevious(c.overallAvgTemp, p.overallAvgTemp, "temp");
    const humTrend = climateTrendVsPrevious(c.overallAvgHumidity, p.overallAvgHumidity, "humid");
    const tempOk = c.overallAvgTemp != null && c.overallAvgTemp <= 20;
    const tempHeroClass = tempOk
      ? "text-cyan-200 drop-shadow-[0_0_18px_rgba(34,211,238,0.12)]"
      : "text-amber-200/95 drop-shadow-[0_0_14px_rgba(251,191,36,0.12)]";
    return { c, tempTrend, humTrend, tempHeroClass };
  }, [climateWindows]);

  return (
    <div className="mx-auto w-full min-h-[calc(100dvh-3.5rem)] md:min-h-0 max-w-[1800px] px-4 md:px-6 lg:px-8 xl:px-10 pb-24 md:pb-8">
      <header className="mb-6 md:mb-8 lg:mb-10">
        <div className="flex items-center gap-2 text-cyan-400/90 mb-2">
          <LayoutDashboard className="w-6 h-6 md:w-7 md:h-7" strokeWidth={1.8} />
          <span className="text-xs md:text-sm font-semibold uppercase tracking-wide">Dashboard</span>
        </div>
        <h1 className="text-2xl md:text-3xl lg:text-4xl font-semibold text-slate-100 tracking-tight">
          대시보드
        </h1>
        <p className="text-slate-500 text-sm md:text-base mt-2 md:mt-3 max-w-4xl leading-relaxed">
          {year}년 생산량은 2차 마감 + 이카운트 보정(선택) · 온습도·설비는 최근 7일
        </p>
      </header>

      {loadError && (
        <p className="text-amber-200/90 text-sm mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          {loadError}
        </p>
      )}

      <div className="flex flex-col gap-4 md:gap-5 lg:gap-6">
        {/* 데스크톱 1행: 핵심 KPI 2개(7+5) · 모바일 1열 · 태블릿은 각각 전체 폭 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 lg:gap-6 gap-4 md:gap-5 lg:items-stretch">
        <section className={`${dashCard} lg:col-span-7 lg:min-h-[300px]`}>
          <div className={`flex items-center justify-between gap-2 mb-1 ${executiveTooltipHostRowClass}`}>
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className={dashTitle}>생산량 (올해 누적)</h2>
              <span className="group relative inline-flex shrink-0">
                <button
                  type="button"
                  className="rounded p-0.5 text-cyan-500/80 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                  aria-label="생산량 집계 기준 안내"
                >
                  <Info className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                </button>
                <span
                  role="tooltip"
                  className={`${executiveTooltipPanelClass} left-1/2 w-[min(18rem,calc(100vw-2rem))] -translate-x-1/2 md:left-0 md:translate-x-0`}
                >
                  <span className="block">
                    2차 마감 스냅샷 기준(일별 표는 상세 페이지). 이카운트 생산입고는 2차 마감 없는 일자만
                    합산.
                  </span>
                  <span className="mt-1.5 block text-slate-400">
                    {bundle?.ecountMerge ? (
                      <>
                        이카운트 생산입고 {bundle.ecountMerge.linesCounted.toLocaleString("ko-KR")}행 반영 · 2차
                        마감 일 {bundle.ecountMerge.skippedBecauseSecondClosed.toLocaleString("ko-KR")}행 제외
                        {bundle.ecountMerge.error ? ` · ${bundle.ecountMerge.error}` : ""}
                      </>
                    ) : (
                      <>이카운트는 붙여넣기·동기화 후 누적에 반영됩니다.</>
                    )}
                  </span>
                </span>
              </span>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0 text-right">
              <Link href="/executive/production" className="text-sm font-medium text-cyan-400 hover:text-cyan-300">
                상세보기 →
              </Link>
              <Link href="/executive/ecount-import" className={`${dashMuted} hover:text-gray-300`}>
                이카운트 붙여넣기
              </Link>
            </div>
          </div>

          <div className="mt-3 mb-5 lg:mb-6">
            <p className={`${dashLabelXs} normal-case tracking-normal`}>총 생산량</p>
            <p className={`mt-1 ${dashHero} text-cyan-200/95`}>
              {totalProductionYtd != null ? num(totalProductionYtd) : "—"}
            </p>
          </div>

          <div className="space-y-3.5 flex-1 min-h-0">
            <div className="space-y-1.5">
              <div className="flex justify-between gap-2">
                <span className={dashMuted}>라이트 피자</span>
                <span className={`${dashSubMetric} text-slate-200`}>{y ? num(y.lightPizza) : "—"}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/45">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500/45 to-teal-400/30"
                  style={{ width: y ? barPct(y.lightPizza) : "0%" }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between gap-2">
                <span className={dashMuted}>헤비 피자</span>
                <span className={`${dashSubMetric} text-slate-200`}>{y ? num(y.heavyPizza) : "—"}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/45">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400/35 to-cyan-600/25"
                  style={{ width: y ? barPct(y.heavyPizza) : "0%" }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between gap-2">
                <span className={dashMuted}>브레드</span>
                <span className={`${dashSubMetric} text-slate-200`}>{y ? num(y.bread) : "—"}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/45">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal-400/40 to-cyan-500/28"
                  style={{ width: y ? barPct(y.bread) : "0%" }}
                />
              </div>
            </div>
            {y != null && y.other > 0 && (
              <div className={`flex justify-between gap-2 pt-0.5 ${dashMuted}`}>
                <span>기타 완제품</span>
                <span className="tabular-nums">{num(y.other)}</span>
              </div>
            )}
          </div>

          <ul className={`mt-4 space-y-2 border-t border-slate-700/50 pt-3 ${dashMuted}`}>
            <li className="flex justify-between gap-2">
              <span>파베이크 우주인(보관용)</span>
              <span className={`${dashSubMetric} text-gray-400`}>{y ? num(y.astronautParbake) : "—"}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span>파베이크 판매용</span>
              <span className={`${dashSubMetric} text-gray-400`}>{y ? num(y.saleParbake) : "—"}</span>
            </li>
          </ul>
        </section>

        <section className={`${dashCard} lg:col-span-5 lg:min-h-[300px]`}>
          <div className={`flex items-center justify-between gap-3 ${executiveTooltipHostRowClass}`}>
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className={dashTitle}>계획 대비 실적</h2>
              <span className="group relative inline-flex shrink-0">
                <button
                  type="button"
                  className="rounded p-0.5 text-cyan-500/80 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                  aria-label="계획 대비 실적 집계 기준 안내"
                >
                  <Info className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                </button>
                <span
                  role="tooltip"
                  className={`${executiveTooltipPanelClass} left-1/2 w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 md:left-0 md:translate-x-0`}
                >
                  {planDashboard ? `${planDashboard.year}년 ${planDashboard.month}월` : "—"} ·{" "}
                  {planDashboard?.planFromProcessedSheet ? "생산계획가공 시트" : "생산계획 시트"} vs 2차 마감 완제품
                  합계(품목별 합산과 동일 소스). 대분류는 피자·브레드·파베이크로 묶어 표시합니다.
                </span>
              </span>
            </div>
            <Link
              href="/executive/plan-actual"
              className="shrink-0 text-sm font-medium text-cyan-400 hover:text-cyan-300"
            >
              상세보기 →
            </Link>
          </div>

          <div className="mt-4 flex flex-1 flex-col gap-5 lg:gap-6 min-h-0 lg:min-h-[300px]">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:items-end sm:gap-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={dashLabelXs}>종합 달성률</p>
                  <span className="rounded-md border border-cyan-500/45 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.12)]">
                    이번 달 · {planDashboard?.month ?? calendarMonth.m}월
                  </span>
                </div>
                <p
                  className={`mt-1.5 ${dashHero} text-cyan-200 drop-shadow-[0_0_22px_rgba(34,211,238,0.18)]`}
                >
                  {pct(planDashboard?.achievementPct ?? null)}
                </p>
                <div className={`mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 ${dashMuted}`}>
                  <span>
                    목표:{" "}
                    <span className="tabular-nums font-semibold text-slate-300">
                      {planDashboard ? num(planDashboard.planTotal) : "—"}
                    </span>
                  </span>
                  <span className="hidden text-slate-600 sm:inline" aria-hidden>
                    |
                  </span>
                  <span>
                    현재:{" "}
                    <span className="tabular-nums font-semibold text-slate-300">
                      {planDashboard ? num(planDashboard.actualTotal) : "—"}
                    </span>
                  </span>
                </div>
              </div>
              <div className="min-w-0 overflow-visible sm:pl-1 sm:pb-0.5">
                <PlanActualYtdAchievementMiniBars
                  year={planDashboard?.year ?? calendarMonth.y}
                  currentMonth={planDashboard?.month ?? calendarMonth.m}
                  currentMonthAchievementPct={planDashboard?.achievementPct ?? null}
                  achievementPctByMonth={planSparklineAchievementByMonth}
                />
              </div>
            </div>

            <div className="mt-auto border-t border-slate-700/50 pt-4 sm:pt-5">
              <p className={`mb-4 text-center ${dashLabelXs}`}>대분류 달성률</p>
              <div className="grid grid-cols-3 gap-x-1 gap-y-2 sm:gap-x-3">
                <PlanActualCategoryMiniDonut
                  label="피자"
                  achievementPct={planDashboard?.buckets.pizza.achievementPct ?? null}
                  strokeGradientId={`${planActualMiniDonutGradId}-pz`}
                />
                <PlanActualCategoryMiniDonut
                  label="브레드"
                  achievementPct={planDashboard?.buckets.bread.achievementPct ?? null}
                  strokeGradientId={`${planActualMiniDonutGradId}-br`}
                />
                <PlanActualCategoryMiniDonut
                  label="파베이크"
                  achievementPct={planDashboard?.buckets.parbake.achievementPct ?? null}
                  strokeGradientId={`${planActualMiniDonutGradId}-pv`}
                />
              </div>
            </div>
          </div>
        </section>
        </div>

        {/* 태블릿 2열 · 데스크톱 3열 보조 KPI */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 lg:gap-6 lg:items-stretch">
        <section className={dashCard}>
          <div className={`flex items-center justify-between gap-3 ${executiveTooltipHostRowClass}`}>
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className={dashTitle}>인력 가동 현황</h2>
              <span className="group relative inline-flex shrink-0">
                <button
                  type="button"
                  className="rounded p-0.5 text-cyan-500/80 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                  aria-label="인력 가동·투입률 집계 기준 안내"
                >
                  <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                </button>
                <span
                  role="tooltip"
                  className={`${executiveTooltipPanelClass} left-1/2 w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 md:left-0 md:translate-x-0`}
                >
                  생산계획가공 시트 기준 · 총원 {DEFAULT_DASHBOARD_BASELINE_HEADCOUNT}명 대비 투입 인원 비율입니다.
                  같은 생산일에 여러 행이 있으면 투입 인원은 하루당 최댓값만 반영합니다.
                </span>
              </span>
            </div>
            {manpowerProductivityUnitsPerPersonDay != null && (
              <div
                className="flex min-h-9 max-w-[min(100%,15rem)] shrink-0 items-center gap-1.5 rounded-md border border-cyan-500/25 bg-slate-800/85 px-2.5 py-1.5 shadow-md shadow-black/20 sm:max-w-none sm:px-3"
                title="이번 달 완제품 합계·가동일·평균 투입 인원 기준"
              >
                <Zap className="h-4 w-4 shrink-0 text-cyan-400" strokeWidth={2.2} aria-hidden />
                <span className="text-left text-xs font-semibold leading-snug text-emerald-300/95">
                  1인당 생산성:{" "}
                  <span className="whitespace-nowrap tabular-nums text-cyan-200">
                    {Math.round(manpowerProductivityUnitsPerPersonDay).toLocaleString("ko-KR")}개/일
                  </span>
                </span>
              </div>
            )}
          </div>

          {manpower?.hasProcessedPlanData && manpower.avgDailyUtilizationPct != null ? (
            <div className="mt-4 flex flex-1 flex-col gap-0">
              <div>
                <p className={dashLabelXs}>이번 달 투입률</p>
                <p className={`mt-1.5 ${dashHero} text-cyan-200`}>{pct(manpower.avgDailyUtilizationPct)}</p>
                <div className="mt-4 h-3.5 w-full overflow-hidden rounded-full bg-slate-700/55">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-400/90 shadow-[0_0_12px_rgba(34,211,238,0.25)]"
                    style={{ width: utilizationBarWidth(manpower.avgDailyUtilizationPct) }}
                  />
                </div>
                <p className={`mt-2 text-right leading-snug ${dashMuted}`}>
                  (평균 {manpower.avgDailyManpower?.toFixed(1) ?? "—"}명 / 총원 {manpower.baselineHeadcount}명)
                </p>
              </div>

              <div className="mt-7 border-t border-slate-700/50 pt-6">
                <p className={dashLabelXs}>올해 평균 투입률</p>
                <p className={`mt-1.5 ${dashSubHero} text-cyan-200/95`}>
                  {pct(manpower.ytdAvgDailyUtilizationPct)}
                </p>
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-700/50">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500/85 to-cyan-400/65"
                    style={{ width: utilizationBarWidth(manpower.ytdAvgDailyUtilizationPct) }}
                  />
                </div>
                <p className={`mt-2 text-right leading-snug ${dashMuted}`}>
                  (평균 {manpower.ytdAvgDailyManpower?.toFixed(1) ?? "—"}명 / 총원 {manpower.baselineHeadcount}명)
                </p>
              </div>

              <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-700/50 pt-5">
                <span className="rounded-md border border-slate-600/40 bg-slate-800/55 px-2.5 py-1 text-xs tabular-nums text-gray-400">
                  이번 달 가동일 ({manpower.daysWithManpower}일)
                </span>
                <span className="rounded-md border border-slate-600/40 bg-slate-800/55 px-2.5 py-1 text-xs tabular-nums text-gray-400">
                  올해 누적 가동일 ({manpower.ytdOperatingDays}일)
                </span>
                {manpower.monthlyOperatingDays.length > 0 && (
                  <span className="group relative inline-flex shrink-0 items-center">
                    <button
                      type="button"
                      className="rounded p-0.5 text-gray-500 hover:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
                      aria-label="월별 가동일 상세"
                    >
                      <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    </button>
                    <span
                      role="tooltip"
                      className={`${executiveTooltipPanelClass} right-0 left-auto w-[min(18rem,calc(100vw-2rem))] md:left-auto md:right-0 md:translate-x-0`}
                    >
                      <span className="font-medium text-slate-100">월별 가동일</span>
                      <span className="mt-1.5 block text-slate-400">
                        {formatMonthlyOperatingDays(manpower.monthlyOperatingDays)}
                      </span>
                    </span>
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className={`mt-4 flex-1 ${dashMuted}`}>
              생산계획가공 데이터가 없습니다. 시트에서 동기화 API로 행을 넣으면 이 카드가 채워집니다.
            </p>
          )}
        </section>

        <section className={dashCard}>
          <div className={`flex items-center justify-between gap-3 ${executiveTooltipHostRowClass}`}>
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className={dashTitle}>폐기율 (올해 가중)</h2>
              <span className="group relative inline-flex shrink-0">
                <button
                  type="button"
                  className="rounded p-0.5 text-cyan-500/80 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                  aria-label="폐기율 집계 기준 안내"
                >
                  <Info className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                </button>
                <span
                  role="tooltip"
                  className={`${executiveTooltipPanelClass} left-1/2 w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 md:left-0 md:translate-x-0`}
                >
                  <span className="block">
                    도우·파베이크 폐기는 생산일지 계산과 동일합니다. 파베 분모는 수동 파베 생산 집계가 있으면 그
                    수치, 없으면 도우 사용량(또는 반죽량)입니다. 수동 JSONL이 있으면 표와 같은 병합값으로 집계합니다.
                  </span>
                  <span className="mt-2 block text-slate-400">
                    집계 일수 {w?.closedDayCount ?? 0}일 · Σ도우반죽 {w ? num(w.sumDoughMix) : "—"}
                  </span>
                </span>
              </span>
            </div>
            <Link
              href="/executive/waste"
              className="shrink-0 text-xs font-medium text-slate-500 transition-colors hover:text-slate-300"
            >
              상세보기
            </Link>
          </div>

          <ul className="mt-4 flex-1 space-y-4 text-slate-300">
            <li className="space-y-2">
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="min-w-0 text-sm text-slate-400">
                  <span className="font-medium text-slate-200">전체 폐기율</span>
                  <span className="mt-0.5 block text-[11px] font-normal text-slate-600">목표: 4% 미만</span>
                </div>
                <span
                  className={`shrink-0 ${dashHero} ${wasteRateToneClass(w?.overallDiscardRatePct ?? null)}`}
                >
                  {pct(w?.overallDiscardRatePct ?? null)}
                </span>
              </div>
              {wasteYoy?.periodEndDate && (
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs tabular-nums text-slate-500">
                  <span>
                    전년 동기{" "}
                    <span className="text-slate-400">
                      {wasteYoy.prevSamePeriodRate != null ? pct(wasteYoy.prevSamePeriodRate) : "—"}
                    </span>
                  </span>
                  <span className={wasteYoYDeltaToneClass(wasteYoy.deltaPctPoint)}>
                    {wasteYoy.deltaPctPoint != null ? formatDeltaPctPoint(wasteYoy.deltaPctPoint) : "—"}
                  </span>
                </div>
              )}
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/45">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ease-out ${wasteSubRateBarFillClass(w?.overallDiscardRatePct ?? null)}`}
                  style={{ width: wasteSubRateBarWidth(w?.overallDiscardRatePct ?? null) }}
                />
              </div>
            </li>
            <li className="space-y-1.5">
              <div className="flex justify-between gap-3">
                <span className={dashMuted}>도우 폐기율</span>
                <span
                  className={`shrink-0 ${dashSubMetric} ${wasteRateToneClass(w?.doughDiscardRatePct ?? null)}`}
                >
                  {pct(w?.doughDiscardRatePct ?? null)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/45">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ease-out ${wasteSubRateBarFillClass(w?.doughDiscardRatePct ?? null)}`}
                  style={{ width: wasteSubRateBarWidth(w?.doughDiscardRatePct ?? null) }}
                />
              </div>
            </li>
            <li className="space-y-1.5">
              <div className="flex justify-between gap-3">
                <span className={dashMuted}>파베이크 폐기율</span>
                <span
                  className={`shrink-0 ${dashSubMetric} ${wasteRateToneClass(w?.parbakeDiscardRatePct ?? null)}`}
                >
                  {pct(w?.parbakeDiscardRatePct ?? null)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/45">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ease-out ${wasteSubRateBarFillClass(w?.parbakeDiscardRatePct ?? null)}`}
                  style={{ width: wasteSubRateBarWidth(w?.parbakeDiscardRatePct ?? null) }}
                />
              </div>
            </li>
          </ul>
        </section>

        <section className={`${dashCard} md:col-span-2 lg:col-span-1`}>
          <div className={`mb-1 flex items-center justify-between gap-3 ${executiveTooltipHostRowClass}`}>
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className={dashTitle}>온·습도 (최근 7일)</h2>
              <span className="group relative inline-flex shrink-0">
                <button
                  type="button"
                  className="rounded p-0.5 text-cyan-500/80 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                  aria-label="온·습도 집계 기준 안내"
                >
                  <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                </button>
                <span
                  role="tooltip"
                  className={`${executiveTooltipPanelClass} left-1/2 w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 md:left-0 md:translate-x-0`}
                >
                  승인된 영업장 온습도 일지 기준 · 구역별 측정값을 합산한 최근 7일 평균입니다. 증감은 바로 이전
                  7일 구간 평균과 비교합니다.
                </span>
              </span>
            </div>
            <Link href="/executive/climate" className="shrink-0 text-sm font-medium text-cyan-400 hover:text-cyan-300">
              상세보기 →
            </Link>
          </div>

          {climateDashboardCard ? (
            <div className="mt-4 flex flex-1 flex-col">
              <div className="grid grid-cols-2 gap-4 md:gap-5">
                <div className="min-w-0 rounded-lg border border-slate-700/35 bg-slate-900/25 px-3 py-3 md:px-4 md:py-4">
                  <div className={`flex items-center gap-2 ${dashLabelXs}`}>
                    <Thermometer className="h-4 w-4 shrink-0 text-cyan-500/85" strokeWidth={2} aria-hidden />
                    <span>평균 온도</span>
                  </div>
                  <p className={`mt-2 ${dashSubHero} ${climateDashboardCard.tempHeroClass}`}>
                    {climateDashboardCard.c.overallAvgTemp != null
                      ? `${climateDashboardCard.c.overallAvgTemp.toFixed(1)}°C`
                      : "—"}
                  </p>
                  {climateDashboardCard.tempTrend && (
                    <p className={`mt-2 tabular-nums ${dashMuted}`}>
                      {climateDashboardCard.tempTrend}
                      <span className="ml-1 font-normal text-gray-600">· 직전 7일</span>
                    </p>
                  )}
                </div>
                <div className="min-w-0 rounded-lg border border-slate-700/35 bg-slate-900/25 px-3 py-3 md:px-4 md:py-4">
                  <div className={`flex items-center gap-2 ${dashLabelXs}`}>
                    <Droplets className="h-4 w-4 shrink-0 text-cyan-500/85" strokeWidth={2} aria-hidden />
                    <span>평균 습도</span>
                  </div>
                  <p
                    className={`mt-2 ${dashSubHero} text-cyan-200 drop-shadow-[0_0_18px_rgba(34,211,238,0.12)]`}
                  >
                    {climateDashboardCard.c.overallAvgHumidity != null
                      ? `${climateDashboardCard.c.overallAvgHumidity.toFixed(1)}%`
                      : "—"}
                  </p>
                  {climateDashboardCard.humTrend && (
                    <p className={`mt-2 tabular-nums ${dashMuted}`}>
                      {climateDashboardCard.humTrend}
                      <span className="ml-1 font-normal text-gray-600">· 직전 7일</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 border-t border-slate-700/45 pt-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className={`${dashLabelXs} font-medium normal-case tracking-normal`}>최고 온도 구역</p>
                    <span className="mt-1 inline-block rounded-md border border-slate-600/50 bg-slate-800/90 px-2.5 py-1 text-sm font-medium text-slate-200">
                      {climateDashboardCard.c.hottestZone ?? "—"}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 sm:text-right">
                    <p className={`${dashLabelXs} font-medium normal-case tracking-normal`}>최저 온도 구역</p>
                    <span className="mt-1 inline-block rounded-md border border-slate-600/50 bg-slate-800/90 px-2.5 py-1 text-sm font-medium text-slate-200 sm:ml-auto">
                      {climateDashboardCard.c.coolestZone ?? "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className={`mt-4 flex-1 ${dashMuted}`}>최근 7일 승인 일지가 없습니다.</p>
          )}
        </section>
        </div>

        <section className={`${dashCard} flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8`}>
          <div className="min-w-0 flex-1 space-y-4">
            <div className={`flex flex-wrap items-center gap-2 ${executiveTooltipHostRowClass}`}>
              <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden title="집계 구간 기준 모니터링">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/50 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]" />
              </span>
              <h2 className={dashTitle}>제조설비 점검</h2>
              <span className="group relative inline-flex shrink-0">
                <button
                  type="button"
                  className="rounded p-0.5 text-slate-500 hover:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
                  aria-label="제조설비 점검 집계 기준 안내"
                >
                  <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                </button>
                <span
                  role="tooltip"
                  className={`${executiveTooltipPanelClass} left-0 w-[min(19rem,calc(100vw-2rem))]`}
                >
                  승인된 제조설비 점검 일지 기준으로 최근 7일 구간의 부적합(X) 응답만 집계합니다.
                </span>
              </span>
            </div>

            {equipment == null && <p className={`font-medium ${dashMuted}`}>불러오는 중…</p>}
            {equipment && equipment.issueCount === 0 && (
              <div className="flex items-center gap-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/35 px-4 py-3.5 shadow-sm shadow-emerald-950/20 md:px-5 md:py-4">
                <CheckCircle2
                  className="h-9 w-9 shrink-0 text-emerald-400 md:h-10 md:w-10"
                  strokeWidth={2.25}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-lg font-bold leading-snug text-green-400">점검 이상 무</p>
                  <p className="mt-0.5 text-sm font-medium text-emerald-200/85">최근 7일 부적합 항목 없음</p>
                </div>
              </div>
            )}
            {equipment && equipment.issueCount > 0 && (
              <div className="flex items-center gap-3.5 rounded-xl border border-amber-500/35 bg-amber-950/25 px-4 py-3.5 md:px-5 md:py-4">
                <AlertTriangle
                  className="h-9 w-9 shrink-0 text-amber-400 md:h-10 md:w-10"
                  strokeWidth={2.25}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-lg font-bold leading-snug text-amber-100 md:text-xl">
                    부적합 <span className="tabular-nums">{equipment.issueCount}</span>건
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-amber-200/85">최근 7일 · 상세에서 내용을 확인하세요</p>
                </div>
              </div>
            )}
          </div>

          <Link
            href="/executive/equipment"
            className="shrink-0 self-start text-sm font-medium text-cyan-400 hover:text-cyan-300 sm:self-center"
          >
            상세보기 →
          </Link>
        </section>
      </div>

      <p className="text-slate-600 text-xs mt-8 leading-relaxed">
        제품 분류 키워드는 코드 설정(`src/features/dashboard/productCategoryRules.ts`)에서 관리합니다.
      </p>
    </div>
  );
}
