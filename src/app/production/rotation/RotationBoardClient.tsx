"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer, RefreshCw, Settings2, Users } from "lucide-react";
import { DEFAULT_CATALOG, eligibleRotationRoster, getPriority, heatingPositions } from "@/features/production/rotation/catalog";
import { processNeedsStaffing, staffingForPosition, staffingRangeLabel } from "@/features/production/rotation/staffing";
import { fetchRotationDay, fetchRotationMaster, saveRotationDay } from "@/features/production/rotation/clientApi";
import { HOURLY_QTY, PRODUCT_LINES, productGroup } from "@/features/production/rotation/seedRoster";
import {
  applyPlanningLeaveItems,
  isAvailableInPeriod,
  isFullDayLeave,
  leaveKindLabel,
  type PlanningLeaveItem,
} from "@/features/production/rotation/planningLeave";
import { rotationLineLabel, type PlannedRotationProduct } from "@/features/production/rotation/mapPlanProducts";
import {
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
  type PeriodAssignments,
  type PeriodId,
  type Person,
  type PositionCatalog,
  type ProductGroup,
  type ProductLine,
  type RotationModes,
  type SkillMatrix,
  type StaffingTarget,
  type StationId,
} from "@/features/production/rotation/types";
import { useAuth } from "@/contexts/AuthContext";

function todayStr() {
  const d = new Date();
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}

