import { LEGACY_EXTRA_PROCESSES, SEED_ROSTER } from "./seedRoster";
import { isRotationExcluded } from "./personRules";
import { defaultStaffingForProcess, withDefaultStaffing } from "./staffing";
import type { Person, PositionCatalog, PositionDef, Priority, ProcessId, ProductGroup, SkillMatrix } from "./types";
import { EMERGENCY_PRIORITY } from "./types";

/** 포노 가열 순서. 리코타는 리코타 배합이 하나 더 붙어 8자리 */
const PHONO_HEAT_LABELS = [
  "도우따기",
  "도우 누르기",
  "스트레쳐 전",
  "내용물 충진",
  "접기",
  "화덕 투입 보조",
  "받기",
];

const PHONO_RICOTTA_HEAT_LABELS = [...PHONO_HEAT_LABELS, "리코타 배합"];

function heat(labels: string[], prefix: string): PositionDef[] {
  return labels.map((label, i) => ({
    id: `${prefix}-heat-${i + 1}`,
    label,
    process: "heating" as const,
  }));
}

function shared(prefix: string): PositionDef[] {
  return [
    { id: `${prefix}-heat-close`, label: "가열 마감", process: "heatingClose" },
    { id: `${prefix}-inner`, label: "내포장", process: "inner" },
    { id: `${prefix}-outer`, label: "외포장", process: "outer" },
    { id: `${prefix}-topping`, label: "토핑", process: "topping" },
    { id: `${prefix}-dough`, label: "반죽", process: "dough" },
    { id: `${prefix}-cleanup`, label: "반죽 마감", process: "cleanup" },
    { id: `${prefix}-rnd`, label: "R&D", process: "rnd" },
    { id: `${prefix}-office`, label: "사무", process: "office" },
  ];
}

export const DEFAULT_CATALOG: PositionCatalog = {
  phono_signature: [...heat(PHONO_HEAT_LABELS, "sig"), ...shared("sig")].map((p) => withDefaultStaffing(p)),
  phono_basil_corn: [...heat(PHONO_HEAT_LABELS, "basil"), ...shared("basil")].map((p) => withDefaultStaffing(p)),
  phono_ricotta: [...heat(PHONO_RICOTTA_HEAT_LABELS, "ricotta"), ...shared("ricotta")].map((p) =>
    withDefaultStaffing(p)
  ),
  parbake: [
    { id: "pb-pick", label: "도우따기", process: "heating" as const },
    { id: "pb-press", label: "누르기", process: "heating" as const },
    { id: "pb-spin-before", label: "스피너 전", process: "heating" as const },
    { id: "pb-spin-after", label: "스피너 후", process: "heating" as const },
    { id: "pb-sauce", label: "소스", process: "heating" as const },
    { id: "pb-cut", label: "자르기", process: "heating" as const },
    { id: "pb-receive", label: "받기", process: "heating" as const },
    ...shared("pb"),
  ].map((p) => withDefaultStaffing(p)),
};

const PHONO_GROUPS: ProductGroup[] = ["phono_signature", "phono_basil_corn", "phono_ricotta"];

/**
 * 포노 가열 자리 이름은 코드의 공정 순서를 따른다. 저장된 이름 대신 자리 순서대로 붙이고,
 * 자리 수가 모자라면(리코타 배합 등) 기본 자리를 뒤에 채운다. 자리 ID와 정원은 그대로 둔다.
 */
export function withFixedPhonoHeating(group: ProductGroup, positions: PositionDef[]): PositionDef[] {
  if (!PHONO_GROUPS.includes(group)) return positions;
  const defaults = DEFAULT_CATALOG[group].filter((p) => p.process === "heating");
  const out: PositionDef[] = [];
  let seen = 0;
  let lastHeatingAt = -1;
  for (const pos of positions) {
    if (pos.process !== "heating") {
      out.push(pos);
      continue;
    }
    const fixed = defaults[seen];
    out.push(fixed ? { ...pos, label: fixed.label } : pos);
    seen += 1;
    lastHeatingAt = out.length - 1;
  }
  if (seen < defaults.length) {
    const taken = new Set(out.map((p) => p.id));
    const missing = defaults
      .slice(seen)
      .filter((p) => !taken.has(p.id))
      .map((p) => withDefaultStaffing(structuredClone(p)));
    out.splice(lastHeatingAt + 1, 0, ...missing);
  }
  return out;
}

