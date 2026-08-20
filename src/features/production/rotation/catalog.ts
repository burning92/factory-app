import { LEGACY_EXTRA_PROCESSES, SEED_ROSTER } from "./seedRoster";
import { defaultStaffingForProcess, withDefaultStaffing } from "./staffing";
import type { Person, PositionCatalog, PositionDef, Priority, ProcessId, ProductGroup, SkillMatrix } from "./types";
import { EMERGENCY_PRIORITY } from "./types";

function heat(n: number, prefix: string): PositionDef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-heat-${i + 1}`,
    label: `가열 ${i + 1}`,
    process: "heating" as const,
  }));
}

function shared(prefix: string): PositionDef[] {
  return [
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
  phono_signature: [...heat(7, "sig"), ...shared("sig")].map((p) => withDefaultStaffing(p)),
  phono_basil_corn: [...heat(7, "basil"), ...shared("basil")].map((p) => withDefaultStaffing(p)),
  phono_ricotta: [...heat(8, "ricotta"), ...shared("ricotta")].map((p) => withDefaultStaffing(p)),
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

/** 숙련이 모두 비었거나, 아직 입사 전이면 당일 배치에서 뺀다 */
export function isRotationEligible(
  person: Person,
  skills: SkillMatrix,
  catalog: PositionCatalog,
  group: ProductGroup,
  workDate?: string
): boolean {
  if (workDate && person.hireDate && person.hireDate > workDate) return false;
  return hasAssignableSkill(skills, person.id, catalog, group);
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
      next[group] = source
        .filter((p) => p && typeof p.id === "string" && typeof p.label === "string")
        .map((p) =>
          withDefaultStaffing({
            id: p.id,
            label: p.label,
            process: p.process,
            staffing: p.staffing,
          })
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
  return base;
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
