"use client";

import { Copy, Plus, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import {
  getPriority,
  heatingPositions,
  setPriority,
  type GroupReadiness,
} from "@/features/production/rotation/catalog";
import { processNeedsStaffing } from "@/features/production/rotation/staffing";
import { PRODUCT_GROUPS } from "@/features/production/rotation/seedRoster";
import { processLabel } from "@/features/production/rotation/rotationEngine";
import {
  PERIODS,
  PRIORITY_OPTIONS,
  PROCESSES,
  type PeriodId,
  type Person,
  type PositionCatalog,
  type PositionDef,
  type Priority,
  type ProcessId,
  type ProductGroup,
  type SkillMatrix,
} from "@/features/production/rotation/types";

export const PRIORITY_CELL: Record<Priority, string> = {
  0: "bg-slate-900 text-slate-500",
  1: "bg-cyan-950 text-cyan-200",
  2: "bg-slate-800 text-slate-200",
  3: "bg-amber-950 text-amber-200",
  4: "bg-orange-950 text-orange-200",
  5: "bg-rose-950 text-rose-200",
};

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

export function ReadinessPanel(props: { readiness: Record<ProductGroup, GroupReadiness> }) {
  return (
    <details className="mb-3 shrink-0 rounded-xl border border-slate-700/70 bg-slate-800/40">
      <summary className="cursor-pointer px-4 py-2.5 text-sm text-slate-300">
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
  const heatN = heatingPositions(props.catalog, g).length;
  const expect = g === "phono_ricotta" ? 8 : 7;
  return (
    <section className="mb-6 flex min-h-0 flex-1 flex-col overflow-auto rounded-xl border border-slate-700/70 bg-slate-800/30 p-4">
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
      <CopyFromSignatureBar onCopy={props.onCopyFromSignature} locked={locked} />
      <p className="text-sm text-slate-400 mb-4">
        가열 필수 포지션 {heatN}개 (리코타는 8, 그 외 7이 기본). 내포장·외포장·토핑·반죽·반죽 마감·사무는 시간대별 최소·최대 인원을 둡니다. 가열은 자리당 1명이라 인원수를 두지 않고, R&D는 제외합니다.
        {heatN !== expect ? ` 현재 가열 ${heatN}개라 기본 ${expect}개와 다릅니다.` : ""}
      </p>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {PROCESSES.map((process) => {
        const list = props.catalog[g].filter((p) => p.process === process.id);
        const needsStaff = processNeedsStaffing(process.id);
        return (
          <div key={process.id}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-base font-medium text-slate-200">{process.label}</p>
              {!locked && (
                <button
                  type="button"
                  onClick={() => props.onAdd(g, process.id)}
                  className="inline-flex items-center gap-1 text-sm text-cyan-300 hover:text-cyan-200"
                >
                  <Plus className="w-4 h-4" /> 추가
                </button>
              )}
            </div>
            {process.id === "heating" && (
              <p className="mb-2 text-xs text-slate-500">자리당 1명이라 인원수 설정이 없습니다.</p>
            )}
            {process.id === "rnd" && (
              <p className="mb-2 text-xs text-slate-500">R&D는 인원수 설정에서 제외합니다.</p>
            )}
            <ul className="space-y-3">
              {list.map((pos) => (
                <li key={pos.id} className="rounded-lg border border-slate-700/80 bg-slate-900/40 p-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      value={pos.label}
                      disabled={locked}
                      onChange={(e) => props.onRename(g, pos.id, e.target.value)}
                      className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                    />
                    {!locked && (
                      <button type="button" onClick={() => props.onRemove(g, pos.id)} className="text-slate-500 hover:text-rose-300" aria-label="삭제">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {needsStaff && (
                    <PositionStaffingFields
                      position={pos}
                      locked={locked}
                      onChange={(period, field, value) => props.onStaffingChange(g, pos.id, period, field, value)}
                    />
                  )}
                </li>
              ))}
              {list.length === 0 && <li className="text-sm text-slate-500">없음</li>}
            </ul>
          </div>
        );
      })}
      </div>
    </section>
  );
}

function PositionStaffingFields(props: {
  position: PositionDef;
  locked: boolean;
  onChange: (period: PeriodId, field: "min" | "max", value: number) => void;
}) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500">
            <th className="py-1 pr-2 text-left font-medium">시간대</th>
            <th className="px-1 py-1 text-center font-medium">최소</th>
            <th className="px-1 py-1 text-center font-medium">최대</th>
          </tr>
        </thead>
        <tbody>
          {PERIODS.map((period) => {
            const range = props.position.staffing?.[period.id] ?? { min: 0, max: 0 };
            return (
              <tr key={period.id}>
                <td className="py-1 pr-2 text-slate-400 whitespace-nowrap">
                  {period.short}
                  <span className="ml-1 text-[10px] text-slate-600">{period.label}</span>
                </td>
                <td className="px-1 py-1">
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={range.min}
                    disabled={props.locked}
                    onChange={(e) => props.onChange(period.id, "min", Number(e.target.value))}
                    className="w-14 rounded border border-slate-600 bg-slate-950 px-1.5 py-1 text-center text-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                    aria-label={`${period.short} 최소`}
                  />
                </td>
                <td className="px-1 py-1">
                  <input
                    type="number"
                    min={0}
                    max={20}
                    value={range.max}
                    disabled={props.locked}
                    onChange={(e) => props.onChange(period.id, "max", Number(e.target.value))}
                    className="w-14 rounded border border-slate-600 bg-slate-950 px-1.5 py-1 text-center text-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                    aria-label={`${period.short} 최대`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
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
  onRankError: (message: string | null) => void;
  locked?: boolean;
}) {
  const g = props.skillGroup;
  const locked = Boolean(props.locked);
  const cols = props.catalog[g];
  const heat = cols.filter((p) => p.process === "heating");
  const rest = cols.filter((p) => p.process !== "heating");
  const ordered = [...heat, ...rest];

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-700/70 bg-slate-800/30">
      <div className="shrink-0 px-4 py-3 flex flex-wrap gap-1.5">
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
      <div className="shrink-0 px-4">
        <CopyFromSignatureBar onCopy={props.onCopyFromSignature} locked={locked} />
      </div>
      <p className="shrink-0 px-4 pb-3 text-sm text-slate-400">
        상부터 배치하고, 비상은 최소 인원을 숙련자로 못 채울 때만 넣습니다. 불가는 배치하지 않습니다. 같은 숙련은 여러 명이 가능합니다.
        이 제품군에서 숙련을 하나도 넣지 않은 사람(미입사·본사 공유 등)은 당일 배치표에 나오지 않습니다.
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 bg-slate-900 px-3 py-3 text-left text-slate-300 font-medium min-w-[7rem] shadow-[0_1px_0_0_#334155]">이름</th>
              <th className="sticky top-0 z-20 bg-slate-900 px-2 py-3 text-left text-slate-300 font-medium min-w-[7.5rem] shadow-[0_1px_0_0_#334155]">주공정</th>
              <th className="sticky top-0 z-20 bg-slate-900 px-2 py-3 text-left text-slate-300 font-medium min-w-[6.5rem] shadow-[0_1px_0_0_#334155]">조</th>
              {ordered.map((pos) => (
                <th
                  key={pos.id}
                  className="sticky top-0 z-20 bg-slate-900 px-1.5 py-3 text-center text-slate-200 font-medium whitespace-nowrap shadow-[0_1px_0_0_#334155]"
                >
                  <span className="block text-[11px] font-normal text-slate-500">{processLabel(pos.process)}</span>
                  {pos.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.roster.map((person) => (
              <tr key={person.id} className="border-t border-slate-800">
                <td className="sticky left-0 z-10 bg-slate-900 px-3 py-2 text-slate-50 whitespace-nowrap font-semibold text-base border-t border-slate-800">
                  {person.name}
                </td>
                <td className="px-2 py-2 border-t border-slate-800">
                  <select
                    value={person.preferred}
                    disabled={locked}
                    onChange={(e) =>
                      props.setRoster((rows) =>
                        rows.map((r) => (r.id === person.id ? { ...r, preferred: e.target.value as Person["preferred"] } : r))
                      )
                    }
                    className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {PROCESSES.map((process) => (
                      <option key={process.id} value={process.id}>{process.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2 border-t border-slate-800">
                  <select
                    value={person.shift}
                    disabled={locked}
                    onChange={(e) =>
                      props.setRoster((rows) =>
                        rows.map((r) => (r.id === person.id ? { ...r, shift: e.target.value as Person["shift"] } : r))
                      )
                    }
                    className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <option value="0800-1800">08–18</option>
                    <option value="0900-1900">09–19</option>
                  </select>
                </td>
                {ordered.map((pos) => {
                  const v = getPriority(props.skills, person.id, g, pos.id);
                  return (
                    <td key={pos.id} className="px-1 py-1.5 text-center border-t border-slate-800">
                      <select
                        value={v}
                        disabled={locked}
                        onChange={(e) => {
                          const n = Number(e.target.value) as Priority;
                          props.onRankError(null);
                          props.setSkills(setPriority(props.skills, person.id, g, pos.id, n));
                        }}
                        className={`w-full min-h-10 rounded-md border border-slate-700 px-1 py-2 text-sm font-medium disabled:cursor-not-allowed ${PRIORITY_CELL[v]}`}
                      >
                        {PRIORITY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.short}
                          </option>
                        ))}
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
