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
  wasteYoYCompareBadgeClass,
  wasteYoYCompareStatusFromDelta,
  wasteYoYCompareStatusLabel,
  wasteYoYDeltaPlainPhrase,
  wasteYoYSecondLineMeta,
  type ManualWasteImportSeries,
  type WasteYoySamePeriodResult,
  type WasteDetailMockDayRow,
} from "@/features/dashboard/wasteDetailMockData";
import {
  planActualSparklineWindowMonths,
} from "@/features/dashboard/planVsActual";
import {
  loadClimateDashboardWindowsForRange,
  loadEquipmentIssuesForRange,
} from "@/features/dashboard/climateAndEquipment";
import {
  loadExecutiveEquipmentSlotSnapshots,
  type ExecutiveEquipmentUnitSnapshot,
} from "@/features/equipment/executiveEquipmentHistory";
import {
  formatMonthlyOperatingDays,
} from "@/features/dashboard/manpowerUtilization";
import {
  getPlanningVsActualMetrics,
  type PlanningVsActualMetrics,
} from "@/features/dashboard/getPlanningVsActualMetrics";
import { getManpowerKpis, type ManpowerKpis } from "@/features/dashboard/getManpowerKpis";
import { AlertTriangle, CheckCircle2, Droplets, Info, LayoutDashboard, Thermometer } from "lucide-react";
import { ExecutivePortalTooltip } from "./ExecutivePortalTooltip";
import { executiveTooltipHostRowClass } from "./executiveTooltipStyles";
import type { ProductionBundle } from "@/features/dashboard/loadProductionBundle";
import type { ClimateDashboardWindows } from "@/features/dashboard/climateAndEquipment";
import { rollupYtdProduction } from "@/features/dashboard/aggregateProductionFromSnapshots";

type PeriodKey = "week" | "month" | "ytd";

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function mondayOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function equipmentDashboardUnitMeta(s: ExecutiveEquipmentUnitSnapshot): string {
  if (s.statusLabel === "이력 없음") return "고장 이력 없음 · 이력 등록 시 여기에 반영됩니다.";
  if (s.statusLabel === "진행 중") return "조치 진행 중 · 상세에서 최신 이력을 확인하세요.";
  if (s.daysWithoutFault != null && s.daysWithoutFault >= 30) return "운영중 노출 · 최근 30일 이내 신규 고장 없음";
  if (s.daysWithoutFault != null) return "운영중 노출 · 무고장 경과 30일 미만(점검 권장)";
  return "설비이력기록부 기준 집계";
}

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

function zeroValueToneClass(n: number): string {
  return n === 0 ? "text-slate-500" : "text-slate-200";
}