/** 저장본에 없던 시스템 공정 자리를 기본값으로 채운다 (가열 마감 등 나중에 추가된 공정) */
const REQUIRED_PROCESSES: ProcessId[] = ["heatingClose"];

export function withRequiredProcesses(group: ProductGroup, positions: PositionDef[]): PositionDef[] {
  const missing = REQUIRED_PROCESSES.filter((process) => !positions.some((p) => p.process === process));
  if (missing.length === 0) return positions;
  const taken = new Set(positions.map((p) => p.id));
  const added = missing.flatMap((process) =>
    structuredClone(DEFAULT_CATALOG[group])
      .filter((p) => p.process === process && !taken.has(p.id))
      .map((p) => withDefaultStaffing(p))
  );
  return [...positions, ...added];
}

export function newPositionId(process: ProcessId): string {
  return `${process}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function heatingPositions(catalog: PositionCatalog, group: ProductGroup): PositionDef[] {
  return catalog[group].filter((p) => p.process === "heating");
}

export function positionsForProcess(
  catalog: PositionCatalog,
  group: ProductGroup,
  process: ProcessId
): PositionDef[] {
  return catalog[group].filter((p) => p.process === process);
}

export function isNormalRank(v: Priority): boolean {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

/** 상·중상·중 — 공정을 이끌 수 있는 숙련 */
export function isExperiencedRank(v: Priority): boolean {
  return v === 1 || v === 2 || v === 3;
}

/** 하·비상 — 초보/임시. 공정에 이 숙련만 있으면 안 됨 */
export function isJuniorRank(v: Priority): boolean {
  return v === 4 || v === 5;
}

export function getPriority(
  skills: SkillMatrix,
  personId: string,
  group: ProductGroup,
  positionId: string
): Priority {
  const v = skills[personId]?.[group]?.[positionId];
  if (v === 1 || v === 2 || v === 3 || v === 4 || v === 5) return v;
  return 0;
}

/** 이 제품군에서 배치 가능한 숙련(상~비상)이 하나라도 있으면 true */
export function hasAssignableSkill(
  skills: SkillMatrix,
  personId: string,
  catalog: PositionCatalog,
  group: ProductGroup
): boolean {
  return catalog[group].some((pos) => getPriority(skills, personId, group, pos.id) > 0);
}

/**
 * 해당 제품군 숙련을 저장한 적 있는지.
 * DB는 0을 저장하지 않으므로, 1~5 행이 있거나 skillConfiguredGroups 표시가 있으면 설정됨.
 * 행이 없고 표시도 없으면 미설정. 모든 칸이 0이라고 미설정으로 보지 않는다.
 */
export function isSkillConfiguredForGroup(
  skills: SkillMatrix,
  person: Person,
  catalog: PositionCatalog | undefined,
  group: ProductGroup
): boolean {
  if (person.constraints?.skillConfiguredGroups?.includes(group)) return true;
  const row = skills[person.id]?.[group] ?? {};
  if (catalog) {
    return catalog[group].some((pos) => {
      const v = row[pos.id];
      return v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
    });
  }
  return Object.values(row).some((v) => v === 1 || v === 2 || v === 3 || v === 4 || v === 5);
}

export function hasNoSkillConfig(
  skills: SkillMatrix,
  person: Person,
  catalog: PositionCatalog | undefined,
  group: ProductGroup
): boolean {
  return !isSkillConfiguredForGroup(skills, person, catalog, group);
}

/** 주공정이 사무여도, 숙련 사무가 비어 있으면 배치표에 넣지 않는다 */
export function hasOfficeSkill(
  skills: SkillMatrix,
  personId: string,
  catalog: PositionCatalog,
  group: ProductGroup
): boolean {
  return positionsForProcess(catalog, group, "office").some((pos) => getPriority(skills, personId, group, pos.id) > 0);
}

export function isOfficePerson(person: Person): boolean {
  return person.group === "office" || person.preferred === "office";
}

export function isAssignedOfficePerson(
  person: Person,
  skills: SkillMatrix,
  catalog: PositionCatalog,
  group: ProductGroup
): boolean {
  return isOfficePerson(person) && hasOfficeSkill(skills, person.id, catalog, group);
}

/** 제외·입사 전이 아니면 당일 표에 남긴다. 숙련 없음은 여기서 빼지 않는다 */
export function isRotationBoardVisible(person: Person, workDate?: string): boolean {
  if (isRotationExcluded(person)) return false;
  if (workDate && person.hireDate && person.hireDate > workDate) return false;
  return true;
}

/** 자동배치 후보. 숙련 1~5가 있는 사람만 */
export function isRotationAutoAssignable(
  person: Person,
  skills: SkillMatrix,
  catalog: PositionCatalog,
  group: ProductGroup,
  workDate?: string
): boolean {
  return isRotationBoardVisible(person, workDate) && hasAssignableSkill(skills, person.id, catalog, group);
}

/** 숙련이 모두 비었거나, 아직 입사 전이거나, 제외면 자동배치에서 뺀다 */
export function isRotationEligible(
  person: Person,
  skills: SkillMatrix,
  catalog: PositionCatalog,
  group: ProductGroup,
  workDate?: string
): boolean {
  return isRotationAutoAssignable(person, skills, catalog, group, workDate);
}

export function visibleRotationRoster(
  roster: Person[],
  workDate?: string
): Person[] {
  return roster.filter((p) => isRotationBoardVisible(p, workDate));
}

export function eligibleRotationRoster(
  roster: Person[],
  skills: SkillMatrix,
  catalog: PositionCatalog,
  group: ProductGroup,
  workDate?: string
): Person[] {
  return roster.filter((p) => isRotationEligible(p, skills, catalog, group, workDate));
}

export function setPriority(
  skills: SkillMatrix,
  personId: string,
  group: ProductGroup,
  positionId: string,
  value: Priority
): SkillMatrix {
  const next: SkillMatrix = { ...skills, [personId]: { ...skills[personId] } };
  next[personId][group] = { ...next[personId][group], [positionId]: value };
  return next;
}

/** 가열·포장 모두 기본 불가. 숙련도는 직접 입력. */
export function seedSkillMatrix(roster: Person[] = SEED_ROSTER, catalog: PositionCatalog = DEFAULT_CATALOG): SkillMatrix {
  const skills: SkillMatrix = {};
  for (const person of roster) {
    skills[person.id] = { phono_signature: {}, phono_basil_corn: {}, phono_ricotta: {}, parbake: {} };
    for (const group of Object.keys(catalog) as ProductGroup[]) {
      for (const pos of catalog[group]) {
        skills[person.id][group]![pos.id] = 0;
      }
    }
  }
  void LEGACY_EXTRA_PROCESSES;
  return skills;
}

export function mergeCatalog(saved: PositionCatalog | undefined): PositionCatalog {
  if (!saved) return structuredClone(DEFAULT_CATALOG);
  const next = structuredClone(DEFAULT_CATALOG);
  const legacy = saved as PositionCatalog & { phono_std?: PositionDef[] };
  for (const group of Object.keys(next) as ProductGroup[]) {
    const fromGroup = Array.isArray(legacy[group]) && legacy[group].length > 0 ? legacy[group] : null;
    const fromOldStd =
      !fromGroup && (group === "phono_signature" || group === "phono_basil_corn") && Array.isArray(legacy.phono_std)
        ? legacy.phono_std
        : null;
    const source = fromGroup ?? fromOldStd;
    if (source && source.length > 0) {
      next[group] = withRequiredProcesses(
        group,
        withFixedPhonoHeating(
          group,
          source
            .filter((p) => p && typeof p.id === "string" && typeof p.label === "string")
            .map((p) =>
              withDefaultStaffing({
                id: p.id,
                label: p.label,
                process: p.process,
                staffing: p.staffing,
              })
            )
        )
      );
    } else {
      next[group] = next[group].map((p) => withDefaultStaffing(p));
    }
  }
  return next;
}

export function mergeSkills(saved: SkillMatrix | undefined, roster: Person[], catalog: PositionCatalog): SkillMatrix {
  const base = seedSkillMatrix(roster, catalog);
  if (!saved) return base;
  for (const person of roster) {
    const legacyStd = (saved[person.id] as SkillMatrix[string] & { phono_std?: Record<string, Priority> } | undefined)
      ?.phono_std;
    for (const group of Object.keys(catalog) as ProductGroup[]) {
      const row =
        saved[person.id]?.[group] ??
        ((group === "phono_signature" || group === "phono_basil_corn") ? legacyStd : undefined);
      if (!row) continue;
      for (const pos of catalog[group]) {
        const v = row[pos.id];
        if (v === 0 || v === 1 || v === 2 || v === 3 || v === 4 || v === 5) {
          base[person.id][group]![pos.id] = v;
        }
      }
    }
  }
  return withCloseProcessFallback(base, catalog);
}

function bestPriorityForProcess(
  row: Record<string, Priority>,
  positions: PositionDef[],
  process: ProcessId
): Priority {
  let best: Priority = 0;
  for (const pos of positions) {
    if (pos.process !== process) continue;
    const v = row[pos.id];
    if (v === 1 || v === 2 || v === 3 || v === 4 || v === 5) {
      if (best === 0 || v < best) best = v;
    }
  }
  return best;
}

/** 마감 공정은 해당 생산공정 숙련을 물려받는다 */
const CLOSE_PROCESS_SOURCE: Partial<Record<ProcessId, ProcessId>> = {
  heatingClose: "heating",
  cleanup: "dough",
};

/**
 * 가열 마감·반죽 마감 숙련을 따로 넣지 않았으면 가열·반죽 숙련을 그대로 쓴다.
 * 설비를 돌릴 수 있으면 정리·세척도 가능하다고 보는 기본값이고, 설정에서 값을 넣으면 그 값이 우선한다.
 */
export function withCloseProcessFallback(skills: SkillMatrix, catalog: PositionCatalog): SkillMatrix {
  const next: SkillMatrix = { ...skills };
  for (const [personId, byGroup] of Object.entries(skills)) {
    const nextGroups = { ...byGroup };
    let changed = false;
    for (const group of Object.keys(catalog) as ProductGroup[]) {
      const row = byGroup[group] ?? {};
      const nextRow = { ...row };
      let rowChanged = false;
      for (const [closeProcess, sourceProcess] of Object.entries(CLOSE_PROCESS_SOURCE) as [ProcessId, ProcessId][]) {
        const closePositions = catalog[group].filter((p) => p.process === closeProcess);
        if (closePositions.length === 0) continue;
        const best = bestPriorityForProcess(row, catalog[group], sourceProcess);
        if (best === 0) continue;
        for (const pos of closePositions) {
          const cur = nextRow[pos.id];
          if (cur === 1 || cur === 2 || cur === 3 || cur === 4 || cur === 5) continue;
          nextRow[pos.id] = best;
          rowChanged = true;
        }
      }
      if (!rowChanged) continue;
      nextGroups[group] = nextRow;
      changed = true;
    }
    if (changed) next[personId] = nextGroups;
  }
  return next;
}

/** 해당 제품군 숙련을 전원 0(불가)으로 되돌린다. 다른 제품군은 그대로 둔다. */
export function clearGroupSkills(
  skills: SkillMatrix,
  roster: Person[],
  catalog: PositionCatalog,
  group: ProductGroup
): SkillMatrix {
  const next: SkillMatrix = { ...skills };
  for (const person of roster) {
    const cleared: Record<string, Priority> = {};
    for (const pos of catalog[group]) cleared[pos.id] = 0;
    next[person.id] = { ...next[person.id], [group]: cleared };
  }
  return next;
}

export function copyProductGroup(
  catalog: PositionCatalog,
  skills: SkillMatrix,
  roster: Person[],
  from: ProductGroup,
  to: ProductGroup
): { catalog: PositionCatalog; skills: SkillMatrix } {
  const copied: PositionDef[] = catalog[from].map((p, i) =>
    withDefaultStaffing({
      id: `${to}__${p.process}__${i}`,
      label: p.label,
      process: p.process,
      staffing: p.staffing ?? defaultStaffingForProcess(p.process),
    })
  );
  const idMap = new Map(catalog[from].map((p, i) => [p.id, copied[i].id]));
  const nextCatalog: PositionCatalog = { ...catalog, [to]: copied };
  const nextSkills: SkillMatrix = { ...skills };
  for (const person of roster) {
    nextSkills[person.id] = { ...nextSkills[person.id] };
    const src = skills[person.id]?.[from] ?? {};
    const dest: Record<string, Priority> = {};
    for (const p of catalog[from]) {
      dest[idMap.get(p.id)!] = (src[p.id] ?? 0) as Priority;
    }
    nextSkills[person.id][to] = dest;
  }
  return { catalog: nextCatalog, skills: nextSkills };
}

export type PositionReadiness = {
  id: string;
  label: string;
  process: ProcessId;
  candidateCount: number;
  hasPrimary: boolean;
  hasNormalBackup: boolean;
};

export type GroupReadiness = {
  requiredCount: number;
  primaryComplete: number;
  backupComplete: number;
  singleCandidate: PositionReadiness[];
  noneCandidate: PositionReadiness[];
  lunchPossible: boolean;
  lunchPossibleToday: boolean;
};

export function requiredPositionsForReadiness(catalog: PositionCatalog, group: ProductGroup): PositionDef[] {
  const heat = heatingPositions(catalog, group);
  const inner = positionsForProcess(catalog, group, "inner");
  const outer = positionsForProcess(catalog, group, "outer");
  return [...heat, ...inner, ...outer];
}

export function buildGroupReadiness(
  catalog: PositionCatalog,
  group: ProductGroup,
  skills: SkillMatrix,
  roster: Person[]
): GroupReadiness {
  const registered = roster.filter((p) => p.group !== "office");
  const present = registered.filter((p) => p.present);
  const required = requiredPositionsForReadiness(catalog, group);
  const rows: PositionReadiness[] = required.map((pos) => {
    const candidates = registered.filter((p) => getPriority(skills, p.id, group, pos.id) > 0);
    const hasPrimary = registered.some((p) => getPriority(skills, p.id, group, pos.id) === 1);
    const hasNormalBackup = registered.some((p) => {
      const r = getPriority(skills, p.id, group, pos.id);
      return r === 2 || r === 3 || r === 4;
    });
    return {
      id: pos.id,
      label: pos.label,
      process: pos.process,
      candidateCount: candidates.length,
      hasPrimary,
      hasNormalBackup,
    };
  });
  const singleCandidate = rows.filter((r) => r.candidateCount === 1);
  const noneCandidate = rows.filter((r) => r.candidateCount === 0);
  return {
    requiredCount: rows.length,
    primaryComplete: rows.filter((r) => r.hasPrimary).length,
    backupComplete: rows.filter((r) => r.hasNormalBackup).length,
    singleCandidate,
    noneCandidate,
    lunchPossible: rows.every((r) => r.candidateCount >= 2),
    lunchPossibleToday: required.every(
      (pos) => present.filter((p) => getPriority(skills, p.id, group, pos.id) > 0).length >= 2
    ),
  };
}

export { EMERGENCY_PRIORITY };
