"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Plus, Printer, RefreshCw, Trash2, Users } from "lucide-react";
import {
  DEFAULT_CATALOG,
  buildGroupReadiness,
  copyProductGroup,
  getPriority,
  heatingPositions,
  newPositionId,
  rankTakenBy,
  setPriority,
  setPriorityUnique,
  type GroupReadiness,
} from "@/features/production/rotation/catalog";
import { fetchRotationDay, fetchRotationMaster, saveRotationDay, saveRotationMaster } from "@/features/production/rotation/clientApi";
import {
  HOURLY_QTY,
  PRODUCT_GROUPS,
  PRODUCT_LINES,
  productGroup,
} from "@/features/production/rotation/seedRoster";
import { applyPlanningLeaveItems, isAvailableInPeriod, isFullDayLeave, leaveKindLabel, type PlanningLeaveItem } from "@/features/production/rotation/planningLeave";
import { rotationLineLabel, type PlannedRotationProduct } from "@/features/production/rotation/mapPlanProducts";
import {
  buildChecks,
  canAssign,
  generateRotation,
  heatingTarget,
  movePerson,
  peopleOn,
  priorityLabel,
  processLabel,
} from "@/features/production/rotation/rotationEngine";
import {
  PERIODS,
  PRIORITY_OPTIONS,
  PROCESSES,
  type PeriodAssignments,
  type PeriodId,
  type Person,
  type PositionCatalog,
  type PositionDef,
  type Priority,
  type ProcessId,
  type ProductGroup,
  type ProductLine,
  type RotationModes,
  type RotationWarning,
  type SkillMatrix,
  type StationId,
} from "@/features/production/rotation/types";

const PROCESS_TONE: Record<string, string> = {
  heating: "border-amber-700/60 bg-amber-950/40",
  inner: "border-cyan-700/50 bg-cyan-950/30",
  outer: "border-sky-700/50 bg-sky-950/30",
  topping: "border-emerald-700/50 bg-emerald-950/30",
  dough: "border-violet-700/50 bg-violet-950/30",
  cleanup: "border-violet-700/50 bg-violet-950/30",
  rnd: "border-slate-600/60 bg-slate-800/60",
  office: "border-slate-600/60 bg-slate-800/50",
  lunch: "border-yellow-600/70 bg-yellow-400 text-slate-900",
  off: "border-slate-600/60 bg-slate-800/70",
  unassigned: "border-rose-700/50 bg-rose-950/30",
};

const PRIORITY_CELL: Record<Priority, string> = {
  0: "bg-slate-900 text-slate-500",
  1: "bg-cyan-950 text-cyan-200",
  2: "bg-slate-800 text-slate-200",
  3: "bg-amber-950 text-amber-200",
  4: "bg-orange-950 text-orange-200",
  5: "bg-rose-950 text-rose-200",
};