function weekdayKo(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00`);
  return ["일", "월", "화", "수", "목", "금", "토"][d.getDay()] ?? "";
}

function LeaveLine(props: { items: PlanningLeaveItem[]; unmatched: string[] }) {
  if (props.items.length === 0) {
    return <p className="text-sm text-slate-400">연차·반차 없음</p>;
  }
  const parts = [
    ["annual", "연차"],
    ["half_am", "반(오전)"],
    ["half_pm", "반(오후)"],
    ["half", "반차"],
    ["other", "기타"],
  ] as const;
  return (
    <div className="text-sm text-slate-200 space-y-0.5">
      {parts.map(([key, label]) => {
        const rows = props.items.filter((i) => i.kind === key);
        if (rows.length === 0) return null;
        return (
          <p key={key}>
            <span className="text-amber-200">{label}</span>{" "}
            {rows.map((r) => `${r.name}${r.detail ? `(${r.detail})` : ""}`).join(", ")}
          </p>
        );
      })}
      {props.unmatched.length > 0 && (
        <p className="text-xs text-amber-200">이름 미연결: {props.unmatched.join(", ")}</p>
      )}
    </div>
  );
}

export default function RotationBoardClient() {
  const { profile } = useAuth();
  const canEditSettings = profile?.role !== "worker";
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
  const [overrides, setOverrides] = useState<PeriodAssignments | null>(null);
  const skipDaySave = useRef(true);
  const leaveItemsRef = useRef<PlanningLeaveItem[]>([]);
  const attendanceRef = useRef<Record<string, boolean>>({});
  const appliedRosterKeyRef = useRef("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const master = await fetchRotationMaster();
        if (cancelled) return;
        setRoster(master.workers);
        setCatalog(master.catalog);
        setSkills(master.skills);
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

  const group = productGroup(line);
  const boardRoster = useMemo(
    () => eligibleRotationRoster(roster, skills, catalog, group, date),
    [roster, skills, catalog, group, date]
  );
  const result = useMemo(
    () => generateRotation({ roster: boardRoster, line, modes, catalog, skills, workDate: date }),
    [boardRoster, line, modes, catalog, skills]
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
        () => setSaveNote("당일 저장됨"),
        (err) => setSaveNote(err instanceof Error ? err.message : "당일 저장 실패")
      );
    }, 700);
    return () => window.clearTimeout(t);
  }, [date, line, modes, roster, overrides, hydrated]);

  const assignments = useMemo(() => {
    const base = overrides ?? result.assignments;
    const next: PeriodAssignments = { start: [], lunch1: [], lunch2: [], after: [] };
    for (const period of PERIODS) {
      const seen = new Set<string>();
      for (const row of base[period.id]) {
        const person = boardRoster.find((p) => p.id === row.personId);
        if (!person || seen.has(person.id)) continue;
        seen.add(person.id);
        next[period.id].push(isAvailableInPeriod(person, period.id) ? row : { personId: person.id, station: "off" });
      }
      for (const person of boardRoster) {
        if (seen.has(person.id) || isAvailableInPeriod(person, period.id)) continue;
        next[period.id].push({ personId: person.id, station: "off" });
      }
    }
    return next;
  }, [overrides, result.assignments, boardRoster]);

  const presentCount = boardRoster.filter((p) => p.present).length;
  const heatN = heatingTarget(catalog, group);
  const heatReady = heatingPositions(catalog, group).every((pos) =>
    boardRoster.some((p) => p.present && getPriority(skills, p.id, group, pos.id) > 0)
  );
  const blocking = result.warnings.filter((w) => w.kind === "unfilled" || w.kind === "lunchCoverage" || w.kind === "emergency");

  const handleMove = useCallback(
    (period: PeriodId, personId: string, station: StationId, positionId?: string) => {
      const base = overrides ?? result.assignments;
      const moved = movePerson(base, period, personId, station, positionId, skills, group, boardRoster);
      if (moved.error) {
        setMoveError(moved.error);
        return;
      }
      setMoveError(null);
      setOverrides(moved.assignments);
      setEditing(null);
    },
    [overrides, result.assignments, skills, group, boardRoster]
  );

  const productLabel = PRODUCT_LINES.find((p) => p.id === line)?.label ?? line;

  return (
    <div className="min-h-[calc(100dvh-3.5rem-4rem)] md:min-h-0 p-4 md:p-6 max-w-[1600px] mx-auto">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-board { break-inside: avoid; }
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
          <p className="mt-1 text-sm text-slate-300">
            {date} {weekdayKo(date)}요일 · {productLabel} · 실근무 {presentCount}명
            {result.impact.extraHours > 0 ? ` · 가열 +${result.impact.extraHours}시간 / +${result.impact.extraQty.toLocaleString("ko-KR")}개` : ""}
          </p>
          {saveNote && <p className="mt-1 text-[11px] text-slate-500 no-print">{saveNote}</p>}
        </div>
        <div className="no-print flex items-center gap-2">
          {canEditSettings && (
            <Link
              href="/production/rotation/settings"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
            >
              <Settings2 className="w-4 h-4" />
              설정
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              setOverrides(null);
              setMoveError(null);
            }}
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

      <section className="no-print mb-4 rounded-xl border border-slate-700/70 bg-slate-800/40 p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <label className="text-xs text-slate-400">
            날짜
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 block rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            />
          </label>
          <label className="text-xs text-slate-400">
            제품
            <select
              value={line}
              onChange={(e) => setLine(e.target.value as ProductLine)}
              className="mt-1 block min-w-[12rem] rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              {PRODUCT_LINES.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-2">
            {(
              [
                ["lunch", "점심"],
                ["breakRotation", "브레이크"],
                ["splitShift", "8–18 / 9–19"],
              ] as const
            ).map(([key, label]) => (
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
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-[11px] text-slate-500 mb-1">생산계획</p>
            {plannedProducts.length === 0 ? (
              <p className="text-sm text-slate-400">계획 없음</p>
            ) : (
              <ul className="text-sm text-slate-200 space-y-0.5">
                {plannedProducts.map((p) => (
                  <li key={`${p.name}-${p.line ?? "none"}`}>
                    {p.name} {p.qty.toLocaleString("ko-KR")}개
                    <span className="ml-1 text-slate-500">{p.line ? `→ ${rotationLineLabel(p.line)}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            {plannedMixed && (
              <p className="mt-1 text-xs text-amber-200">여러 제품군이 있어 수량이 많은 쪽으로 맞췄습니다.</p>
            )}
          </div>
          <div>
            <p className="text-[11px] text-slate-500 mb-1">연차·반차</p>
            <LeaveLine items={planningLeaveItems} unmatched={unmatchedLeaves} />
          </div>
        </div>
      </section>

      {loadError && (
        <p className="no-print mb-4 rounded-xl border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          {loadError} 로그인 후 새로고침하거나, 관리자에게 로테이션 마스터 테이블 적용을 요청하세요.
        </p>
      )}

      {!heatReady && (
        <p className="no-print mb-3 rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          가열 자리 숙련도가 비어 있습니다.
          {canEditSettings ? (
            <>
              {" "}
              <Link href="/production/rotation/settings" className="underline text-cyan-200">
                로테이션 설정
              </Link>
              에서 먼저 넣어 주세요.
            </>
          ) : (
            " 관리자에게 숙련도 입력을 요청하세요."
          )}
        </p>
      )}

      {moveError && (
        <p className="no-print mb-3 rounded-lg border border-rose-700/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">{moveError}</p>
      )}

      {blocking.length > 0 && (
        <div className="no-print mb-3 rounded-xl border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          <p className="font-semibold mb-1">배치 문제 {blocking.length}건</p>
          <ul className="space-y-0.5 text-xs">
            {blocking.slice(0, 6).map((w) => (
              <li key={w.message}>{w.message}</li>
            ))}
            {blocking.length > 6 && <li>외 {blocking.length - 6}건</li>}
          </ul>
        </div>
      )}

      <BoardTable
        catalog={catalog}
        group={group}
        roster={boardRoster}
        assignments={assignments}
        targets={result.targets}
        skills={skills}
        editing={editing}
        setEditing={setEditing}
        onMove={handleMove}
      />

      <details className="no-print mt-4 rounded-xl border border-slate-700/70 bg-slate-800/30 px-4 py-3">
        <summary className="cursor-pointer text-sm text-slate-300">출근 인원 {presentCount}/{boardRoster.length}명 · 누르면 조정</summary>
        <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
          {boardRoster.map((person) => (
            <li key={person.id}>
              <label className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${person.present ? "border-slate-600 text-slate-200" : "border-slate-700 text-slate-500"}`}>
                <input
                  type="checkbox"
                  checked={person.present}
                  disabled={isFullDayLeave(person.leaveKind)}
                  title={isFullDayLeave(person.leaveKind) ? "생산계획 연차·기타는 자동 휴무입니다." : undefined}
                  onChange={(e) =>
                    setRoster((rows) => rows.map((r) => (r.id === person.id ? { ...r, present: e.target.checked } : r)))
                  }
                />
                <span>
                  {person.name}
                  {leaveKindLabel(person.leaveKind) ? (
                    <span className="ml-1 text-[11px] text-amber-300">{leaveKindLabel(person.leaveKind)}</span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </details>

      <p className="no-print mt-4 text-[11px] text-slate-500">
        기준 생산량: 파베이크 {HOURLY_QTY.parbake}개/시간, 포노 {HOURLY_QTY.phono_signature}개/시간. 가열 필수 {heatN}자리.
      </p>
    </div>
  );
}

type BoardRow = {
  key: string;
  title: string;
  match: { station?: StationId; positionId?: string };
  heating?: boolean;
  staffed?: boolean;
};

function BoardTable(props: {
  catalog: PositionCatalog;
  group: ProductGroup;
  roster: Person[];
  assignments: ReturnType<typeof generateRotation>["assignments"];
  targets: Record<PeriodId, StaffingTarget>;
  skills: SkillMatrix;
  editing: { period: PeriodId; personId: string } | null;
  setEditing: (v: { period: PeriodId; personId: string } | null) => void;
  onMove: (period: PeriodId, personId: string, station: StationId, positionId?: string) => void;
}) {
  const { catalog, group, roster, assignments, targets, skills } = props;
  const heat = heatingPositions(catalog, group);
  const staffed = catalog[group].filter((p) => processNeedsStaffing(p.process));
  const rndShown = catalog[group].some((p) => p.process === "rnd");
  const allRows: BoardRow[] = [
    ...heat.map((pos) => ({
      key: pos.id,
      title: pos.label,
      match: { station: "heating" as const, positionId: pos.id },
      heating: true,
    })),
    ...staffed.map((pos) => ({
      key: pos.id,
      title: pos.label,
      match: { station: pos.process as StationId, positionId: pos.id },
      staffed: true,
    })),
    ...(rndShown
      ? [{ key: "rnd", title: processLabel("rnd"), match: { station: "rnd" as const } }]
      : []),
    { key: "lunch", title: "식사", match: { station: "lunch" as const } },
    { key: "off", title: "휴무", match: { station: "off" as const } },
    { key: "unassigned", title: "미배치", match: { station: "unassigned" as const } },
  ];
  const rows = allRows.filter((row) => {
    if (row.heating || row.key === "lunch" || row.key === "off") return true;
    const hasPeople = PERIODS.some((period) => peopleOn(assignments[period.id], roster, row.match).length > 0);
    if (row.staffed && row.match.positionId) {
      const hasNeed = PERIODS.some((period) => {
        const need = targets[period.id].positions.find((n) => n.positionId === row.match.positionId);
        return Boolean(need && (need.min > 0 || need.max > 0));
      });
      return hasNeed || hasPeople;
    }
    return hasPeople;
  });

  return (
    <div className="print-board overflow-auto rounded-xl border border-slate-700/80">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr className="bg-slate-800">
            <th className="sticky left-0 z-10 bg-slate-800 px-3 py-3 text-left text-slate-300 font-medium w-32 border-b border-slate-700">
              자리
            </th>
            {PERIODS.map((period) => (
              <th key={period.id} className="px-3 py-3 text-left text-slate-100 font-semibold border-b border-l border-slate-700">
                <span className="block">{period.short}</span>
                <span className="block text-xs font-normal text-slate-400">{period.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isLunch = row.key === "lunch";
            const isOff = row.key === "off";
            return (
              <tr key={row.key} className={isLunch ? "bg-yellow-400/90" : isOff ? "bg-slate-900/80" : "odd:bg-slate-900/40 even:bg-slate-900/20"}>
                <th
                  className={`sticky left-0 z-10 px-3 py-2.5 text-left font-semibold border-t border-slate-700/80 ${
                    isLunch ? "bg-yellow-400 text-slate-900" : isOff ? "bg-slate-900 text-slate-300" : "bg-slate-900 text-slate-100"
                  }`}
                >
                  {row.title}
                </th>
                {PERIODS.map((period) => {
                  const people = peopleOn(assignments[period.id], roster, row.match);
                  const pos = row.staffed && row.match.positionId
                    ? catalog[group].find((p) => p.id === row.match.positionId)
                    : undefined;
                  const range = pos ? staffingForPosition(pos, period.id) : null;
                  const n = people.length;
                  const under = Boolean(range && range.min > 0 && n < range.min);
                  const over = Boolean(range && n > range.max);
                  const emptyRequired = under || (row.heating && n === 0);
                  return (
                    <td
                      key={period.id}
                      className={`px-2 py-2 border-t border-l border-slate-700/80 align-top ${
                        emptyRequired || over ? "bg-rose-950/50" : isLunch ? "bg-yellow-400/90" : ""
                      }`}
                    >
                      {range && (range.min > 0 || range.max > 0 || n > 0) && (
                        <p className={`mb-1 text-[11px] ${under || over ? "text-rose-200 font-medium" : "text-slate-500"}`}>
                          {n}/{staffingRangeLabel(range.min, range.max)}
                        </p>
                      )}
                      {people.length === 0 ? (
                        <span className={`text-xs ${emptyRequired ? "text-rose-300 font-medium" : isLunch ? "text-slate-700" : "text-slate-600"}`}>
                          {emptyRequired ? "비어 있음" : "—"}
                        </span>
                      ) : (
                        <ul className="flex flex-wrap gap-1.5">
                          {people.map(({ person, assignment }) => (
                            <li key={person.id} className="relative">
                              <PersonChip
                                person={person}
                                assignment={assignment}
                                period={period.id}
                                lunch={isLunch}
                                editing={props.editing}
                                setEditing={props.setEditing}
                                catalog={catalog}
                                group={group}
                                skills={skills}
                                onMove={props.onMove}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PersonChip(props: {
  person: Person;
  assignment: ReturnType<typeof peopleOn>[number]["assignment"];
  period: PeriodId;
  lunch: boolean;
  editing: { period: PeriodId; personId: string } | null;
  setEditing: (v: { period: PeriodId; personId: string } | null) => void;
  catalog: PositionCatalog;
  group: ProductGroup;
  skills: SkillMatrix;
  onMove: (period: PeriodId, personId: string, station: StationId, positionId?: string) => void;
}) {
  const open = props.editing?.period === props.period && props.editing.personId === props.person.id;
  const leave = leaveKindLabel(props.person.leaveKind);
  return (
    <>
      <button
        type="button"
        onClick={() => props.setEditing(open ? null : { period: props.period, personId: props.person.id })}
        className={`rounded-md px-2 py-1 text-sm font-medium text-left ${
          props.lunch ? "bg-yellow-200 text-slate-900 hover:bg-yellow-100" : "bg-slate-800 text-slate-50 hover:bg-slate-700"
        } ${props.assignment.priority === 5 ? "ring-1 ring-rose-400" : props.assignment.priority === 4 ? "ring-1 ring-orange-400" : ""}`}
      >
        {props.person.name}
        {leave ? <span className={`ml-1 text-[11px] font-normal ${props.lunch ? "text-slate-700" : "text-amber-300"}`}>{leave}</span> : null}
      </button>
      {open && (
        <MoveMenu
          person={props.person}
          catalog={props.catalog}
          group={props.group}
          skills={props.skills}
          onPick={(station, positionId) => props.onMove(props.period, props.person.id, station, positionId)}
        />
      )}
    </>
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
    <div className="no-print absolute z-20 mt-1 left-0 max-h-64 overflow-y-auto min-w-[12rem] rounded-lg border border-slate-600 bg-slate-900 p-1 shadow-xl">
      <button type="button" onClick={() => props.onPick("lunch")} className="block w-full text-left rounded px-2 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
        식사
      </button>
      <button type="button" onClick={() => props.onPick("off")} className="block w-full text-left rounded px-2 py-1.5 text-sm text-slate-400 hover:bg-slate-800">
        휴무
      </button>
      <button type="button" onClick={() => props.onPick("unassigned")} className="block w-full text-left rounded px-2 py-1.5 text-sm text-slate-400 hover:bg-slate-800">
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
            className="block w-full text-left rounded px-2 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:text-slate-600"
          >
            {processLabel(pos.process)} · {pos.label}
            {ok ? ` [${priorityLabel(pr)}]` : " [불가]"}
          </button>
        );
      })}
    </div>
  );
}
