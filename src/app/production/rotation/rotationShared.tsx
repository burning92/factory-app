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
import { isDoughCorePerson, withSkillGroupConfigured } from "@/features/production/rotation/personRules";
import { processLabel } from "@/features/production/rotation/rotationEngine";
import {
  ROTATION_QUALIFICATIONS,
  type QualificationCoverage,
} from "@/features/production/rotation/qualifications";
import { normalizeDoughSettings } from "@/features/production/rotation/doughPolicy";
import {
  PERIODS,
  PRIORITY_OPTIONS,
  PROCESSES,
  type DoughSettings,
  type PeriodId,
  type Person,
  type PersonConstraints,
  type PositionCatalog,
  type PositionDef,
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
  5: "bg-rose-950 text-rose-200",
};

function patchPersonRule(
  rows: Person[],
  personId: string,
  key: keyof PersonConstraints,
  value: boolean
): Person[] {
  return rows.map((row) => {
    if (row.id !== personId) return row;
    const constraints: PersonConstraints = { ...row.constraints };
    if (key === "qualifications") return row;
    (constraints as Record<string, unknown>)[key] = value;
    return { ...row, constraints };
  });
}

function patchQualification(rows: Person[], personId: string, key: RotationQualificationKey, value: boolean): Person[] {
  return rows.map((row) => {
    if (row.id !== personId) return row;
    const qualifications = { ...row.constraints?.qualifications };
    if (value) qualifications[key] = true;
    else delete qualifications[key];
    const constraints: PersonConstraints = { ...row.constraints, qualifications };
    if (Object.keys(qualifications).length === 0) delete constraints.qualifications;
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
            <option value="CURRENT_LUNCH_BACKUP">현행 점심 가열 백업</option>
            <option value="FIXED_DOUGH">전일 반죽고정 (향후)</option>
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
      <div className="shrink-0 px-3 py-2 flex flex-wrap items-center gap-1.5">
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
      </div>
      <details className="shrink-0 px-3 pb-2">
        <summary className="cursor-pointer text-xs text-slate-500">숙련·조건 안내</summary>
        <p className="mt-1 text-xs text-slate-400">
          상부터 배치하고, 비상은 최소 인원을 숙련자로 못 채울 때만 넣습니다. 불가는 자동배치하지 않습니다. 같은 숙련은 여러 명이 가능합니다.
          숙련을 아직 넣지 않은 출근자는 당일 표의 미배치에 남습니다. 제외를 켜면 숙련표에는 남고 당일 표에서는 빠집니다.
          사람마다 조건과 자격을 따로 둡니다. 조건: 주공정만·층고정·제외·반죽고정·현장백업. 자격: 삼면포장기 관리처럼 기계 가능 여부. 엔진은 이름이 아니라 이 값만 봅니다.
        </p>
      </details>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-30 bg-slate-900 px-3 py-3 text-left text-slate-300 font-medium min-w-[7rem] shadow-[0_1px_0_0_#334155]">이름</th>
              <th className="sticky top-0 z-20 bg-slate-900 px-2 py-3 text-left text-slate-300 font-medium min-w-[7.5rem] shadow-[0_1px_0_0_#334155]">주공정</th>
              <th className="sticky top-0 z-20 bg-slate-900 px-2 py-3 text-left text-slate-300 font-medium min-w-[6.5rem] shadow-[0_1px_0_0_#334155]">조</th>
              <th className="sticky top-0 z-20 bg-slate-900 px-2 py-3 text-left text-slate-300 font-medium min-w-[10.5rem] shadow-[0_1px_0_0_#334155]">조건</th>
              <th className="sticky top-0 z-20 bg-slate-900 px-2 py-3 text-left text-slate-300 font-medium min-w-[8.5rem] shadow-[0_1px_0_0_#334155]">자격</th>
              {ordered.map((pos) => {
                const parts = skillHeaderParts(pos.label);
                return (
                  <th
                    key={pos.id}
                    className="sticky top-0 z-20 bg-slate-900 px-1.5 py-2.5 text-center text-slate-200 font-medium align-bottom min-w-[6.75rem] max-w-[7.5rem] shadow-[0_1px_0_0_#334155]"
                  >
                    <span className="block text-[10px] font-normal leading-tight text-slate-500">{processLabel(pos.process)}</span>
                    <span className="mt-0.5 block text-[12px] font-medium leading-snug break-keep whitespace-normal">
                      {parts.title}
                      {parts.extra ? (
                        <span className="mt-0.5 block text-[10px] font-normal leading-tight text-slate-400">({parts.extra})</span>
                      ) : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {props.roster.map((person) => {
              const excluded = Boolean(person.constraints?.excluded);
              return (
              <tr key={person.id} className={`border-t border-slate-800 ${excluded ? "opacity-50" : ""}`}>
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
                <td className="px-2 py-1.5 border-t border-slate-800">
                  <div className="flex min-w-[12rem] flex-wrap gap-x-2 gap-y-0.5">
                    <label className="inline-flex items-center gap-1 text-[11px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(person.constraints?.lockPreferred)}
                        disabled={locked}
                        onChange={(e) =>
                          props.setRoster((rows) => patchPersonRule(rows, person.id, "lockPreferred", e.target.checked))
                        }
                        className="accent-cyan-500"
                      />
                      주공정만
                    </label>
                    <label className="inline-flex items-center gap-1 text-[11px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(person.constraints?.stayFloor)}
                        disabled={locked}
                        onChange={(e) =>
                          props.setRoster((rows) => patchPersonRule(rows, person.id, "stayFloor", e.target.checked))
                        }
                        className="accent-cyan-500"
                      />
                      층고정
                    </label>
                    <label className="inline-flex items-center gap-1 text-[11px] text-rose-200">
                      <input
                        type="checkbox"
                        checked={excluded}
                        disabled={locked}
                        onChange={(e) =>
                          props.setRoster((rows) => patchPersonRule(rows, person.id, "excluded", e.target.checked))
                        }
                        className="accent-rose-500"
                      />
                      제외
                    </label>
                    <label className="inline-flex items-center gap-1 text-[11px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={isDoughCorePerson(person)}
                        disabled={locked}
                        onChange={(e) =>
                          props.setRoster((rows) => patchPersonRule(rows, person.id, "doughCore", e.target.checked))
                        }
                        className="accent-cyan-500"
                      />
                      반죽고정
                    </label>
                    <label className="inline-flex items-center gap-1 text-[11px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(person.constraints?.fieldBackup)}
                        disabled={locked}
                        onChange={(e) =>
                          props.setRoster((rows) => patchPersonRule(rows, person.id, "fieldBackup", e.target.checked))
                        }
                        className="accent-cyan-500"
                      />
                      현장백업
                    </label>
                  </div>
                </td>
                <td className="px-2 py-1.5 border-t border-slate-800">
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {ROTATION_QUALIFICATIONS.map((q) => (
                      <label key={q.key} className="inline-flex items-center gap-1 text-[11px] text-slate-300">
                        <input
                          type="checkbox"
                          checked={person.constraints?.qualifications?.[q.key] === true}
                          disabled={locked}
                          onChange={(e) =>
                            props.setRoster((rows) => patchQualification(rows, person.id, q.key, e.target.checked))
                          }
                          className="accent-cyan-500"
                        />
                        {q.label}
                      </label>
                    ))}
                  </div>
                </td>
                {ordered.map((pos) => {
                  const v = getPriority(props.skills, person.id, g, pos.id);
                  return (
                    <td key={pos.id} className="min-w-[6.75rem] max-w-[7.5rem] px-1 py-1.5 text-center border-t border-slate-800">
                      <select
                        value={v}
                        disabled={locked}
                        onChange={(e) => {
                          const n = Number(e.target.value) as Priority;
                          props.onRankError(null);
                          props.setSkills(setPriority(props.skills, person.id, g, pos.id, n));
                          props.setRoster((rows) => withSkillGroupConfigured(rows, person.id, g));
                        }}
                        className={`w-full rounded-md border border-slate-700 px-1 py-1 text-sm font-medium disabled:cursor-not-allowed ${PRIORITY_CELL[v]}`}
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
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
