"use client";

import { ChevronDown, Copy, Eraser, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  getPriority,
  heatingPositions,
  isSkillConfiguredForGroup,
  setPriority,
  type GroupReadiness,
} from "@/features/production/rotation/catalog";
import {
  processNeedsStaffing,
  seatRequiredIn,
  staffingForPosition,
} from "@/features/production/rotation/staffing";
import { PRODUCT_GROUPS } from "@/features/production/rotation/seedRoster";
import { isDoughCorePerson, preferredProcess, withSkillGroupConfigured } from "@/features/production/rotation/personRules";
import { processLabel } from "@/features/production/rotation/rotationEngine";
import {
  ROTATION_QUALIFICATIONS,
  hasQualification,
  processNeedsQualifications,
  type QualificationCoverage,
} from "@/features/production/rotation/qualifications";
import { normalizeDoughSettings } from "@/features/production/rotation/doughPolicy";
import { SHIFT_OPTIONS, shiftLabel } from "@/features/production/rotation/workHours";
import {
  PERIODS,
  PRIORITY_OPTIONS,
  PROCESSES,
  type DoughSettings,
  type PeriodId,
  type Person,
  type PersonConstraints,
  type PositionCatalog,
  type Priority,
  type ProcessId,
  type ProductGroup,
  type RotationQualificationKey,
  type SkillMatrix,
} from "@/features/production/rotation/types";

export const PRIORITY_CELL: Record<Priority, string> = {
  0: "bg-slate-900 text-slate-500",
  1: "bg-cyan-950 text-cyan-200",
  2: "bg-slate-800 text-slate-200",
  3: "bg-amber-950 text-amber-200",
  4: "bg-orange-950 text-orange-200",
};

/** 배치표·범례용 주공정 색. 가열/포장/토핑/반죽을 한눈에 구분한다 */
export const PREFERRED_CHIP: Record<ProcessId, string> = {
  heating: "bg-orange-500/90 text-white ring-1 ring-orange-300/40 hover:bg-orange-400",
  heatingClose: "bg-orange-700/90 text-white ring-1 ring-orange-300/30 hover:bg-orange-600",
  inner: "bg-sky-500/90 text-white ring-1 ring-sky-300/40 hover:bg-sky-400",
  outer: "bg-sky-800/90 text-white ring-1 ring-sky-400/30 hover:bg-sky-700",
  topping: "bg-violet-500/90 text-white ring-1 ring-violet-300/40 hover:bg-violet-400",
  dough: "bg-emerald-600/90 text-white ring-1 ring-emerald-300/40 hover:bg-emerald-500",
  rnd: "bg-slate-500/90 text-white ring-1 ring-slate-300/30 hover:bg-slate-400",
  office: "bg-slate-700/90 text-slate-100 ring-1 ring-slate-400/30 hover:bg-slate-600",
};

export const PREFERRED_LEGEND: { id: ProcessId; label: string; swatch: string }[] = [
  { id: "heating", label: "가열", swatch: "bg-orange-500" },
  { id: "inner", label: "내포장", swatch: "bg-sky-500" },
  { id: "outer", label: "외포장", swatch: "bg-sky-800" },
  { id: "topping", label: "토핑", swatch: "bg-violet-500" },
  { id: "dough", label: "반죽", swatch: "bg-emerald-600" },
  { id: "office", label: "사무·기타", swatch: "bg-slate-600" },
];

const PERSON_SKILL_GROUPS: { id: ProcessId; label: string; match: (process: ProcessId) => boolean }[] = [
  { id: "heating", label: "가열", match: (p) => p === "heating" || p === "heatingClose" },
  { id: "inner", label: "포장", match: (p) => p === "inner" || p === "outer" },
  { id: "topping", label: "토핑", match: (p) => p === "topping" },
  { id: "dough", label: "반죽", match: (p) => p === "dough" },
  { id: "office", label: "기타", match: (p) => p === "rnd" || p === "office" },
];