function todayStr() {
  const d = new Date();
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

function weekdayKo(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00`);
  return ["일", "월", "화", "수", "목", "금", "토"][d.getDay()] ?? "";
}

function warnGroups(warnings: RotationWarning[]) {
  const order = ["unfilled", "lunchCoverage", "emergency", "rank4", "rank3", "preferredLeave", "other"] as const;
  return order
    .map((kind) => ({ kind, items: warnings.filter((w) => w.kind === kind) }))
    .filter((g) => g.items.length > 0);
}

const WARN_TITLE: Record<string, string> = {
  unfilled: "배치 실패",
  lunchCoverage: "점심조 커버 불가",
  emergency: "비상 투입",
  rank4: "4순위 사용",
  rank3: "3순위 사용",
  preferredLeave: "주공정 이탈",
  other: "참고",
};

function LeaveSummaryPanel(props: { items: PlanningLeaveItem[]; unmatched: string[] }) {
  const groups: { key: PlanningLeaveItem["kind"]; label: string }[] = [
    { key: "annual", label: "연차" },
    { key: "half_am", label: "반차(오전출근)" },
    { key: "half_pm", label: "반차(오후출근)" },
    { key: "half", label: "반차" },
    { key: "other", label: "기타" },
  ];
  return (
    <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2">
      <p className="text-[11px] text-amber-200/80 mb-1.5">생산계획 연차·반차</p>
      {props.items.length === 0 ? (
        <p className="text-xs text-slate-400">이날 등록된 연차·반차·기타가 없습니다.</p>
      ) : (
        <ul className="space-y-1">
          {groups.map((g) => {
            const rows = props.items.filter((i) => i.kind === g.key);
            if (rows.length === 0) return null;
            return (
              <li key={g.key} className="text-xs text-slate-200">
                <span className="text-amber-200">{g.label}</span>
                <span className="text-slate-500"> {rows.length}명 · </span>
                {rows.map((r) => `${r.name}${r.detail ? `(${r.detail})` : ""}`).join(", ")}
              </li>
            );
          })}
        </ul>
      )}
      {props.unmatched.length > 0 && (
        <p className="mt-1.5 text-[11px] text-amber-200">
          명단과 이름이 안 맞는 사람: {props.unmatched.join(", ")} (배치에는 빠지지 않을 수 있습니다)
        </p>
      )}
    </div>
  );
}

function CopyFromSignatureBar(props: { onCopy: (to: ProductGroup) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <p className="text-xs text-slate-400">시그니처에서 복사</p>
      <button
        type="button"
        onClick={() => props.onCopy("phono_basil_corn")}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
      >
        <Copy className="w-3.5 h-3.5" /> 바질&허니·초당옥수수로
      </button>
      <button
        type="button"
        onClick={() => props.onCopy("phono_ricotta")}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
      >
        <Copy className="w-3.5 h-3.5" /> 리코타&허니로
      </button>
    </div>
  );
}

function ReadinessPanel(props: { readiness: Record<ProductGroup, GroupReadiness> }) {
  return (
    <section className="no-print mb-4 rounded-xl border border-slate-700/70 bg-slate-800/40 p-3 md:p-4">
      <p className="text-xs font-medium text-slate-400 mb-2">입력 완료 검증</p>
      <p className="text-[11px] text-slate-500 mb-3">
        우선순위는 숙련이 아니라 포지션별 후보 순번입니다. 1~4순위는 자리마다 한 명만, 한 사람은 여러 자리 후보가 될 수 있습니다. 점심 유지는 필수포지션마다 가능자 2명 이상이 필요합니다.
      </p>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {PRODUCT_GROUPS.map((pg) => {
          const r = props.readiness[pg.id];
          return (
            <div key={pg.id} className="rounded-lg border border-slate-700 bg-slate-900/50 p-2.5">
              <p className="text-xs font-semibold text-slate-200 mb-2">{pg.label}</p>
              <ul className="space-y-1 text-[11px] text-slate-400">
                <li>필수포지션 {r.requiredCount}</li>
                <li className={r.primaryComplete === r.requiredCount ? "text-cyan-200" : "text-amber-200"}>
                  1순위 등록 {r.primaryComplete}/{r.requiredCount}
                </li>
                <li className={r.backupComplete === r.requiredCount ? "text-cyan-200" : "text-amber-200"}>
                  정상 대체자 {r.backupComplete}/{r.requiredCount}
                </li>
                <li className={r.singleCandidate.length ? "text-amber-200" : ""}>
                  후보 1명뿐 {r.singleCandidate.length ? r.singleCandidate.map((p) => p.label).join(", ") : "없음"}
                </li>
                <li className={r.noneCandidate.length ? "text-rose-200" : ""}>
                  후보 없음 {r.noneCandidate.length ? r.noneCandidate.map((p) => p.label).join(", ") : "없음"}
                </li>
                <li className={r.lunchPossible ? "text-cyan-200" : "text-rose-200"}>
                  점심 로테이션 {r.lunchPossible ? "가능" : "불가능"}
                </li>
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function RotationBoardClient() {
  const [date, setDate] = useState(todayStr);
  const [line, setLine] = useState<ProductLine>("phono_signature");
  const [modes, setModes] = useState<RotationModes>({ lunch: true, breakRotation: false, splitShift: false });
  const [roster, setRoster] = useState<Person[]>([]);
  const [catalog, setCatalog] = useState<PositionCatalog>(DEFAULT_CATALOG);
  const [skills, setSkills] = useState<SkillMatrix>({});
  const [hydrated, setHydrated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [unmatchedLeaves, setUnmatchedLeaves] = useState<string[]>([]);
  const [planningLeaveItems, setPlanningLeaveItems] = useState<PlanningLeaveItem[]>([]);
  const [plannedProducts, setPlannedProducts] = useState<PlannedRotationProduct[]>([]);
  const [plannedMixed, setPlannedMixed] = useState(false);
  const [editing, setEditing] = useState<{ period: PeriodId; personId: string } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"board" | "positions" | "skills">("board");
  const [skillGroup, setSkillGroup] = useState<ProductGroup>("phono_signature");
  const [overrides, setOverrides] = useState<PeriodAssignments | null>(null);
  const skipMasterSave = useRef(true);
  const skipDaySave = useRef(true);
  const leaveItemsRef = useRef<PlanningLeaveItem[]>([]);
  const attendanceRef = useRef<Record<string, boolean>>({});
  const appliedRosterKeyRef = useRef("");

  const masterSnapshot = useMemo(
    () =>
      JSON.stringify({
        workers: roster.map(({ id, name, preferred, shift, group }) => ({ id, name, preferred, shift, group })),
        catalog,
        skills,
      }),
    [roster, catalog, skills]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const master = await fetchRotationMaster();
        if (cancelled) return;
        setRoster(master.workers);
        setCatalog(master.catalog);
        setSkills(master.skills);
        skipMasterSave.current = true;
        setHydrated(true);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "마스터를 불러오지 못했습니다.");
        setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    skipDaySave.current = true;
    (async () => {
      try {
        const day = await fetchRotationDay(date);
        if (cancelled) return;
        if (day.plannedLine || day.saved) {
          setLine(day.productLine);
          setSkillGroup(productGroup(day.productLine));
        }
        if (day.saved) {
          setModes(day.modes);
        }
        setPlannedProducts(day.plannedProducts ?? []);
        setPlannedMixed(Boolean(day.plannedMixed));
        leaveItemsRef.current = day.planningLeaveItems ?? [];
        attendanceRef.current = day.attendance ?? {};
        setPlanningLeaveItems(leaveItemsRef.current);
        setUnmatchedLeaves(day.unmatchedLeaves ?? []);
        setRoster((prev) => {
          appliedRosterKeyRef.current = prev.map((p) => p.id).join(",");
          return applyPlanningLeaveItems(prev, leaveItemsRef.current, attendanceRef.current);
        });
        setOverrides(day.assignments);
      } catch {
        if (!cancelled) {
          setOverrides(null);
          setPlanningLeaveItems([]);
          setUnmatchedLeaves([]);
          setSaveNote("당일 생산계획(연차·반차)을 불러오지 못했습니다.");
        }
      } finally {
        skipDaySave.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, hydrated]);

  const rosterIdKey = useMemo(() => roster.map((p) => p.id).join(","), [roster]);
  useEffect(() => {
    if (!hydrated || !rosterIdKey) return;
    if (appliedRosterKeyRef.current === rosterIdKey) return;
    appliedRosterKeyRef.current = rosterIdKey;
    setRoster((prev) => applyPlanningLeaveItems(prev, leaveItemsRef.current, attendanceRef.current));
  }, [hydrated, rosterIdKey]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipMasterSave.current) {
      skipMasterSave.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void saveRotationMaster({
        workers: roster.map((w) => ({ ...w, present: true })),
        catalog,
        skills,
      }).then(
        () => setSaveNote("공통 마스터 저장됨"),
        (err) => setSaveNote(err instanceof Error ? err.message : "마스터 저장 실패")
      );
    }, 700);
    return () => window.clearTimeout(t);
  }, [masterSnapshot, hydrated, roster, catalog, skills]);

  const group = productGroup(line);
  const result = useMemo(
    () => generateRotation({ roster, line, modes, catalog, skills }),
    [roster, line, modes, catalog, skills]
  );

  useEffect(() => {
    if (skipDaySave.current) return;
    setOverrides(null);
  }, [line, modes, catalog, skills]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipDaySave.current) {
      skipDaySave.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void saveRotationDay({
        date,
        productLine: line,
        modes,
        attendance: Object.fromEntries(roster.map((p) => [p.id, p.present])),
        assignments: overrides,
      }).then(
        () => setSaveNote("당일 데이터 저장됨"),
        (err) => setSaveNote(err instanceof Error ? err.message : "당일 저장 실패")
      );
    }, 700);
    return () => window.clearTimeout(t);
  }, [date, line, modes, roster, overrides, hydrated]);

  const readinessByGroup = useMemo(
    () =>
      Object.fromEntries(
        PRODUCT_GROUPS.map((pg) => [pg.id, buildGroupReadiness(catalog, pg.id, skills, roster)])
      ) as Record<ProductGroup, GroupReadiness>,
    [catalog, skills, roster]
  );
  const currentReadiness = readinessByGroup[group];

  const copyFromSignature = (to: ProductGroup) => {
    const label = PRODUCT_GROUPS.find((pg) => pg.id === to)?.label ?? to;
    if (
      !window.confirm(
        `포노 시그니처의 포지션과 우선순위를 「${label}」에 복사합니다. 기존 값은 덮어쓰이며, 이후 차이만 수정하면 됩니다.`
      )
    ) {
      return;
    }
    const next = copyProductGroup(catalog, skills, roster, "phono_signature", to);
    setCatalog(next.catalog);
    setSkills(next.skills);
    setSkillGroup(to);
  };

  const assignments = useMemo(() => {
    const base = overrides ?? result.assignments;
    const next: PeriodAssignments = { start: [], lunch1: [], lunch2: [], after: [] };
    for (const period of PERIODS) {
      const seen = new Set<string>();
      for (const row of base[period.id]) {
        const person = roster.find((p) => p.id === row.personId);
        if (!person || seen.has(person.id)) continue;
        seen.add(person.id);
        next[period.id].push(isAvailableInPeriod(person, period.id) ? row : { personId: person.id, station: "off" });
      }
      for (const person of roster) {
        if (seen.has(person.id) || isAvailableInPeriod(person, period.id)) continue;
        next[period.id].push({ personId: person.id, station: "off" });
      }
    }
    return next;
  }, [overrides, result.assignments, roster]);
  const checks = useMemo(
    () => (overrides ? buildChecks(overrides, result.targets, roster, modes, catalog, group, skills) : result.checks),
    [overrides, result.targets, result.checks, roster, modes, catalog, group, skills]
  );

  const presentCount = roster.filter((p) => p.present).length;
  const heatN = heatingTarget(catalog, group);
  const heatReady = heatingPositions(catalog, group).every((pos) =>
    roster.some((p) => p.present && getPriority(skills, p.id, group, pos.id) > 0)
  );

  const handleMove = useCallback(
    (period: PeriodId, personId: string, station: StationId, positionId?: string) => {
      const base = overrides ?? result.assignments;
      const moved = movePerson(base, period, personId, station, positionId, skills, group, roster);
      if (moved.error) {
        setMoveError(moved.error);
        return;
      }
      setMoveError(null);
      setOverrides(moved.assignments);
      setEditing(null);
    },
    [overrides, result.assignments, skills, group, roster]
  );

  const addPosition = (g: ProductGroup, process: ProcessId) => {
    const pos: PositionDef = { id: newPositionId(process), label: `${processLabel(process)} ${catalog[g].filter((p) => p.process === process).length + 1}`, process };
    setCatalog((c) => ({ ...c, [g]: [...c[g], pos] }));
    setSkills((s) => {
      let next = s;
      for (const person of roster) next = setPriority(next, person.id, g, pos.id, 0);
      return next;
    });
  };

  const renamePosition = (g: ProductGroup, id: string, label: string) => {
    setCatalog((c) => ({ ...c, [g]: c[g].map((p) => (p.id === id ? { ...p, label } : p)) }));
  };

  const removePosition = (g: ProductGroup, id: string) => {
    setCatalog((c) => ({ ...c, [g]: c[g].filter((p) => p.id !== id) }));
  };

  const productLabel = PRODUCT_LINES.find((p) => p.id === line)?.label ?? line;
  const grouped = warnGroups(overrides ? result.warnings : result.warnings);

  return (
    <div className="min-h-[calc(100dvh-3.5rem-4rem)] md:min-h-0 p-4 md:p-6 max-w-[1600px] mx-auto">
      <style>{`
        @media print {
          .no-print { display: none !important; }
        }
      `}</style>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/production" className="no-print inline-flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-300 mb-1">
            <ArrowLeft className="w-3.5 h-3.5" /> 생산
          </Link>
          <h1 className="text-xl md:text-2xl font-semibold text-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-cyan-400" />
            작업 로테이션
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {date} {weekdayKo(date)}요일 · {productLabel} · 실근무 {presentCount}명 · 가열 {heatN}포지션
          </p>
          {saveNote && <p className="mt-1 text-[11px] text-slate-500">{saveNote}</p>}
        </div>
        <div className="no-print flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setOverrides(null); setMoveError(null); }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
          >
            <RefreshCw className="w-4 h-4" />
            다시 배정
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-700/60 bg-cyan-950/40 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-900/40"
          >
            <Printer className="w-4 h-4" />
            인쇄
          </button>
        </div>
      </header>

      <section className="no-print mb-4 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="rounded-xl border border-slate-700/70 bg-slate-800/40 p-3 md:p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs text-slate-400">
              날짜
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="block text-xs text-slate-400">
              제품
              <select
                value={line}
                onChange={(e) => {
                  const id = e.target.value as ProductLine;
                  setLine(id);
                  setSkillGroup(productGroup(id));
                }}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              >
                {PRODUCT_LINES.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-slate-500">피자·파베이크는 파베이크 자리, 포노부오노만 세부 제품으로 맞춥니다.</span>
            </label>
          </div>
          {plannedProducts.length > 0 && (
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2">
              <p className="text-[11px] text-slate-500 mb-1.5">생산계획</p>
              <ul className="space-y-0.5 text-xs text-slate-300">
                {plannedProducts.map((p) => (
                  <li key={`${p.name}-${p.line ?? "none"}`}>
                    {p.name} {p.qty.toLocaleString("ko-KR")}개
                    <span className="ml-1 text-slate-500">
                      → {p.line ? rotationLineLabel(p.line) : "로테이션 대상 아님"}
                    </span>
                  </li>
                ))}
              </ul>
              {plannedMixed && (
                <p className="mt-1.5 text-[11px] text-amber-200">
                  이날 계획이 여러 로테이션 제품군입니다. 수량이 많은 쪽으로 맞춰 두었고, 필요하면 위에서 바꿀 수 있습니다.
                </p>
              )}
            </div>
          )}
          <LeaveSummaryPanel items={planningLeaveItems} unmatched={unmatchedLeaves} />
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["lunch", "점심 로테이션", "+1시간"],
                ["breakRotation", "브레이크 로테이션", "+30분"],
                ["splitShift", "8–18 / 9–19 분리", "+1시간"],
              ] as const
            ).map(([key, label, extra]) => (
              <label
                key={key}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${
                  modes[key] ? "border-cyan-600/70 bg-cyan-950/40 text-cyan-100" : "border-slate-600 bg-slate-900/50 text-slate-300"
                }`}
              >
                <input
                  type="checkbox"
                  checked={modes[key]}
                  onChange={(e) => setModes((m) => ({ ...m, [key]: e.target.checked }))}
                />
                <span>
                  {label}
                  <span className="ml-1 text-[11px] text-slate-400">{extra}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-700/70 bg-slate-800/40 p-3 md:p-4">
          <p className="text-xs font-medium text-slate-400 mb-2">가열 연장 · 생산량</p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div>
              <p className="text-[11px] text-slate-500">추가 가열</p>
              <p className="text-lg font-semibold text-slate-100">{result.impact.extraHours}시간</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">시간당</p>
              <p className="text-lg font-semibold text-slate-100">{result.impact.hourlyQty.toLocaleString("ko-KR")}개</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500">추가 생산</p>
              <p className="text-lg font-semibold text-cyan-300">{result.impact.extraQty.toLocaleString("ko-KR")}개</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">{result.impact.doughNote}</p>
          {modes.lunch && modes.breakRotation && modes.splitShift && (
            <p className="mt-2 text-xs text-amber-300">
              3방법 합치면 가열 +2시간 30분 → 파베이크 +1,000 / 포노 리코타 외 +1,250 / 리코타 +1,250.
            </p>
          )}
        </div>
      </section>

      <ReadinessPanel readiness={readinessByGroup} />

      {loadError && (
        <p className="no-print mb-4 rounded-xl border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          {loadError} 로그인 후 새로고침하거나, 관리자에게 로테이션 마스터 테이블 적용을 요청하세요.
        </p>
      )}

      {modes.lunch && (!currentReadiness.lunchPossible || !currentReadiness.lunchPossibleToday) && (
        <p className="no-print mb-4 rounded-xl border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          점심 교대 불가능. 점심시간에도 자리를 유지하려면 각 필수포지션에 가능자가 최소 2명 있어야 합니다.
          {currentReadiness.singleCandidate.length > 0
            ? ` 후보 1명뿐: ${currentReadiness.singleCandidate.map((p) => p.label).join(", ")}.`
            : ""}
          {currentReadiness.noneCandidate.length > 0
            ? ` 후보 없음: ${currentReadiness.noneCandidate.map((p) => p.label).join(", ")}.`
            : ""}
          {!currentReadiness.lunchPossibleToday && currentReadiness.lunchPossible
            ? " 등록 후보는 충분하지만, 오늘 출근 인원만으로는 교대가 안 됩니다."
            : ""}
        </p>
      )}

      {!heatReady && (
        <p className="no-print mb-4 rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          가열 포지션마다 1~4순위 또는 비상을 넣어야 자동배치가 됩니다. 아래 <b>우선순위</b>에서 제품군별로 입력하세요. 자리 이름은 <b>포지션</b>에서 바꿀 수 있습니다.
        </p>
      )}

      {moveError && (
        <p className="no-print mb-3 rounded-lg border border-rose-700/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">{moveError}</p>
      )}

      {grouped.length > 0 && (
        <div className="no-print mb-4 grid gap-2 md:grid-cols-2">
          {grouped.map((g) => (
            <div
              key={g.kind}
              className={`rounded-xl border px-3 py-2 text-xs ${
                g.kind === "unfilled" || g.kind === "lunchCoverage" || g.kind === "emergency"
                  ? "border-rose-700/50 bg-rose-950/30 text-rose-100"
                  : g.kind === "rank4" || g.kind === "rank3" || g.kind === "preferredLeave"
                    ? "border-amber-700/50 bg-amber-950/30 text-amber-100"
                    : "border-slate-700 bg-slate-800/50 text-slate-300"
              }`}
            >
              <p className="font-semibold mb-1">{WARN_TITLE[g.kind]} · {g.items.length}건</p>
              <ul className="space-y-0.5">
                {g.items.slice(0, 8).map((w) => (
                  <li key={w.message}>{w.message}</li>
                ))}
                {g.items.length > 8 && <li>외 {g.items.length - 8}건</li>}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="no-print mb-3 flex flex-wrap gap-1.5">
        {(["board", "positions", "skills"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel(id)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              panel === id ? "border-cyan-600 bg-cyan-950/40 text-cyan-100" : "border-slate-600 text-slate-300"
            }`}
          >
            {id === "board" ? "배치표" : id === "positions" ? "포지션" : "우선순위"}
          </button>
        ))}
      </div>

      <div className="no-print mb-4 flex flex-wrap gap-1.5">
        {checks.map((c) => (
          <span
            key={c.id}
            className={`rounded-full border px-2.5 py-1 text-[11px] ${
              c.ok ? "border-slate-600 text-slate-400" : "border-rose-500/60 bg-rose-950/40 text-rose-200"
            }`}
            title={`${c.expected} · ${c.actual}`}
          >
            {c.ok ? "OK" : "!"} {c.label} {c.actual}
          </span>
        ))}
      </div>

      {(panel === "board") && (
        <BoardGrid
          catalog={catalog}
          group={group}
          roster={roster}
          assignments={assignments}
          skills={skills}
          editing={editing}
          setEditing={setEditing}
          onMove={handleMove}
        />
      )}

      {panel === "positions" && (
        <PositionEditor
          catalog={catalog}
          skillGroup={skillGroup}
          setSkillGroup={setSkillGroup}
          onAdd={addPosition}
          onRename={renamePosition}
          onRemove={removePosition}
          onCopyFromSignature={copyFromSignature}
        />
      )}

      {panel === "skills" && (
        <SkillMatrixEditor
          roster={roster}
          setRoster={setRoster}
          catalog={catalog}
          skills={skills}
          setSkills={setSkills}
          skillGroup={skillGroup}
          setSkillGroup={setSkillGroup}
          onCopyFromSignature={copyFromSignature}
          onRankError={setMoveError}
        />
      )}

      <p className="no-print mt-4 text-[11px] text-slate-500">
        기준 생산량: 파베이크 {HOURLY_QTY.parbake}개/시간, 포노 시그니처·바질·초당·리코타 {HOURLY_QTY.phono_signature}개/시간.
        포지션·우선순위·출근조·주공정은 회사코드 100 공통 마스터로 저장됩니다. 명단은 관리→사용자의 100번 조직(워커·준매니저·매니저, test·admin 제외)과 같습니다. 연월차·반차·기타는 생산계획에서 가져와 날짜별로 반영됩니다.
      </p>
    </div>
  );
}

function BoardGrid(props: {
  catalog: PositionCatalog;
  group: ProductGroup;
  roster: Person[];
  assignments: ReturnType<typeof generateRotation>["assignments"];
  skills: SkillMatrix;
  editing: { period: PeriodId; personId: string } | null;
  setEditing: (v: { period: PeriodId; personId: string } | null) => void;
  onMove: (period: PeriodId, personId: string, station: StationId, positionId?: string) => void;
}) {
  const { catalog, group, roster, assignments, skills, editing, setEditing, onMove } = props;
  const heat = heatingPositions(catalog, group);
  const other = catalog[group].filter((p) => p.process !== "heating");

  return (
    <div className="print-board grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
      {PERIODS.map((period) => {
        const rows = assignments[period.id];
        return (
          <section key={period.id} className="rounded-xl border border-slate-700/70 bg-slate-900/40 overflow-hidden">
            <header className="px-3 py-2 border-b border-slate-700/70 bg-slate-800/70">
              <p className="text-sm font-semibold text-slate-100">{period.label}</p>
            </header>
            <div className="p-2 space-y-2">
              <p className="text-[11px] font-semibold text-amber-200/90 px-0.5">가열</p>
              {heat.map((pos) => {
                const people = peopleOn(rows, roster, { positionId: pos.id, station: "heating" });
                const empty = people.length === 0;
                return (
                  <PositionBlock
                    key={pos.id}
                    title={pos.label}
                    tone={empty ? "border-rose-700/60 bg-rose-950/40" : PROCESS_TONE.heating}
                    countLabel={empty ? "비어 있음" : `${people.length}/1`}
                    miss={empty}
                    people={people}
                    period={period.id}
                    editing={editing}
                    setEditing={setEditing}
                    catalog={catalog}
                    group={group}
                    skills={skills}
                    onMove={onMove}
                  />
                );
              })}
              {(["inner", "outer", "dough", "cleanup", "topping", "rnd", "office"] as ProcessId[]).map((process) => {
                const defs = other.filter((p) => p.process === process);
                if (defs.length === 0) return null;
                const people = peopleOn(rows, roster, { station: process });
                if (people.length === 0 && process !== "inner" && process !== "outer") return null;
                return (
                  <PositionBlock
                    key={process}
                    title={processLabel(process)}
                    tone={PROCESS_TONE[process]}
                    countLabel={`${people.length}`}
                    miss={false}
                    people={people}
                    period={period.id}
                    editing={editing}
                    setEditing={setEditing}
                    catalog={catalog}
                    group={group}
                    skills={skills}
                    onMove={onMove}
                  />
                );
              })}
              <LunchOrIdle rows={rows} roster={roster} station="lunch" period={period.id} editing={editing} setEditing={setEditing} catalog={catalog} group={group} skills={skills} onMove={onMove} />
              <LunchOrIdle rows={rows} roster={roster} station="off" period={period.id} editing={editing} setEditing={setEditing} catalog={catalog} group={group} skills={skills} onMove={onMove} />
              <LunchOrIdle rows={rows} roster={roster} station="unassigned" period={period.id} editing={editing} setEditing={setEditing} catalog={catalog} group={group} skills={skills} onMove={onMove} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function LunchOrIdle(props: {
  rows: ReturnType<typeof generateRotation>["assignments"][PeriodId];
  roster: Person[];
  station: "lunch" | "unassigned" | "off";
  period: PeriodId;
  editing: { period: PeriodId; personId: string } | null;
  setEditing: (v: { period: PeriodId; personId: string } | null) => void;
  catalog: PositionCatalog;
  group: ProductGroup;
  skills: SkillMatrix;
  onMove: (period: PeriodId, personId: string, station: StationId, positionId?: string) => void;
}) {
  const people = peopleOn(props.rows, props.roster, { station: props.station });
  if (people.length === 0) return null;
  return (
    <PositionBlock
      title={props.station === "lunch" ? "식사" : props.station === "off" ? "휴무" : "미배치"}
      tone={PROCESS_TONE[props.station]}
      countLabel={`${people.length}`}
      miss={props.station === "unassigned"}
      people={people}
      period={props.period}
      editing={props.editing}
      setEditing={props.setEditing}
      catalog={props.catalog}
      group={props.group}
      skills={props.skills}
      onMove={props.onMove}
    />
  );
}

function PositionBlock(props: {
  title: string;
  tone: string;
  countLabel: string;
  miss: boolean;
  people: ReturnType<typeof peopleOn>;
  period: PeriodId;
  editing: { period: PeriodId; personId: string } | null;
  setEditing: (v: { period: PeriodId; personId: string } | null) => void;
  catalog: PositionCatalog;
  group: ProductGroup;
  skills: SkillMatrix;
  onMove: (period: PeriodId, personId: string, station: StationId, positionId?: string) => void;
}) {
  const lunch = props.title === "식사";
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${props.tone}`}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className={`text-[11px] font-semibold ${lunch ? "text-slate-900" : "text-slate-200"}`}>{props.title}</p>
        <p className={`text-[11px] ${props.miss ? "text-rose-300" : lunch ? "text-slate-800" : "text-slate-400"}`}>{props.countLabel}</p>
      </div>
      <ul className="flex flex-wrap gap-1">
        {props.people.map(({ person, assignment }) => (
          <li key={person.id} className="relative">
            <button
              type="button"
              onClick={() =>
                props.setEditing(
                  props.editing?.period === props.period && props.editing.personId === person.id
                    ? null
                    : { period: props.period, personId: person.id }
                )
              }
              className={`rounded px-1.5 py-0.5 text-xs text-left ${
                lunch ? "bg-yellow-300 text-slate-900 hover:bg-yellow-200" : "bg-slate-950/40 text-slate-100 hover:bg-slate-950/70"
              } ${assignment.priority === 5 ? "ring-1 ring-rose-400" : assignment.priority === 4 ? "ring-1 ring-orange-400" : assignment.priority === 3 ? "ring-1 ring-amber-400" : ""}`}
            >
              {person.name}
              {leaveKindLabel(person.leaveKind) ? (
                <span className={`ml-1 text-[10px] ${lunch ? "text-slate-700" : "text-amber-300"}`}>
                  {leaveKindLabel(person.leaveKind)}
                </span>
              ) : null}
              {assignment.priority ? ` [${priorityLabel(assignment.priority)}]` : ""}
            </button>
            {props.editing?.period === props.period && props.editing.personId === person.id && (
              <MoveMenu
                person={person}
                catalog={props.catalog}
                group={props.group}
                skills={props.skills}
                onPick={(station, positionId) => props.onMove(props.period, person.id, station, positionId)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MoveMenu(props: {
  person: Person;
  catalog: PositionCatalog;
  group: ProductGroup;
  skills: SkillMatrix;
  onPick: (station: StationId, positionId?: string) => void;
}) {
  return (
    <div className="no-print absolute z-20 mt-1 left-0 max-h-64 overflow-y-auto min-w-[11rem] rounded-lg border border-slate-600 bg-slate-900 p-1">
      <button type="button" onClick={() => props.onPick("lunch")} className="block w-full text-left rounded px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800">
        식사
      </button>
      <button type="button" onClick={() => props.onPick("off")} className="block w-full text-left rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800">
        휴무
      </button>
      <button type="button" onClick={() => props.onPick("unassigned")} className="block w-full text-left rounded px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800">
        미배치
      </button>
      {props.catalog[props.group].map((pos) => {
        const ok = canAssign(props.skills, props.person.id, props.group, pos.id, pos.process);
        const pr = getPriority(props.skills, props.person.id, props.group, pos.id);
        return (
          <button
            key={pos.id}
            type="button"
            disabled={!ok}
            onClick={() => props.onPick(pos.process, pos.id)}
            className="block w-full text-left rounded px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:text-slate-600"
          >
            {processLabel(pos.process)} · {pos.label}
            {ok ? ` [${priorityLabel(pr)}]` : " [불가]"}
          </button>
        );
      })}
    </div>
  );
}

function PositionEditor(props: {
  catalog: PositionCatalog;
  skillGroup: ProductGroup;
  setSkillGroup: (g: ProductGroup) => void;
  onAdd: (g: ProductGroup, process: ProcessId) => void;
  onRename: (g: ProductGroup, id: string, label: string) => void;
  onRemove: (g: ProductGroup, id: string) => void;
  onCopyFromSignature: (to: ProductGroup) => void;
}) {
  const g = props.skillGroup;
  const heatN = heatingPositions(props.catalog, g).length;
  const expect = g === "phono_ricotta" ? 8 : 7;
  return (
    <section className="no-print rounded-xl border border-slate-700/70 bg-slate-800/30 p-4 mb-6">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {PRODUCT_GROUPS.map((pg) => (
          <button
            key={pg.id}
            type="button"
            onClick={() => props.setSkillGroup(pg.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              g === pg.id ? "border-cyan-600 bg-cyan-950/40 text-cyan-100" : "border-slate-600 text-slate-300"
            }`}
          >
            {pg.label}
          </button>
        ))}
      </div>
      <CopyFromSignatureBar onCopy={props.onCopyFromSignature} />
      <p className="text-xs text-slate-400 mb-3">
        가열 필수 포지션 {heatN}개 (리코타는 8, 그 외 7이 기본). 이름을 현장 용어로 바꾸고, 자리를 추가·삭제할 수 있습니다. 파베이크는 도우따기·누르기·스피너 전·스피너 후·소스·자르기·받기가 들어 있습니다.
        {heatN !== expect ? ` 현재 ${heatN}개라 기본 ${expect}개와 다릅니다.` : ""}
      </p>
      {PROCESSES.filter((p) => p.id !== "office").map((process) => {
        const list = props.catalog[g].filter((p) => p.process === process.id);
        return (
          <div key={process.id} className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-slate-200">{process.label}</p>
              <button
                type="button"
                onClick={() => props.onAdd(g, process.id)}
                className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200"
              >
                <Plus className="w-3.5 h-3.5" /> 추가
              </button>
            </div>
            <ul className="space-y-1">
              {list.map((pos) => (
                <li key={pos.id} className="flex items-center gap-2">
                  <input
                    value={pos.label}
                    onChange={(e) => props.onRename(g, pos.id, e.target.value)}
                    className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100"
                  />
                  <button type="button" onClick={() => props.onRemove(g, pos.id)} className="text-slate-500 hover:text-rose-300" aria-label="삭제">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="text-xs text-slate-500">없음</li>}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function SkillMatrixEditor(props: {
  roster: Person[];
  setRoster: Dispatch<SetStateAction<Person[]>>;
  catalog: PositionCatalog;
  skills: SkillMatrix;
  setSkills: Dispatch<SetStateAction<SkillMatrix>>;
  skillGroup: ProductGroup;
  setSkillGroup: (g: ProductGroup) => void;
  onCopyFromSignature: (to: ProductGroup) => void;
  onRankError: (message: string | null) => void;
}) {
  const g = props.skillGroup;
  const cols = props.catalog[g];
  const heat = cols.filter((p) => p.process === "heating");
  const rest = cols.filter((p) => p.process !== "heating");
  const ordered = [...heat, ...rest];

  return (
    <section className="no-print rounded-xl border border-slate-700/70 bg-slate-800/30 overflow-hidden mb-6">
      <div className="px-4 py-3 flex flex-wrap gap-1.5">
        {PRODUCT_GROUPS.map((pg) => (
          <button
            key={pg.id}
            type="button"
            onClick={() => props.setSkillGroup(pg.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              g === pg.id ? "border-cyan-600 bg-cyan-950/40 text-cyan-100" : "border-slate-600 text-slate-300"
            }`}
          >
            {pg.label}
          </button>
        ))}
      </div>
      <div className="px-4">
        <CopyFromSignatureBar onCopy={props.onCopyFromSignature} />
      </div>
      <p className="px-4 pb-2 text-xs text-slate-400">
        1순위 최우선 · 2순위 1순위 부재·식사 시 · 3순위 1·2 불가 시 · 4순위 최종 정상 대체 · 비상은 정상 후보가 모두 없을 때만 · 불가는 배치 금지.
        같은 자리의 1~4순위는 한 명만 넣을 수 있습니다. 한 사람은 여러 자리 후보가 될 수 있습니다.
      </p>
      <div className="overflow-auto max-h-[70vh]">
        <table className="text-[11px] min-w-max">
          <thead className="sticky top-0 bg-slate-900 z-10">
            <tr>
              <th className="px-2 py-2 text-left sticky left-0 bg-slate-900 text-slate-400">출근</th>
              <th className="px-2 py-2 text-left sticky left-10 bg-slate-900 text-slate-400">이름</th>
              <th className="px-2 py-2 text-left text-slate-400">주공정</th>
              <th className="px-2 py-2 text-left text-slate-400">조</th>
              {ordered.map((pos) => (
                <th key={pos.id} className="px-1 py-2 text-center text-slate-400 whitespace-nowrap min-w-[4.5rem]">
                  <span className="block text-[10px] text-slate-500">{processLabel(pos.process)}</span>
                  {pos.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.roster.map((person) => (
              <tr key={person.id} className={`border-t border-slate-800 ${person.present ? "" : "opacity-45"}`}>
                <td className="px-2 py-1 sticky left-0 bg-slate-900">
                  <input
                    type="checkbox"
                    checked={person.present}
                    disabled={isFullDayLeave(person.leaveKind)}
                    title={isFullDayLeave(person.leaveKind) ? "생산계획 연차·기타는 자동 휴무입니다." : undefined}
                    onChange={(e) =>
                      props.setRoster((rows) => rows.map((r) => (r.id === person.id ? { ...r, present: e.target.checked } : r)))
                    }
                  />
                </td>
                <td className="px-2 py-1 sticky left-10 bg-slate-900 text-slate-100 whitespace-nowrap">
                  {person.name}
                  {leaveKindLabel(person.leaveKind) ? (
                    <span className="ml-1 text-[10px] text-amber-300">{leaveKindLabel(person.leaveKind)}</span>
                  ) : null}
                </td>
                <td className="px-2 py-1">
                  <select
                    value={person.preferred}
                    onChange={(e) =>
                      props.setRoster((rows) =>
                        rows.map((r) => (r.id === person.id ? { ...r, preferred: e.target.value as Person["preferred"] } : r))
                      )
                    }
                    className="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-slate-200"
                  >
                    {PROCESSES.map((process) => (
                      <option key={process.id} value={process.id}>{process.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <select
                    value={person.shift}
                    onChange={(e) =>
                      props.setRoster((rows) =>
                        rows.map((r) => (r.id === person.id ? { ...r, shift: e.target.value as Person["shift"] } : r))
                      )
                    }
                    className="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-slate-200"
                  >
                    <option value="0800-1800">08–18</option>
                    <option value="0900-1900">09–19</option>
                  </select>
                </td>
                {ordered.map((pos) => {
                  const v = getPriority(props.skills, person.id, g, pos.id);
                  return (
                    <td key={pos.id} className="px-0.5 py-0.5 text-center">
                      <select
                        value={v}
                        onChange={(e) => {
                          const n = Number(e.target.value) as Priority;
                          const next = setPriorityUnique(props.skills, props.roster, person.id, g, pos.id, n);
                          if (next.error) {
                            props.onRankError(next.error);
                            return;
                          }
                          props.onRankError(null);
                          props.setSkills(next.skills);
                        }}
                        className={`w-full rounded border border-slate-700 px-0.5 py-1 ${PRIORITY_CELL[v]}`}
                      >
                        {PRIORITY_OPTIONS.map((o) => {
                          const taken = rankTakenBy(props.skills, props.roster, g, pos.id, o.value, person.id);
                          return (
                            <option key={o.value} value={o.value} disabled={Boolean(taken)}>
                              {o.short}{taken ? ` (${taken.name})` : ""}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
