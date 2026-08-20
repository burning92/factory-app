"use client";

import { Copy, Plus, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import {
  getPriority,
  heatingPositions,
  rankTakenBy,
  setPriorityUnique,
  type GroupReadiness,
} from "@/features/production/rotation/catalog";
import { PRODUCT_GROUPS } from "@/features/production/rotation/seedRoster";
import { processLabel } from "@/features/production/rotation/rotationEngine";
import {
  PRIORITY_OPTIONS,
  PROCESSES,
  type Person,
  type PositionCatalog,
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

export function CopyFromSignatureBar(props: { onCopy: (to: ProductGroup) => void }) {
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
    <details className="mb-3 rounded-xl border border-slate-700/70 bg-slate-800/40">
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
          우선순위는 숙련이 아니라 포지션별 후보 순번입니다. 1~4순위는 자리마다 한 명만, 한 사람은 여러 자리 후보가 될 수 있습니다. 점심 유지는 필수포지션마다 가능자 2명 이상이 필요합니다.
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
  onCopyFromSignature: (to: ProductGroup) => void;
}) {
  const g = props.skillGroup;
  const heatN = heatingPositions(props.catalog, g).length;
  const expect = g === "phono_ricotta" ? 8 : 7;
  return (
    <section className="rounded-xl border border-slate-700/70 bg-slate-800/30 p-4 mb-6">
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
      <p className="text-sm text-slate-400 mb-4">
        가열 필수 포지션 {heatN}개 (리코타는 8, 그 외 7이 기본). 이름을 현장 용어로 바꾸고, 자리를 추가·삭제할 수 있습니다. 파베이크는 도우따기·누르기·스피너 전·스피너 후·소스·자르기·받기가 들어 있습니다.
        {heatN !== expect ? ` 현재 ${heatN}개라 기본 ${expect}개와 다릅니다.` : ""}
      </p>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {PROCESSES.filter((p) => p.id !== "office").map((process) => {
        const list = props.catalog[g].filter((p) => p.process === process.id);
        return (
          <div key={process.id}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-base font-medium text-slate-200">{process.label}</p>
              <button
                type="button"
                onClick={() => props.onAdd(g, process.id)}
                className="inline-flex items-center gap-1 text-sm text-cyan-300 hover:text-cyan-200"
              >
                <Plus className="w-4 h-4" /> 추가
              </button>
            </div>
            <ul className="space-y-2">
              {list.map((pos) => (
                <li key={pos.id} className="flex items-center gap-2">
                  <input
                    value={pos.label}
                    onChange={(e) => props.onRename(g, pos.id, e.target.value)}
                    className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  />
                  <button type="button" onClick={() => props.onRemove(g, pos.id)} className="text-slate-500 hover:text-rose-300" aria-label="삭제">
                    <Trash2 className="w-4 h-4" />
                  </button>
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
}) {
  const g = props.skillGroup;
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
        <CopyFromSignatureBar onCopy={props.onCopyFromSignature} />
      </div>
      <p className="shrink-0 px-4 pb-3 text-sm text-slate-400">
        1순위 최우선 · 2순위 1순위 부재·식사 시 · 3순위 1·2 불가 시 · 4순위 최종 정상 대체 · 비상은 정상 후보가 모두 없을 때만 · 불가는 배치 금지.
        같은 자리의 1~4순위는 한 명만 넣을 수 있습니다.
      </p>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 bg-slate-900 px-3 py-3 text-left text-slate-300 font-medium min-w-[7rem]">이름</th>
              <th className="bg-slate-900 px-2 py-3 text-left text-slate-300 font-medium min-w-[7.5rem]">주공정</th>
              <th className="bg-slate-900 px-2 py-3 text-left text-slate-300 font-medium min-w-[6.5rem]">조</th>
              {ordered.map((pos) => (
                <th key={pos.id} className="bg-slate-900 px-1.5 py-3 text-center text-slate-200 font-medium whitespace-nowrap">
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
                    onChange={(e) =>
                      props.setRoster((rows) =>
                        rows.map((r) => (r.id === person.id ? { ...r, preferred: e.target.value as Person["preferred"] } : r))
                      )
                    }
                    className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200"
                  >
                    {PROCESSES.map((process) => (
                      <option key={process.id} value={process.id}>{process.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2 border-t border-slate-800">
                  <select
                    value={person.shift}
                    onChange={(e) =>
                      props.setRoster((rows) =>
                        rows.map((r) => (r.id === person.id ? { ...r, shift: e.target.value as Person["shift"] } : r))
                      )
                    }
                    className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-2 text-sm text-slate-200"
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
                        className={`w-full min-h-10 rounded-md border border-slate-700 px-1 py-2 text-sm font-medium ${PRIORITY_CELL[v]}`}
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