function patchPersonRule(
  rows: Person[],
  personId: string,
  key: keyof PersonConstraints,
  value: boolean
): Person[] {
  return rows.map((row) => {
    if (row.id !== personId) return row;
    const constraints: PersonConstraints = { ...row.constraints };
    (constraints as Record<string, unknown>)[key] = value;
    return { ...row, constraints };
  });
}

function patchPreferredByGroup(rows: Person[], personId: string, group: ProductGroup, process: ProcessId): Person[] {
  return rows.map((row) => {
    if (row.id !== personId) return row;
    const byGroup = { ...row.constraints?.preferredByGroup, [group]: process };
    return { ...row, constraints: { ...row.constraints, preferredByGroup: byGroup } };
  });
}

function patchQualification(
  rows: Person[],
  personId: string,
  group: ProductGroup,
  key: RotationQualificationKey,
  value: boolean
): Person[] {
  return rows.map((row) => {
    if (row.id !== personId) return row;
    const byGroup = { ...row.constraints?.qualificationsByGroup };
    const groupQuals = { ...(byGroup[group] ?? {}) };
    if (value) groupQuals[key] = true;
    else delete groupQuals[key];
    if (Object.keys(groupQuals).length > 0) byGroup[group] = groupQuals;
    else delete byGroup[group];
    const constraints: PersonConstraints = { ...row.constraints, qualificationsByGroup: byGroup };
    if (Object.keys(byGroup).length === 0) delete constraints.qualificationsByGroup;
    return { ...row, constraints };
  });
}

function skillHeaderParts(label: string): { title: string; extra?: string } {
  const m = label.match(/^(.*?)[\(（](.+?)[\)）]\s*$/);
  if (m && m[1].trim() && m[2].trim()) return { title: m[1].trim(), extra: m[2].trim() };
  return { title: label };
}