function zeroBarToneClass(n: number, normalClass: string): string {
  return n === 0 ? "bg-slate-700/25" : normalClass;
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

/** 데스크톱 넓은 대시보드용 공통 카드 셸 */
const dashCard =
  "overflow-visible rounded-xl border border-slate-700/60 bg-slate-800/50 p-5 md:p-6 lg:p-7 flex flex-col min-h-0 shadow-sm shadow-black/10";
/** 카드 제목 (18~20px) */
const dashTitle = "text-base sm:text-lg md:text-xl font-bold text-white tracking-tight";
/** 라벨·보조 제목 (13~14px) */
const dashLabel = "text-sm font-semibold tracking-wide text-slate-300";
/** 대장 수치 (44~48px) */
const dashHero =
  "text-[2.1rem] sm:text-[2.5rem] md:text-[3rem] font-extrabold tracking-tight tabular-nums leading-[1.05]";
/** 부대장 수치 */
const dashSubHero = "text-[1.45rem] sm:text-[1.65rem] md:text-[2rem] font-bold tabular-nums leading-tight";
/** 서브 지표 숫자 */
const dashSubMetric = "text-[15px] font-semibold tabular-nums";
/** 본문 라인(항목명 등) */
const dashMuted = "text-[15px] font-medium text-slate-300";
/** 보조 설명·메타 (13~15px, 가독성↑) */
const dashMutedMeta = "text-sm font-medium text-slate-300/95 leading-snug";
/** 캡션·보조 한 단계 낮음 */
const dashCaption = "text-sm font-medium text-slate-400 leading-snug";
/** 보조 링크 */
const dashAuxLink = "text-sm font-medium text-slate-400 transition-colors hover:text-slate-200";
/** 카드 헤더 우측 CTA */
const dashCardDetailLink =
  "shrink-0 inline-flex items-center rounded-md px-2 py-1.5 text-sm font-semibold text-cyan-400 transition-colors hover:text-cyan-300";

function PlanActualYtdAchievementMiniBars({
  year,
  currentMonth,
  currentMonthAchievementPct,
  achievementPctByMonth,
  title,
}: {
  year: number;
  currentMonth: number;
  currentMonthAchievementPct: number | null;
  /** 스파크라인 구간 내 월별 종합 달성률(상세·도넛과 동일 소스). 미래 월은 키 없음. */
  achievementPctByMonth: Record<number, number | null>;
  title: string;
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
      <p className={`mb-2 text-left ${dashLabel}`}>{title}</p>
      <div className="relative flex h-[4.75rem] items-end justify-between gap-1 overflow-visible sm:gap-1.5">
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
            <ExecutivePortalTooltip
              key={`${year}-${m}`}
              size="compact"
              gap={6}
              trigger={
                <div className="flex min-w-0 flex-1 cursor-default flex-col items-center gap-1 px-0.5">
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
                  <span className="text-sm tabular-nums text-slate-400">{m}월</span>
                </div>
              }
            >
              <span className={tooltipToneClass}>
                {year}년 {m}월 · {tipLabel}
                {exceptional ? (
                  <span className="ml-1.5 font-normal text-amber-300/95">110% 이상</span>
                ) : beatTarget ? (
                  <span className="ml-1.5 font-normal text-emerald-400/90">목표 달성</span>
                ) : null}
              </span>
            </ExecutivePortalTooltip>
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
          <span className="text-center text-sm font-semibold tabular-nums leading-tight text-cyan-100/95">
            {valid ? `${(achievementPct as number).toFixed(1)}%` : "—"}
          </span>
        </div>
      </div>
      <p className={`mt-2 text-center ${dashCaption}`}>{label}</p>
    </div>
  );
}

export default function ExecutiveDashboardPage() {
  const planActualMiniDonutGradId = useId().replace(/:/g, "");
  const router = useRouter();
  const { profile, viewOrganizationCode, loading: authLoading } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const canView = !!profile;

  const materials = useMasterStore((s) => s.materials);
  const bomList = useMasterStore((s) => s.bomList);
  const materialsLoading = useMasterStore((s) => s.materialsLoading);
  const bomLoading = useMasterStore((s) => s.bomLoading);
  const fetchMaterials = useMasterStore((s) => s.fetchMaterials);
  const fetchBom = useMasterStore((s) => s.fetchBom);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ProductionBundle | null>(null);
  const [planDashboard, setPlanDashboard] = useState<PlanningVsActualMetrics | null>(null);
  const [planSparklineAchievementByMonth, setPlanSparklineAchievementByMonth] = useState<Record<number, number | null>>({});
  const [climateWindows, setClimateWindows] = useState<ClimateDashboardWindows | null>(null);
  const [equipment, setEquipment] = useState<{
    issueCount: number;
    majorStats: { 화덕: ExecutiveEquipmentUnitSnapshot[]; 호이스트: ExecutiveEquipmentUnitSnapshot[] } | null;
  } | null>(null);
  const [manpower, setManpower] = useState<ManpowerKpis | null>(null);
  /** 수동 JSONL 병합 후 일자 행(상세 페이지와 동일 소스) */
  const [wasteMergedRows, setWasteMergedRows] = useState<WasteDetailMockDayRow[]>([]);
  const [wasteYoy, setWasteYoy] = useState<WasteYoySamePeriodResult | null>(null);
  const [periodKey, setPeriodKey] = useState<PeriodKey>("ytd");

  const clock = useMemo(() => new Date(), []);
  const [refYear, setRefYear] = useState(() => clock.getFullYear());
  const [refMonth, setRefMonth] = useState(() => clock.getMonth() + 1);

  const periodRange = useMemo(() => {
    const today = new Date();
    const ty = today.getFullYear();
    const tm = today.getMonth() + 1;
    const td = today.getDate();
    const todayStr = `${ty}-${pad2(tm)}-${pad2(td)}`;

    if (periodKey === "week") {
      return { start: toYmd(mondayOfWeek(today)), end: todayStr };
    }

    const monthStart = `${refYear}-${pad2(refMonth)}-01`;
    const ld = lastDayOfMonth(refYear, refMonth);
    const monthEnd = `${refYear}-${pad2(refMonth)}-${pad2(ld)}`;

    if (periodKey === "month") {
      const isCurrentMonth = refYear === ty && refMonth === tm;
      const end = isCurrentMonth ? todayStr : monthEnd;
      return { start: monthStart, end };
    }

    const yStart = `${refYear}-01-01`;
    const isCurrentRefMonth = refYear === ty && refMonth === tm;
    const end = isCurrentRefMonth ? todayStr : monthEnd;
    return { start: yStart, end };
  }, [periodKey, refYear, refMonth]);

  const periodLabel = useMemo(() => {
    const today = new Date();
    const ty = today.getFullYear();
    const tm = today.getMonth() + 1;
    const isRefCurrentMonth = refYear === ty && refMonth === tm;

    if (periodKey === "week") return "이번 주";
    if (periodKey === "month") {
      return isRefCurrentMonth ? "이번 달" : `${refYear}년 ${refMonth}월`;
    }
    if (isRefCurrentMonth) return "올해 누적";
    return `${refYear}년 1~${refMonth}월 누적`;
  }, [periodKey, refYear, refMonth]);

  /** 생산 번들·폐기 YoY 등 연도 기준 (주간은 항상 당해 연도) */
  const bundleYear = periodKey === "week" ? new Date().getFullYear() : refYear;

  /** 계획 스파크라인·baseline 월 기준 (주간은 당월 기준) */
  const metricsYm = useMemo(() => {
    if (periodKey === "week") {
      const d = new Date();
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    }
    return { y: refYear, m: refMonth };
  }, [periodKey, refYear, refMonth]);

  const headerDisplayYear = periodKey === "week" ? new Date().getFullYear() : refYear;

  const yearSelectOptions = useMemo(() => {
    const cy = new Date().getFullYear();
    const out: number[] = [];
    for (let y = cy - 2; y <= cy + 1; y++) out.push(y);
    return out;
  }, []);

  const wasteYoyCompareUi = useMemo(() => {
    if (periodKey !== "ytd") return null;
    if (!wasteYoy?.periodEndDate) return null;
    const status = wasteYoYCompareStatusFromDelta(wasteYoy.deltaPctPoint);
    const primaryPhrase = wasteYoYDeltaPlainPhrase(wasteYoy.deltaPctPoint);
    const secondLine = wasteYoYSecondLineMeta(wasteYoy.prevSamePeriodRate, wasteYoy.currentRate);
    if (!status && !primaryPhrase && !secondLine) return null;
    return { status, primaryPhrase, secondLine };
  }, [wasteYoy, periodKey]);

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
      const { bundle: b, error: be } = await loadProductionBundle(supabase, bundleYear, bomRefs, meta);
      if (cancelled) return;
      if (be) {
        setLoadError(be.message);
        setBundle(null);
        setPlanDashboard(null);
        setPlanSparklineAchievementByMonth({});
        setManpower(null);
        setWasteMergedRows([]);
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
            loadProductionBundle(supabase, bundleYear - 1, bomRefs, meta),
            fetchManual(bundleYear),
            fetchManual(bundleYear - 1),
          ]);
          if (cancelled) return;
          if (!b?.days) {
            setWasteMergedRows([]);
            setWasteYoy(null);
          } else {
            const rowsCur = mergeBundleDaysWithManualImportsForTable(b.days, mCur).rows;
            setWasteMergedRows(rowsCur);
            const rowsPrev = mergeBundleDaysWithManualImportsForTable(bPrev.bundle?.days ?? [], mPrev).rows;
            setWasteYoy(computeWasteYoySamePeriod(rowsCur, rowsPrev, bundleYear));
          }
        } catch {
          if (!cancelled) {
            setWasteMergedRows([]);
            setWasteYoy(null);
          }
        }
        const planMetrics = await getPlanningVsActualMetrics(supabase, {
          year: metricsYm.y,
          month: metricsYm.m,
          startDate: periodRange.start,
          endDate: periodRange.end,
          periodLabel,
          periodKey,
        });
        if (cancelled) return;
        setPlanSparklineAchievementByMonth(planMetrics.sparklineAchievementByMonth);
        setPlanDashboard(planMetrics);
        const mp = await getManpowerKpis(supabase, {
          year: metricsYm.y,
          month: metricsYm.m,
          startDate: periodRange.start,
          endDate: periodRange.end,
          periodLabel,
          periodActualTotal: planMetrics.actualTotal,
        });
        if (cancelled) return;
        setManpower(mp);
      }

      const cl = await loadClimateDashboardWindowsForRange(supabase, orgCode, periodRange.start, periodRange.end);
      const eq = await loadEquipmentIssuesForRange(supabase, orgCode, periodRange.start, periodRange.end);
      const majorStats = await loadExecutiveEquipmentSlotSnapshots(supabase, orgCode);
      if (cancelled) return;
      setClimateWindows(cl);
      setEquipment({ ...eq, majorStats });
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
    bundleYear,
    metricsYm.y,
    metricsYm.m,
    orgCode,
    periodRange.start,
    periodRange.end,
    periodLabel,
    periodKey,
  ]);

  if (authLoading || !profile) {
    return (
      <div className="min-h-[calc(100dvh-3.5rem)] flex items-center justify-center p-6">
        <p className="text-slate-500 text-sm">로딩 중…</p>
      </div>
    );
  }

  const periodDays = useMemo(() => {
    const days = bundle?.days ?? [];
    return days.filter((d) => d.date >= periodRange.start && d.date <= periodRange.end);
  }, [bundle?.days, periodRange.start, periodRange.end]);

  const y = useMemo(() => rollupYtdProduction(periodDays), [periodDays]);

  const periodWasteRows = useMemo(
    () => wasteMergedRows.filter((r) => r.date >= periodRange.start && r.date <= periodRange.end),
    [wasteMergedRows, periodRange.start, periodRange.end]
  );
  const w = useMemo(() => {
    if (periodWasteRows.length > 0) return rollupWasteMockFromDayRows(periodWasteRows);
    if (periodDays.length > 0) return rollupWasteMockFromDayRows(periodDays.map((d) => ({
      date: d.date,
      doughMixQty: d.doughMixQty,
      doughWasteQty: d.doughWasteQty,
      parbakeWasteQty: d.parbakeWasteQty,
      sameDayParbakeProductionQty: d.sameDayParbakeProductionQty,
      doughDiscardRatePct: null,
      parbakeDiscardRatePct: null,
      overallDiscardRatePct: null,
    })));
    return null;
  }, [periodWasteRows, periodDays]);

  const totalProductionYtd = y.lightPizza + y.heavyPizza + y.bread + y.other + y.astronautParbake + y.saleParbake;

  const mainBarMax = Math.max(y.lightPizza, y.heavyPizza, y.bread, 1);
  const barPct = (v: number) => `${Math.min(100, (v / mainBarMax) * 100)}%`;

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
        <div className="mb-2 flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-x-auto">
          <div className="flex shrink-0 items-center gap-2 text-cyan-400/90">
            <LayoutDashboard className="w-6 h-6 md:w-7 md:h-7" strokeWidth={1.8} />
            <span className="text-xs md:text-sm font-semibold uppercase tracking-wide">Dashboard</span>
          </div>
          <div className="flex min-w-0 shrink-0 flex-nowrap items-center gap-2 sm:gap-2.5">
            <div className="inline-flex shrink-0 items-center rounded-lg border border-slate-700/70 bg-slate-900/60 p-0.5">
              {([
                ["week", "이번 주"],
                ["month", "이번 달"],
                ["ytd", "올해 누적"],
              ] as const).map(([key, label]) => {
                const active = periodKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPeriodKey(key)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      active ? "bg-cyan-500/20 text-cyan-200" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div
              className="flex shrink-0 items-center gap-1.5"
              title={
                periodKey === "week"
                  ? "주간 보기는 항상 이번 주(월요일~오늘) 기준이며, 기준 연·월 선택은 월/누적 보기에만 적용됩니다."
                  : undefined
              }
            >
              <label htmlFor="exec-ref-year" className="sr-only">
                기준 연도
              </label>
              <select
                id="exec-ref-year"
                value={refYear}
                onChange={(e) => setRefYear(Number(e.target.value))}
                className="max-w-[5.5rem] cursor-pointer rounded-md border border-slate-600/60 bg-slate-900/85 py-1 pl-2 pr-8 text-xs font-medium text-slate-200 focus:border-cyan-500/45 focus:outline-none focus:ring-1 focus:ring-cyan-500/25"
              >
                {yearSelectOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
              <label htmlFor="exec-ref-month" className="sr-only">
                기준 월
              </label>
              <select
                id="exec-ref-month"
                value={refMonth}
                onChange={(e) => setRefMonth(Number(e.target.value))}
                className="max-w-[4.25rem] cursor-pointer rounded-md border border-slate-600/60 bg-slate-900/85 py-1 pl-2 pr-8 text-xs font-medium text-slate-200 focus:border-cyan-500/45 focus:outline-none focus:ring-1 focus:ring-cyan-500/25"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
            </div>
            {periodKey === "week" ? (
              <span className="hidden text-[10px] font-medium text-slate-500 lg:inline whitespace-nowrap">
                주간은 당주만
              </span>
            ) : null}
          </div>
        </div>
        <h1 className="text-2xl md:text-3xl lg:text-4xl font-semibold text-slate-100 tracking-tight">
          대시보드
        </h1>
        <p className="text-slate-400 text-sm md:text-base mt-2 md:mt-3 max-w-4xl leading-relaxed font-medium">
          {headerDisplayYear}년 생산·계획·폐기·환경 지표를 한 화면에서 확인합니다. 현재 표시 기준은 {periodLabel}입니다.
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
              <h2 className={dashTitle}>생산량 ({periodLabel})</h2>
              <ExecutivePortalTooltip
                trigger={
                  <button
                    type="button"
                    className="rounded p-0.5 text-cyan-500/80 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                    aria-label="생산량 집계 안내"
                  >
                    <Info className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                  </button>
                }
              >
                <span className="block">
                  {periodLabel} 구간의 생산량입니다. 일별 생산기록을 기준으로 집계했으며, 일부 누락 구간은 생산실적
                  자료를 반영했습니다.
                </span>
                <span className="mt-2 block text-slate-300">상세 페이지에서 일자별 기준을 확인할 수 있습니다.</span>
              </ExecutivePortalTooltip>
            </div>
            <div className="flex min-w-0 flex-col items-start gap-1 text-left sm:items-end sm:text-right">
              <Link href="/executive/production" className={dashCardDetailLink}>
                상세보기 →
              </Link>
              <Link href="/executive/ecount-import" className={dashAuxLink}>
                이카운트 붙여넣기
              </Link>
            </div>
          </div>

          <div className="mt-3 mb-5 lg:mb-6">
            <p className={`${dashLabel} normal-case tracking-normal`}>총 생산량</p>
            <p className={`mt-1 ${dashHero} text-cyan-200/95`}>
              {num(totalProductionYtd)}
            </p>
          </div>

          <div className="space-y-3.5 flex-1 min-h-0">
            <div className="space-y-1.5">
              <div className="flex justify-between gap-2">
                <span className={dashMuted}>라이트 피자</span>
                <span className={`${dashSubMetric} ${zeroValueToneClass(y.lightPizza)}`}>{num(y.lightPizza)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/45">
                <div
                  className={`h-full rounded-full ${zeroBarToneClass(
                    y.lightPizza,
                    "bg-gradient-to-r from-cyan-500/45 to-teal-400/30"
                  )}`}
                  style={{ width: barPct(y.lightPizza) }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between gap-2">
                <span className={dashMuted}>헤비 피자</span>
                <span className={`${dashSubMetric} ${zeroValueToneClass(y.heavyPizza)}`}>{num(y.heavyPizza)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/45">
                <div
                  className={`h-full rounded-full ${zeroBarToneClass(
                    y.heavyPizza,
                    "bg-gradient-to-r from-cyan-400/35 to-cyan-600/25"
                  )}`}
                  style={{ width: barPct(y.heavyPizza) }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between gap-2">
                <span className={dashMuted}>브레드</span>
                <span className={`${dashSubMetric} ${zeroValueToneClass(y.bread)}`}>{num(y.bread)}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/45">
                <div
                  className={`h-full rounded-full ${zeroBarToneClass(
                    y.bread,
                    "bg-gradient-to-r from-teal-400/40 to-cyan-500/28"
                  )}`}
                  style={{ width: barPct(y.bread) }}
                />
              </div>
            </div>
            {y.other > 0 && (
              <div className={`flex justify-between gap-2 pt-0.5 ${dashMuted}`}>
                <span>기타 완제품</span>
                <span className="tabular-nums">{num(y.other)}</span>
              </div>
            )}
          </div>

          <ul className={`mt-4 space-y-2 border-t border-slate-700/50 pt-3 ${dashMutedMeta}`}>
            <li className="flex justify-between gap-2">
              <span>파베이크 우주인(보관용)</span>
              <span className={`${dashSubMetric} ${y.astronautParbake === 0 ? "text-slate-500" : "text-slate-300"}`}>
                {num(y.astronautParbake)}
              </span>
            </li>
            <li className="flex justify-between gap-2">
              <span>파베이크 판매용</span>
              <span className={`${dashSubMetric} ${y.saleParbake === 0 ? "text-slate-500" : "text-slate-300"}`}>
                {num(y.saleParbake)}
              </span>
            </li>
          </ul>
        </section>

        <section className={`${dashCard} lg:col-span-5 lg:min-h-[300px]`}>
          <div className={`flex items-center justify-between gap-3 ${executiveTooltipHostRowClass}`}>
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className={dashTitle}>계획 대비 실적</h2>
              <span className="rounded border border-slate-600/55 bg-slate-800/55 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                {periodLabel} 기준
              </span>
              <ExecutivePortalTooltip
                trigger={
                  <button
                    type="button"
                    className="rounded p-0.5 text-cyan-500/80 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                    aria-label="계획 대비 실적 안내"
                  >
                    <Info className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                  </button>
                }
              >
                선택한 기간의 계획 대비 생산실적입니다. 추이와 품목군별 달성률을 함께 보여줍니다.
              </ExecutivePortalTooltip>
            </div>
            <Link href="/executive/plan-actual" className={dashCardDetailLink}>
              상세보기 →
            </Link>
          </div>

          <div className="mt-4 flex flex-1 flex-col gap-5 lg:gap-6 min-h-0 lg:min-h-[300px]">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:items-end sm:gap-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={dashLabel}>종합 달성률</p>
                  <span className="rounded-md border border-cyan-500/45 bg-cyan-500/10 px-2 py-0.5 text-xs sm:text-sm font-bold tracking-wide text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.12)]">
                    {periodLabel}
                  </span>
                </div>
                <p
                  className={`mt-1.5 ${dashHero} text-cyan-200 drop-shadow-[0_0_22px_rgba(34,211,238,0.18)]`}
                >
                  {pct(planDashboard?.achievementPct ?? null)}
                </p>
                <div className={`mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 ${dashMutedMeta}`}>
                  <span>
                    목표:{" "}
                    <span className="tabular-nums font-semibold text-slate-200">
                      {planDashboard ? num(planDashboard.planTotal) : "—"}
                    </span>
                  </span>
                  <span className="hidden text-slate-500 sm:inline" aria-hidden>
                    |
                  </span>
                  <span>
                    현재:{" "}
                    <span className="tabular-nums font-semibold text-slate-200">
                      {planDashboard ? num(planDashboard.actualTotal) : "—"}
                    </span>
                  </span>
                </div>
              </div>
              <div className="min-w-0 overflow-visible sm:pl-1 sm:pb-0.5">
                <PlanActualYtdAchievementMiniBars
                  year={planDashboard?.year ?? metricsYm.y}
                  currentMonth={planDashboard?.month ?? metricsYm.m}
                  currentMonthAchievementPct={planDashboard?.achievementPct ?? null}
                  achievementPctByMonth={planSparklineAchievementByMonth}
                  title="올해 월별 달성 추이"
                />
              </div>
            </div>

            <div className="mt-auto border-t border-slate-700/50 pt-4 sm:pt-5">
              <p className={`mb-4 text-center ${dashLabel}`}>대분류 달성률</p>
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
          <div className={`flex items-start justify-between gap-4 ${executiveTooltipHostRowClass}`}>
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className={dashTitle}>인력 가동 현황</h2>
              <span className="rounded border border-slate-600/55 bg-slate-800/55 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                {periodLabel} 기준
              </span>
              <ExecutivePortalTooltip
                trigger={
                  <button
                    type="button"
                    className="rounded p-0.5 text-slate-400 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
                    aria-label="인력 가동 안내"
                  >
                    <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  </button>
                }
              >
                선택한 기간의 평균 투입 인원을 기준 총원(baseline headcount)과 비교한 수치입니다. 참고 인원 수는 회사코드
                100~199 소속이면서 worker·준매니저·매니저 역할만 집계합니다. 생산성은 1인당 하루 평균 생산량입니다.
              </ExecutivePortalTooltip>
            </div>
            {manpower?.productivityPerPersonDay != null && (
              <p
                className={`shrink-0 text-right ${dashMutedMeta} tabular-nums`}
                title={`${periodLabel} 완제품 합계·가동일·평균 투입 인원 기준`}
              >
                생산성{" "}
                <span className="text-slate-300">
                  {Math.round(manpower.productivityPerPersonDay).toLocaleString("ko-KR")}개/인·일
                </span>
              </p>
            )}
          </div>

          {manpower?.hasData && manpower.avgUtilizationThisMonth != null ? (
            <div className="mt-6 flex flex-1 flex-col">
              {(() => {
                const monthU = manpower.avgUtilizationThisMonth;
                const ytdU = manpower.yearlyAvgUtilization;
                const deltaUtilVsYtd =
                  monthU != null &&
                  ytdU != null &&
                  Number.isFinite(monthU) &&
                  Number.isFinite(ytdU)
                    ? monthU - ytdU
                    : null;
                const compareLabel =
                  periodKey === "ytd" ? "기준 평균 대비" : "직전 동일기간 대비";
                const compareBaseLabel =
                  periodKey === "ytd" ? "기준 평균" : "직전 동일기간 평균";
                return (
                  <>
                    <p className={dashLabel}>{periodLabel} 평균 투입률</p>
                    <p className={`mt-2 ${dashHero} text-cyan-200/95`}>{pct(monthU)}</p>
                    {deltaUtilVsYtd != null && ytdU != null ? (
                      <p className={`mt-2 ${dashMutedMeta} leading-relaxed tabular-nums`}>
                        {compareLabel}{" "}
                        <span className="text-slate-300">{formatDeltaPctPoint(deltaUtilVsYtd)}</span>
                      </p>
                    ) : ytdU != null ? (
                      <p className={`mt-2 ${dashMutedMeta}`}>
                        {compareBaseLabel} <span className="tabular-nums text-slate-300">{pct(ytdU)}</span>
                      </p>
                    ) : null}
                    <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-slate-700/45">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-500/85 to-teal-400/70"
                        style={{ width: utilizationBarWidth(monthU) }}
                      />
                    </div>

                    <div className={`mt-8 border-t border-slate-700/35 pt-5 ${dashMutedMeta} leading-relaxed`}>
                      <p className="tabular-nums">
                        평균 투입 인원 {manpower.avgActualManpowerThisMonth?.toFixed(1) ?? "—"}명 · 기준 총원{" "}
                        {manpower.baselineHeadcount}명
                        <span className="text-slate-500"> (현장 인원 집계 {manpower.totalMembers}명)</span>
                      </p>
                      <p className="mt-2 flex flex-wrap items-center gap-x-1 tabular-nums text-slate-400">
                        <span>
                          가동일 {periodLabel} {manpower.operatingDaysThisMonth}일 · 연누적 {manpower.operatingDaysYearToDate}일
                        </span>
                        {manpower.monthlyOperatingDays.length > 0 && (
                          <ExecutivePortalTooltip
                            trigger={
                              <button
                                type="button"
                                className="ml-0.5 rounded p-0.5 text-slate-500 hover:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/35"
                                aria-label="월별 가동일 상세"
                              >
                                <Info className="h-3 w-3" strokeWidth={2} aria-hidden />
                              </button>
                            }
                          >
                            <span className="font-medium text-slate-100">월별 가동일</span>
                            <span className="mt-1.5 block text-slate-300">
                              {formatMonthlyOperatingDays(manpower.monthlyOperatingDays)}
                            </span>
                          </ExecutivePortalTooltip>
                        )}
                      </p>
                    </div>
                  </>
                );
              })()}
            </div>
          ) : (
            <p className={`mt-6 flex-1 ${dashMutedMeta}`}>
              생산계획 데이터가 없습니다. 계획이 등록되면 이 카드가 채워집니다.
            </p>
          )}
        </section>

        <section className={dashCard}>
          <div className={`flex items-center justify-between gap-3 ${executiveTooltipHostRowClass}`}>
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className={dashTitle}>폐기율 ({periodLabel})</h2>
              <ExecutivePortalTooltip
                trigger={
                  <button
                    type="button"
                    className="rounded p-0.5 text-cyan-500/80 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                    aria-label="폐기율 안내"
                  >
                    <Info className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                  </button>
                }
              >
                <span className="block">
                  도우와 파베이크 공정의 폐기율을 합계 기반 비율(가중)로 집계한 값입니다. 전년 같은 기간과 비교해
                  개선 여부를 확인할 수 있습니다.
                </span>
                <span className="mt-2 block text-slate-300">
                  생산수량 대비 폐기수량 기준으로 계산했으며, 누락된 기록은 별도 생산기록으로 보완했습니다.
                </span>
              </ExecutivePortalTooltip>
            </div>
            <Link href={`/executive/waste?period=${periodKey}`} className={dashCardDetailLink}>
              상세보기 →
            </Link>
          </div>

          <ul className="mt-4 flex-1 space-y-4 text-slate-300">
            <li className="space-y-2">
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="min-w-0 text-sm text-slate-300">
                  <span className="font-medium text-slate-100">전체 폐기율</span>
                  <span className={`mt-0.5 block ${dashCaption}`}>목표: 4% 미만</span>
                </div>
                <span
                  className={`shrink-0 ${dashHero} ${wasteRateToneClass(w?.overallDiscardRatePct ?? null)}`}
                >
                  {pct(w?.overallDiscardRatePct ?? null)}
                </span>
              </div>
              {wasteYoyCompareUi && (
                <div className="mt-1.5 space-y-1">
                  {(wasteYoyCompareUi.status || wasteYoyCompareUi.primaryPhrase) && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {wasteYoyCompareUi.status && wasteYoyCompareUi.status !== "about_same" ? (
                        <span
                          className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-xs sm:text-sm font-semibold tabular-nums leading-tight ${wasteYoYCompareBadgeClass(wasteYoyCompareUi.status)}`}
                        >
                          {wasteYoYCompareStatusLabel(wasteYoyCompareUi.status)}
                        </span>
                      ) : null}
                      {wasteYoyCompareUi.primaryPhrase ? (
                        <span className={`min-w-0 ${dashMutedMeta} tabular-nums`}>
                          {wasteYoyCompareUi.primaryPhrase}
                        </span>
                      ) : null}
                    </div>
                  )}
                  {wasteYoyCompareUi.secondLine ? (
                    <p className={`${dashCaption} leading-snug tabular-nums`}>
                      {wasteYoyCompareUi.secondLine}
                    </p>
                  ) : null}
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
              <h2 className={dashTitle}>온·습도 ({periodLabel})</h2>
              <ExecutivePortalTooltip
                trigger={
                  <button
                    type="button"
                    className="rounded p-0.5 text-cyan-500/80 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                    aria-label="온·습도 안내"
                  >
                    <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  </button>
                }
              >
                {periodLabel} 온·습도 점검 결과의 평균값입니다. 증감은 직전 동일기간과 비교한 값입니다.
              </ExecutivePortalTooltip>
            </div>
            <Link href="/executive/climate" className={dashCardDetailLink}>
              상세보기 →
            </Link>
          </div>

          {climateDashboardCard ? (
            <div className="mt-4 flex flex-1 flex-col">
              <div className="grid grid-cols-2 gap-4 md:gap-5">
                <div className="min-w-0 rounded-lg border border-slate-700/35 bg-slate-900/25 px-3 py-3 md:px-4 md:py-4">
                  <div className={`flex items-center gap-2 ${dashLabel}`}>
                    <Thermometer className="h-4 w-4 shrink-0 text-cyan-500/85" strokeWidth={2} aria-hidden />
                    <span>평균 온도</span>
                  </div>
                  <p className={`mt-2 ${dashSubHero} ${climateDashboardCard.tempHeroClass}`}>
                    {climateDashboardCard.c.overallAvgTemp != null
                      ? `${climateDashboardCard.c.overallAvgTemp.toFixed(1)}°C`
                      : "—"}
                  </p>
                  {climateDashboardCard.tempTrend && (
                    <p className={`mt-2 tabular-nums ${dashMutedMeta}`}>
                      {climateDashboardCard.tempTrend}
                      <span className="ml-1 font-normal text-slate-500">· 직전 동일기간</span>
                    </p>
                  )}
                </div>
                <div className="min-w-0 rounded-lg border border-slate-700/35 bg-slate-900/25 px-3 py-3 md:px-4 md:py-4">
                  <div className={`flex items-center gap-2 ${dashLabel}`}>
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
                    <p className={`mt-2 tabular-nums ${dashMutedMeta}`}>
                      {climateDashboardCard.humTrend}
                      <span className="ml-1 font-normal text-slate-500">· 직전 동일기간</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 border-t border-slate-700/45 pt-4">
                <p className={`mb-3 ${dashCaption}`}>
                  {`${periodLabel} 환경 평균 기준`}
                </p>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className={`${dashLabel} font-medium normal-case tracking-normal`}>최고 온도 구역</p>
                    <span className="mt-1 inline-block rounded-md border border-slate-600/50 bg-slate-800/90 px-2.5 py-1 text-sm font-medium text-slate-200">
                      {climateDashboardCard.c.hottestZone ?? "—"}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 sm:text-right">
                    <p className={`${dashLabel} font-medium normal-case tracking-normal`}>최저 온도 구역</p>
                    <span className="mt-1 inline-block rounded-md border border-slate-600/50 bg-slate-800/90 px-2.5 py-1 text-sm font-medium text-slate-200 sm:ml-auto">
                      {climateDashboardCard.c.coolestZone ?? "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className={`mt-4 flex-1 ${dashMutedMeta}`}>최근 7일 점검 기록이 없습니다.</p>
          )}
        </section>
        </div>

        <section className={`${dashCard} flex flex-col gap-4 md:gap-5`}>
          {/* 1) 헤더: 제목 + 액션 */}
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between xl:gap-4">
            <div className={`flex flex-wrap items-center gap-2 min-w-0 ${executiveTooltipHostRowClass}`}>
              <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden title="집계 구간 기준 모니터링">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/50 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]" />
              </span>
              <h2 className={dashTitle}>제조설비 점검</h2>
              <span className="rounded border border-slate-600/55 bg-slate-800/55 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                점검 요약 {periodLabel}
              </span>
              <ExecutivePortalTooltip
                trigger={
                  <button
                    type="button"
                    className="rounded p-0.5 text-slate-400 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
                    aria-label="제조설비 점검 안내"
                  >
                    <Info className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  </button>
                }
              >
                최근 7일 설비 점검 결과입니다. 부적합 항목이 없으면 ‘점검 이상 무’로 표시됩니다. 아래 주요 설비 이력은 마스터의 대시보드 그룹·운영 상태·노출 설정을 기준으로 한 개별 설비(설비이력기록부)입니다.
              </ExecutivePortalTooltip>
            </div>
            <div className="flex shrink-0 justify-end">
              <Link href="/executive/equipment" className={`${dashCardDetailLink} whitespace-nowrap`}>
                상세보기 →
              </Link>
            </div>
          </div>

          {equipment == null && <p className={dashMutedMeta}>불러오는 중…</p>}

          {/* 2) 상태 배너 (간결) */}
          {equipment && equipment.issueCount === 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-2.5 shadow-sm shadow-emerald-950/15">
              <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-400" strokeWidth={2.25} aria-hidden />
              <div className="min-w-0">
                <p className="text-base font-bold leading-tight text-emerald-200">점검 이상 무</p>
                <p className={`mt-0.5 ${dashCaption} text-emerald-200/90`}>{periodLabel} 부적합 항목 없음</p>
              </div>
            </div>
          )}
          {equipment && equipment.issueCount > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-amber-500/35 bg-amber-950/20 px-3 py-2.5">
              <AlertTriangle className="h-7 w-7 shrink-0 text-amber-400" strokeWidth={2.25} aria-hidden />
              <div className="min-w-0">
                <p className="text-base font-bold leading-tight text-amber-100">
                  부적합 <span className="tabular-nums">{equipment.issueCount}</span>건
                </p>
                <p className={`mt-0.5 ${dashCaption} text-amber-200/90`}>
                  {periodLabel} · 상세에서 내용을 확인하세요
                </p>
              </div>
            </div>
          )}

          {/* 3) 주요 설비 — 화덕/호이스트 2열 */}
          {equipment?.majorStats && (
            <div className="min-w-0 space-y-3">
              <div>
                <p className={dashLabel}>주요 설비 이력</p>
                <p className={`mt-1 ${dashCaption}`}>
                  설비이력기록부 · 대시보드 그룹·노출·운영중/예비로 지정된 개별 설비
                </p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">
                {(["화덕", "호이스트"] as const).map((name) => {
                  const units = equipment.majorStats![name];
                  return (
                    <div
                      key={name}
                      className="min-w-0 rounded-xl border border-slate-700/50 bg-slate-900/30 p-4 md:p-5 flex flex-col"
                    >
                      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-700/40 pb-2">
                        <h3 className="text-base md:text-lg font-bold text-slate-100">{name}</h3>
                        <span className={dashMutedMeta}>
                          {units.length > 0 ? `운영중 ${units.length}대` : "표시할 설비 없음"}
                        </span>
                      </div>
                      {units.length === 0 ? (
                        <p className={dashCaption}>
                          제조설비등록에서 `{name}` 그룹·대시보드 노출을 설정한 설비가 없습니다.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-3">
                          {units.map((s) => {
                            const days = s.daysWithoutFault;
                            const lastStr = s.lastFaultOrStopAt ?? "—";
                            const hi = s.recentHighImpact;
                            const st = s.statusLabel;
                            const tone =
                              days == null ? "stable" : days >= 90 ? "stable" : days >= 30 ? "warn" : "danger";
                            const numClass =
                              tone === "stable"
                                ? "text-emerald-300"
                                : tone === "warn"
                                  ? "text-amber-300"
                                  : "text-red-400";
                            const borderClass =
                              hi
                                ? "border-amber-500/40 bg-amber-950/20"
                                : tone === "stable"
                                  ? "border-emerald-500/25 bg-emerald-950/10"
                                  : tone === "warn"
                                    ? "border-amber-500/30 bg-amber-950/15"
                                    : "border-red-500/25 bg-red-950/15";
                            return (
                              <div
                                key={`${name}-${s.masterId ?? s.displayTitle}`}
                                className={`rounded-lg border px-4 py-3.5 ${borderClass} flex flex-col`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <h4
                                    className="min-w-0 text-base md:text-lg font-semibold leading-snug text-slate-100 line-clamp-2"
                                    title={s.displayTitle}
                                  >
                                    {s.displayTitle}
                                  </h4>
                                  {hi && (
                                    <span className="shrink-0 rounded border border-amber-500/35 bg-amber-950/40 px-2 py-0.5 text-xs font-semibold text-amber-100 leading-tight text-right max-w-[10rem]">
                                      생산영향·고장/가동중지 주의
                                    </span>
                                  )}
                                </div>
                                <p className={`mt-3 ${dashLabel}`}>무고장 경과일</p>
                                <p className={`mt-1 ${dashHero} ${numClass}`}>
                                  {days != null ? `${days}일` : "—"}
                                </p>
                                <div className={`mt-3 space-y-2 ${dashMutedMeta}`}>
                                  <p>
                                    <span className="font-semibold text-slate-400">현재 상태</span>{" "}
                                    <span
                                      className={
                                        st === "진행 중"
                                          ? "font-semibold text-amber-200"
                                          : st === "조치 완료"
                                            ? "font-semibold text-emerald-300"
                                            : "font-semibold text-slate-300"
                                      }
                                    >
                                      {st}
                                    </span>
                                  </p>
                                  <p>
                                    <span className="font-semibold text-slate-400">마지막 고장/중지</span>{" "}
                                    <span className="font-semibold tabular-nums text-slate-100">{lastStr}</span>
                                  </p>
                                </div>
                                <p className={`mt-3 border-t border-slate-700/45 pt-3 ${dashCaption}`}>
                                  {equipmentDashboardUnitMeta(s)}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>

    </div>
  );
}