export function CopyFromSignatureBar(props: { onCopy: (to: ProductGroup) => void; locked?: boolean }) {
  if (props.locked) return null;
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

export function ReadinessPanel(props: {
  readiness: Record<ProductGroup, GroupReadiness>;
  qualificationCoverage?: QualificationCoverage[];
}) {
  return (
    <details className="mb-2 shrink-0 rounded-xl border border-slate-700/70 bg-slate-800/40">
      <summary className="cursor-pointer px-3 py-1.5 text-sm text-slate-300">
        입력 완료 검증
        <span className="ml-2 text-xs text-slate-500">
          {PRODUCT_GROUPS.map((pg) => {
            const r = props.readiness[pg.id];
            const ok = r.primaryComplete === r.requiredCount && r.backupComplete === r.requiredCount;
            return `${pg.label} ${ok ? "완료" : `${r.primaryComplete}/${r.requiredCount}`}`;
          }).join(" · ")}
        </span>
      </summary>
      <div className="px-4 pb-4">
        <p className="text-xs text-slate-500 mb-3">
          자리마다 숙련도(상·중상·중·하)를 넣습니다. 같은 숙련은 여러 명이 가능하고, 한 사람은 여러 자리 후보가 될 수 있습니다. 점심 유지는 필수포지션마다 가능자 2명 이상이 필요합니다.
        </p>
        {props.qualificationCoverage && props.qualificationCoverage.length > 0 && (
          <ul className="mb-3 space-y-1 text-xs text-slate-300">
            {props.qualificationCoverage.map((row) => (
              <li key={row.key}>
                {row.label} 가능자 등록 {row.registered}명 / 오늘 출근 {row.present}명
                <span className="ml-2 text-slate-500">
                  반죽고정 적용 시 현장 가용 {row.presentFreeOfDoughCore}명
                  {row.presentFieldBackup > 0 ? ` · 현장백업 ${row.presentFieldBackup}명` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {PRODUCT_GROUPS.map((pg) => {
            const r = props.readiness[pg.id];
            return (
              <div key={pg.id} className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                <p className="text-sm font-semibold text-slate-200 mb-2">{pg.label}</p>
                <ul className="space-y-1 text-xs text-slate-400">
                  <li>필수포지션 {r.requiredCount}</li>
                  <li className={r.primaryComplete === r.requiredCount ? "text-cyan-200" : "text-amber-200"}>
                    상 숙련 {r.primaryComplete}/{r.requiredCount}
                  </li>
                  <li className={r.backupComplete === r.requiredCount ? "text-cyan-200" : "text-amber-200"}>
                    중상~하 {r.backupComplete}/{r.requiredCount}
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
      </div>
    </details>
  );
}

export function PositionEditor(props: {
  catalog: PositionCatalog;
  skillGroup: ProductGroup;
  setSkillGroup: (g: ProductGroup) => void;
  onAdd: (g: ProductGroup, process: ProcessId) => void;
  onRename: (g: ProductGroup, id: string, label: string) => void;
  onRemove: (g: ProductGroup, id: string) => void;
  onStaffingChange: (g: ProductGroup, id: string, period: PeriodId, field: "min" | "max", value: number) => void;
  onCopyFromSignature: (to: ProductGroup) => void;
  locked?: boolean;
}) {
  const g = props.skillGroup;
  const locked = Boolean(props.locked);
  const heats = heatingPositions(props.catalog, g);
  const heatN = heats.length;
  const expect = g === "phono_ricotta" ? 8 : 7;
  const heatPeriods = PERIODS.filter((period) =>
    heats.some((pos) => staffingForPosition(pos, period.id).max > 0)
  );
  const heatMixed = heatPeriods.some((period) => {
    if (heats.length === 0) return false;
    const first = seatRequiredIn(heats[0], period.id);
    return heats.some((pos) => seatRequiredIn(pos, period.id) !== first);
  });
  const staffedRows = props.catalog[g].filter((p) => processNeedsStaffing(p.process));
  const otherProcesses = PROCESSES.filter((p) => p.id !== "heating" && !processNeedsStaffing(p.id));

  const setHeatRequired = (period: PeriodId, required: boolean) => {
    for (const pos of heats) {
      props.onStaffingChange(g, pos.id, period, "min", required ? 1 : 0);
    }
  };

  return (
    <section className="mb-6 flex min-h-0 flex-1 flex-col overflow-auto rounded-xl border border-slate-700/70 bg-slate-800/30 p-4">
      <div className="mb-3 flex flex-wrap gap-1.5">
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
      <CopyFromSignatureBar onCopy={props.onCopyFromSignature} locked={locked} />
      <p className="mb-4 text-sm text-slate-400">
        가열은 자리마다 같은 필수·선택을 한 번에 두고, 인원수 공정은 아래 표에서 시간대별로 맞춥니다.
        가열 자리 {heatN}개 (기본 {expect}개)
        {heatN !== expect ? ` · 지금 ${heatN}개라 기본과 다릅니다.` : ""}
        {heatMixed ? " · 자리마다 필수/선택이 달라서 첫 자리 기준으로 보입니다. 바꾸면 전 자리에 같이 적용됩니다." : ""}
      </p>

      <div className="mb-5 rounded-xl border border-orange-500/20 bg-orange-500/5 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-orange-100">가열 · 시간대 필수/선택 (전 자리 공통)</p>
          {!locked && (
            <button
              type="button"
              onClick={() => props.onAdd(g, "heating")}
              className="inline-flex items-center gap-1 text-sm text-cyan-300 hover:text-cyan-200"
            >
              <Plus className="w-4 h-4" /> 자리 추가
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-xs">
            <thead>
              <tr className="text-slate-500">
                {heatPeriods.map((period) => (
                  <th key={period.id} className="px-1.5 py-1.5 text-center font-medium">
                    <span className="block">{period.short}</span>
                    <span className="block text-[10px] font-normal text-slate-600">{period.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {heatPeriods.map((period) => {
                  const required = heats[0] ? seatRequiredIn(heats[0], period.id) : true;
                  return (
                    <td key={period.id} className="px-1.5 py-1.5 text-center">
                      <div className="inline-flex overflow-hidden rounded border border-slate-600">
                        {[
                          { value: true, label: "필수" },
                          { value: false, label: "선택" },
                        ].map((option) => (
                          <button
                            key={option.label}
                            type="button"
                            disabled={locked || heats.length === 0}
                            onClick={() => setHeatRequired(period.id, option.value)}
                            className={`px-2 py-1 ${
                              required === option.value
                                ? option.value
                                  ? "bg-cyan-950/60 text-cyan-100"
                                  : "bg-slate-700/60 text-slate-200"
                                : "text-slate-500"
                            } disabled:cursor-not-allowed`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {heats.map((pos) => (
            <li key={pos.id} className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/40 px-2 py-1.5">
              <input
                value={pos.label}
                disabled={locked}
                onChange={(e) => props.onRename(g, pos.id, e.target.value)}
                className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm text-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
              />
              {!locked && (
                <button type="button" onClick={() => props.onRemove(g, pos.id)} className="text-slate-500 hover:text-rose-300" aria-label="삭제">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
          {heats.length === 0 && <li className="text-sm text-slate-500">가열 자리 없음</li>}
        </ul>
      </div>

      <div className="mb-5">
        <p className="mb-2 text-sm font-semibold text-slate-200">인원수 · 시간대별 최소/최대</p>
        <div className="overflow-x-auto rounded-xl border border-slate-700/80 bg-slate-900/30">
          <table className="w-full min-w-[52rem] text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="sticky left-0 z-10 bg-slate-900 px-3 py-2 text-left font-medium">공정 / 자리</th>
                {PERIODS.map((period) => (
                  <th key={period.id} className="px-1.5 py-2 text-center font-medium" colSpan={2}>
                    <span className="block">{period.short}</span>
                    <span className="block text-[10px] font-normal text-slate-600">{period.label}</span>
                    <span className="mt-0.5 flex justify-center gap-3 text-[10px] font-normal text-slate-600">
                      <span>최소</span>
                      <span>최대</span>
                    </span>
                  </th>
                ))}
                <th className="px-2 py-2 text-center font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {staffedRows.map((pos) => {
                const rangeOf = (period: PeriodId) => pos.staffing?.[period] ?? { min: 0, max: 0 };
                return (
                  <tr key={pos.id} className="border-t border-slate-800/80 odd:bg-slate-900/20">
                    <td className="sticky left-0 z-10 bg-slate-950 px-3 py-1.5">
                      <span className="mb-0.5 block text-[10px] text-slate-500">{processLabel(pos.process)}</span>
                      <input
                        value={pos.label}
                        disabled={locked}
                        onChange={(e) => props.onRename(g, pos.id, e.target.value)}
                        className="w-full min-w-[7rem] rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                      />
                    </td>
                    {PERIODS.map((period) => {
                      const range = rangeOf(period.id);
                      return (
                        <td key={period.id} className="px-1 py-1.5 text-center" colSpan={2}>
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={20}
                              value={range.min}
                              disabled={locked}
                              onChange={(e) => props.onStaffingChange(g, pos.id, period.id, "min", Number(e.target.value))}
                              className="w-12 rounded border border-slate-600 bg-slate-950 px-1 py-1 text-center text-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                              aria-label={`${pos.label} ${period.short} 최소`}
                            />
                            <input
                              type="number"
                              min={0}
                              max={20}
                              value={range.max}
                              disabled={locked}
                              onChange={(e) => props.onStaffingChange(g, pos.id, period.id, "max", Number(e.target.value))}
                              className="w-12 rounded border border-slate-600 bg-slate-950 px-1 py-1 text-center text-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                              aria-label={`${pos.label} ${period.short} 최대`}
                            />
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-center">
                      {!locked && (
                        <button type="button" onClick={() => props.onRemove(g, pos.id)} className="text-slate-500 hover:text-rose-300" aria-label="삭제">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {staffedRows.length === 0 && (
                <tr>
                  <td colSpan={1 + PERIODS.length * 2 + 1} className="px-3 py-4 text-sm text-slate-500">
                    인원수 자리가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!locked && (
          <div className="mt-2 flex flex-wrap gap-2">
            {PROCESSES.filter((p) => processNeedsStaffing(p.id)).map((process) => (
              <button
                key={process.id}
                type="button"
                onClick={() => props.onAdd(g, process.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                <Plus className="w-3.5 h-3.5" /> {process.label} 추가
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {otherProcesses.map((process) => {
          const list = props.catalog[g].filter((p) => p.process === process.id);
          return (
            <div key={process.id} className="rounded-xl border border-slate-700/80 bg-slate-900/30 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-200">{process.label}</p>
                {!locked && (
                  <button
                    type="button"
                    onClick={() => props.onAdd(g, process.id)}
                    className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200"
                  >
                    <Plus className="w-3.5 h-3.5" /> 추가
                  </button>
                )}
              </div>
              {process.id === "rnd" && <p className="mb-2 text-[11px] text-slate-500">R&D는 인원수 산정에서 제외합니다.</p>}
              <ul className="space-y-1.5">
                {list.map((pos) => (
                  <li key={pos.id} className="flex items-center gap-2">
                    <input
                      value={pos.label}
                      disabled={locked}
                      onChange={(e) => props.onRename(g, pos.id, e.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm text-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                    />
                    {!locked && (
                      <button type="button" onClick={() => props.onRemove(g, pos.id)} className="text-slate-500 hover:text-rose-300" aria-label="삭제">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </li>
                ))}
                {list.length === 0 && <li className="text-xs text-slate-500">없음</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DoughSettingsEditor(props: {
  catalog: PositionCatalog;
  skillGroup: ProductGroup;
  dough: DoughSettings | undefined;
  onChange: (next: DoughSettings) => void;
  locked?: boolean;
}) {
  const locked = Boolean(props.locked);
  const normalized = normalizeDoughSettings(props.dough, props.catalog, props.skillGroup);
  return (
    <section className="mb-2 shrink-0 rounded-xl border border-slate-700/70 bg-slate-800/40 px-3 py-2">
      <div className="flex flex-wrap items-end gap-3">
        <p className="mb-2 mr-2 text-sm font-medium text-slate-200">반죽팀</p>
        <label className="text-xs text-slate-300">
          <span className="mb-1 block text-slate-400">운영 정책</span>
          <select
            value={normalized.rotationPolicy}
            disabled={locked}
            onChange={(e) =>
              props.onChange({
                minStaff: normalized.minStaff,
                rotationPolicy: e.target.value === "FIXED_DOUGH" ? "FIXED_DOUGH" : "CURRENT_LUNCH_BACKUP",
              })
            }
            className="rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 disabled:opacity-70"
          >
            <option value="CURRENT_LUNCH_BACKUP">점심 백업 (11시 가열→12시 식사→13시 반죽)</option>
            <option value="FIXED_DOUGH">전일 반죽고정</option>
          </select>
        </label>
        <label className="text-xs text-slate-300">
          <span className="mb-1 block text-slate-400">반죽 최소 인원</span>
          <input
            type="number"
            min={0}
            max={20}
            value={normalized.minStaff}
            disabled={locked}
            onChange={(e) =>
              props.onChange({
                minStaff: Number(e.target.value),
                rotationPolicy: normalized.rotationPolicy,
              })
            }
            className="w-20 rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 disabled:opacity-70"
          />
        </label>
      </div>
    </section>
  );
}

function skillSummaryLabel(
  person: Person,
  skills: SkillMatrix,
  catalog: PositionCatalog,
  group: ProductGroup
): string {
  if (!isSkillConfiguredForGroup(skills, person, catalog, group)) return "미설정";
  const ranks = catalog[group]
    .map((pos) => getPriority(skills, person.id, group, pos.id))
    .filter((rank) => rank > 0);
  if (ranks.length === 0) return "전부 불가";
  const best = Math.min(...ranks);
  const bestLabel = PRIORITY_OPTIONS.find((o) => o.value === best)?.short ?? String(best);
  return `${ranks.length}자리 · 최고 ${bestLabel}`;
}

function applyRanksToPositions(
  skills: SkillMatrix,
  personId: string,
  group: ProductGroup,
  positionIds: string[],
  rank: Priority
): SkillMatrix {
  let next = skills;
  for (const positionId of positionIds) {
    next = setPriority(next, personId, group, positionId, rank);
  }
  return next;
}

function copyGroupSkills(
  skills: SkillMatrix,
  fromId: string,
  toId: string,
  group: ProductGroup,
  catalog: PositionCatalog
): SkillMatrix {
  let next = skills;
  for (const pos of catalog[group]) {
    next = setPriority(next, toId, group, pos.id, getPriority(skills, fromId, group, pos.id));
  }
  return next;
}

export function SkillMatrixEditor(props: {
  roster: Person[];
  setRoster: Dispatch<SetStateAction<Person[]>>;
  catalog: PositionCatalog;
  skills: SkillMatrix;
  setSkills: Dispatch<SetStateAction<SkillMatrix>>;
  skillGroup: ProductGroup;
  setSkillGroup: (g: ProductGroup) => void;
  onCopyFromSignature: (to: ProductGroup) => void;
  onResetGroupSkills: (g: ProductGroup) => void;
  onRankError: (message: string | null) => void;
  locked?: boolean;
}) {
  const g = props.skillGroup;
  const locked = Boolean(props.locked);
  const showQualifications = processNeedsQualifications("inner", g);
  const [personQuery, setPersonQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [copyTargetId, setCopyTargetId] = useState("");
  const positions = props.catalog[g];
  const visibleRoster = useMemo(() => {
    const q = personQuery.trim().toLowerCase();
    if (!q) return props.roster;
    return props.roster.filter((person) => person.name.toLowerCase().includes(q));
  }, [props.roster, personQuery]);

  const markConfigured = (personId: string) => {
    props.setRoster((rows) => withSkillGroupConfigured(rows, personId, g));
  };

  const setPersonRank = (personId: string, positionId: string, rank: Priority) => {
    props.onRankError(null);
    props.setSkills(setPriority(props.skills, personId, g, positionId, rank));
    markConfigured(personId);
  };

  const fillPreferredOnly = (person: Person) => {
    const preferred = preferredProcess(person, g);
    const preferredIds = positions.filter((p) => p.process === preferred).map((p) => p.id);
    const otherIds = positions.filter((p) => p.process !== preferred).map((p) => p.id);
    let next = applyRanksToPositions(props.skills, person.id, g, otherIds, 0);
    next = applyRanksToPositions(next, person.id, g, preferredIds, 1);
    props.onRankError(null);
    props.setSkills(next);
    markConfigured(person.id);
  };

  const fillProcessRank = (personId: string, match: (process: ProcessId) => boolean, rank: Priority) => {
    const ids = positions.filter((p) => match(p.process)).map((p) => p.id);
    if (ids.length === 0) return;
    props.onRankError(null);
    props.setSkills(applyRanksToPositions(props.skills, personId, g, ids, rank));
    markConfigured(personId);
  };

  const copyToPerson = (fromId: string) => {
    if (!copyTargetId || copyTargetId === fromId) return;
    const target = props.roster.find((p) => p.id === copyTargetId);
    if (!target) return;
    if (!window.confirm(`${target.name}에게 이 제품군 숙련을 덮어쓸까요?`)) return;
    props.onRankError(null);
    props.setSkills(copyGroupSkills(props.skills, fromId, copyTargetId, g, props.catalog));
    markConfigured(copyTargetId);
    setCopyTargetId("");
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-700/70 bg-slate-800/30">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 py-2">
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
      <div className="shrink-0 px-3 py-1">
        <CopyFromSignatureBar onCopy={props.onCopyFromSignature} locked={locked} />
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            value={personQuery}
            onChange={(e) => setPersonQuery(e.target.value)}
            placeholder="이름 검색"
            className="w-40 rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <p className="text-xs text-slate-500">이름을 누르면 숙련이 펼쳐집니다.</p>
          {!locked && (
            <button
              type="button"
              onClick={() => props.onResetGroupSkills(g)}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-800 bg-slate-900 px-2.5 py-1.5 text-xs text-rose-200 hover:bg-rose-950/40"
            >
              <Eraser className="w-3.5 h-3.5" /> 전원 초기화
            </button>
          )}
        </div>
      </div>
      <details className="shrink-0 px-3 pb-2">
        <summary className="cursor-pointer text-xs text-slate-500">숙련·조건 안내</summary>
        <p className="mt-1 text-xs text-slate-400">
          사람마다 펼쳐서 숙련을 넣습니다. 빠른 채우기로 주공정만 상·가열 일괄 등을 쓸 수 있습니다.
          조·조건(주공정만·반죽고정 등)은 전 제품군 공통이고, 주공정과 자격은 현재 탭 제품군에만 적용됩니다.
        </p>
      </details>

      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        <ul className="space-y-1.5">
          {visibleRoster.map((person) => {
            const open = openId === person.id;
            const excluded = Boolean(person.constraints?.excluded);
            const preferred = preferredProcess(person, g);
            const summary = skillSummaryLabel(person, props.skills, props.catalog, g);
            return (
              <li
                key={person.id}
                className={`rounded-xl border border-slate-700/80 bg-slate-900/40 ${excluded ? "opacity-50" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : person.id)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                >
                  <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition ${open ? "rotate-0" : "-rotate-90"}`} />
                  <span className="min-w-[5.5rem] text-base font-semibold text-slate-50">{person.name}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${PREFERRED_CHIP[preferred] ?? PREFERRED_CHIP.office}`}>
                    {processLabel(preferred)}
                  </span>
                  <span className="text-xs text-slate-400">{shiftLabel(person.shift)}</span>
                  <span className={`ml-auto text-xs ${summary === "미설정" ? "text-amber-300" : "text-slate-400"}`}>
                    {summary}
                  </span>
                </button>

                {open && (
                  <div className="space-y-3 border-t border-slate-800 px-3 py-3">
                    <div className="grid gap-2 md:grid-cols-[minmax(0,12rem)_minmax(0,9rem)_1fr]">
                      <label className="text-xs text-slate-400">
                        주공정
                        <select
                          value={preferred}
                          disabled={locked}
                          onChange={(e) =>
                            props.setRoster((rows) =>
                              patchPreferredByGroup(rows, person.id, g, e.target.value as ProcessId)
                            )
                          }
                          className="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-slate-200 disabled:opacity-70"
                        >
                          {PROCESSES.map((process) => (
                            <option key={process.id} value={process.id}>
                              {process.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-400">
                        조
                        <select
                          value={person.shift}
                          disabled={locked}
                          onChange={(e) =>
                            props.setRoster((rows) =>
                              rows.map((r) => (r.id === person.id ? { ...r, shift: e.target.value as Person["shift"] } : r))
                            )
                          }
                          className="mt-1 w-full rounded-md border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-slate-200 disabled:opacity-70"
                        >
                          {SHIFT_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                          {SHIFT_OPTIONS.every((o) => o.id !== person.shift) && (
                            <option value={person.shift}>{shiftLabel(person.shift)}</option>
                          )}
                        </select>
                      </label>
                      <div className="text-xs text-slate-400">
                        조건
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 rounded-md border border-slate-700 bg-slate-950/60 px-2 py-2">
                          {(
                            [
                              ["lockPreferred", "주공정만"],
                              ["stayFloor", "층고정"],
                              ["excluded", "제외"],
                              ["doughCore", "반죽고정"],
                              ["fieldBackup", "현장백업"],
                              ["nightShiftBackup", "09~19 대체"],
                            ] as const
                          ).map(([key, label]) => (
                            <label
                              key={key}
                              className={`inline-flex items-center gap-1 text-[11px] ${key === "excluded" ? "text-rose-200" : "text-slate-300"}`}
                            >
                              <input
                                type="checkbox"
                                checked={
                                  key === "doughCore"
                                    ? isDoughCorePerson(person)
                                    : Boolean(person.constraints?.[key])
                                }
                                disabled={locked}
                                onChange={(e) =>
                                  props.setRoster((rows) => patchPersonRule(rows, person.id, key, e.target.checked))
                                }
                                className={key === "excluded" ? "accent-rose-500" : "accent-cyan-500"}
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>

                    {showQualifications && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300">
                        <span className="text-slate-500">자격(이 제품군)</span>
                        {ROTATION_QUALIFICATIONS.map((q) => (
                          <label key={q.key} className="inline-flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={hasQualification(person, q.key, g)}
                              disabled={locked}
                              onChange={(e) =>
                                props.setRoster((rows) => patchQualification(rows, person.id, g, q.key, e.target.checked))
                              }
                              className="accent-cyan-500"
                            />
                            {q.label}
                          </label>
                        ))}
                      </div>
                    )}

                    {!locked && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] text-slate-500">빠른 채우기</span>
                        <button
                          type="button"
                          onClick={() => fillPreferredOnly(person)}
                          className="rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800"
                        >
                          주공정만 상
                        </button>
                        {PERSON_SKILL_GROUPS.filter((group) => positions.some((p) => group.match(p.process))).map((group) => (
                          <div key={group.id} className="inline-flex overflow-hidden rounded-md border border-slate-600">
                            <span className="bg-slate-800 px-2 py-1 text-[11px] text-slate-400">{group.label}</span>
                            {([1, 2, 3, 4, 0] as Priority[]).map((rank) => (
                              <button
                                key={rank}
                                type="button"
                                onClick={() => fillProcessRank(person.id, group.match, rank)}
                                className={`border-l border-slate-700 px-1.5 py-1 text-[11px] ${PRIORITY_CELL[rank]} hover:brightness-125`}
                                title={`${group.label} 전부 ${PRIORITY_OPTIONS.find((o) => o.value === rank)?.short}`}
                              >
                                {PRIORITY_OPTIONS.find((o) => o.value === rank)?.short}
                              </button>
                            ))}
                          </div>
                        ))}
                        <div className="ml-auto flex flex-wrap items-center gap-1.5">
                          <select
                            value={copyTargetId}
                            onChange={(e) => setCopyTargetId(e.target.value)}
                            className="rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-[11px] text-slate-200"
                          >
                            <option value="">숙련 복사 대상…</option>
                            {props.roster
                              .filter((p) => p.id !== person.id)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            disabled={!copyTargetId}
                            onClick={() => copyToPerson(person.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                          >
                            <Copy className="h-3 w-3" /> 복사
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      {PERSON_SKILL_GROUPS.map((group) => {
                        const rows = positions.filter((p) => group.match(p.process));
                        if (rows.length === 0) return null;
                        return (
                          <div key={group.id}>
                            <p className="mb-1.5 text-xs font-semibold text-slate-300">{group.label}</p>
                            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                              {rows.map((pos) => {
                                const v = getPriority(props.skills, person.id, g, pos.id);
                                const parts = skillHeaderParts(pos.label);
                                return (
                                  <label
                                    key={pos.id}
                                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-700/80 bg-slate-950/50 px-2.5 py-2"
                                  >
                                    <span className="min-w-0">
                                      <span className="block truncate text-sm text-slate-100">{parts.title}</span>
                                      <span className="block text-[10px] text-slate-500">
                                        {processLabel(pos.process)}
                                        {parts.extra ? ` · ${parts.extra}` : ""}
                                      </span>
                                    </span>
                                    <select
                                      value={v}
                                      disabled={locked}
                                      onChange={(e) => setPersonRank(person.id, pos.id, Number(e.target.value) as Priority)}
                                      className={`w-[4.5rem] shrink-0 rounded-md border border-slate-700 px-1 py-1.5 text-sm font-medium disabled:cursor-not-allowed ${PRIORITY_CELL[v]}`}
                                    >
                                      {PRIORITY_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value}>
                                          {o.short}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          {visibleRoster.length === 0 && (
            <li className="rounded-xl border border-dashed border-slate-700 px-3 py-8 text-center text-sm text-slate-500">
              검색 결과가 없습니다.
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

