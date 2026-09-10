import { DOUGH_CORE_IDS } from "./seedRoster";
import {
  hasQualification,
  parseQualificationsByGroup,
  requiredQualificationsForProcess,
} from "./qualifications";
import type {
  Person,
  PersonConstraints,
  PreferredByGroup,
  ProcessId,
  ProductGroup,
  QualificationsByGroup,
} from "./types";
import { PROCESSES } from "./types";

const PRODUCT_GROUPS: ProductGroup[] = ["phono_signature", "phono_basil_corn", "phono_ricotta", "parbake"];
const PROCESS_IDS = new Set<string>(PROCESSES.map((p) => p.id));

function parsePreferredByGroup(raw: unknown): PreferredByGroup | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: PreferredByGroup = {};
  for (const group of PRODUCT_GROUPS) {
    const value = (raw as Record<string, unknown>)[group];
    if (typeof value === "string" && PROCESS_IDS.has(value)) {
      out[group] = value as ProcessId;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mergePreferredByGroup(
  prev: PreferredByGroup | undefined,
  next: PreferredByGroup | undefined
): PreferredByGroup | undefined {
  const out: PreferredByGroup = { ...(prev ?? {}) };
  if (!next) return Object.keys(out).length > 0 ? out : undefined;
  for (const group of PRODUCT_GROUPS) {
    const value = next[group];
    if (value && PROCESS_IDS.has(value)) out[group] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 해당 제품군의 주공정. 탭별 값이 없으면 기본 preferred를 쓴다 */
export function preferredProcess(person: Person, group: ProductGroup): ProcessId {
  return person.constraints?.preferredByGroup?.[group] ?? person.preferred;
}

function personNameKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, "");
}

function parseConfiguredGroups(raw: unknown): ProductGroup[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const next = raw.filter((g): g is ProductGroup => PRODUCT_GROUPS.includes(g as ProductGroup));
  return next.length > 0 ? next : undefined;
}

export function isExcludedFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "1";
}

function pickConstraintBool(
  rawIncoming: Record<string, unknown> | null,
  next: PersonConstraints,
  prev: PersonConstraints,
  key: "lockPreferred" | "stayFloor" | "excluded" | "fieldBackup" | "nightShiftBackup"
): true | undefined {
  if (rawIncoming && Object.prototype.hasOwnProperty.call(rawIncoming, key)) {
    return isExcludedFlag(rawIncoming[key]) ? true : undefined;
  }
  if (next[key] === true || prev[key] === true) return true;
  return undefined;
}

function asConstraintObject(raw: unknown): Record<string, unknown> | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mergeQualificationsByGroup(
  prev: QualificationsByGroup | undefined,
  next: QualificationsByGroup | undefined
): QualificationsByGroup | undefined {
  const out: QualificationsByGroup = { ...(prev ?? {}) };
  if (!next) return Object.keys(out).length > 0 ? out : undefined;
  for (const group of PRODUCT_GROUPS) {
    const incoming = next[group];
    if (!incoming) continue;
    const merged = { ...(out[group] ?? {}), ...incoming };
    for (const [key, value] of Object.entries(merged)) {
      if (value !== true) delete merged[key];
    }
    if (Object.keys(merged).length > 0) out[group] = merged;
    else delete out[group];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parsePersonConstraints(raw: unknown): PersonConstraints | undefined {
  const src = asConstraintObject(raw);
  if (!src) return undefined;
  const next: PersonConstraints = {};
  if (src.lockPreferred === true) next.lockPreferred = true;
  if (src.stayFloor === true) next.stayFloor = true;
  if (isExcludedFlag(src.excluded)) next.excluded = true;
  if (src.excluded === false) next.excluded = false;
  if (src.fieldBackup === true) next.fieldBackup = true;
  if (src.nightShiftBackup === true) next.nightShiftBackup = true;
  if (src.doughCore === true) next.doughCore = true;
  if (src.doughCore === false) next.doughCore = false;
  const qualificationsByGroup = parseQualificationsByGroup(src.qualificationsByGroup, src.qualifications);
  if (qualificationsByGroup) next.qualificationsByGroup = qualificationsByGroup;
  const preferredByGroup = parsePreferredByGroup(src.preferredByGroup);
  if (preferredByGroup) next.preferredByGroup = preferredByGroup;
  const skillConfiguredGroups = parseConfiguredGroups(src.skillConfiguredGroups);
  if (skillConfiguredGroups) next.skillConfiguredGroups = skillConfiguredGroups;
  return Object.keys(next).length > 0 ? next : undefined;
}

/** 기존 constraints를 보존한 채 저장본과 합친다. 명시적 false는 해제로 본다. */
export function mergePersonConstraints(existing: unknown, incoming: unknown): PersonConstraints {
  const prev = parsePersonConstraints(existing) ?? {};
  const next = parsePersonConstraints(incoming) ?? {};
  const raw = asConstraintObject(incoming);
  const out: PersonConstraints = {};

  const lockPreferred = pickConstraintBool(raw, next, prev, "lockPreferred");
  const stayFloor = pickConstraintBool(raw, next, prev, "stayFloor");
  const excluded = pickConstraintBool(raw, next, prev, "excluded");
  const fieldBackup = pickConstraintBool(raw, next, prev, "fieldBackup");
  const nightShiftBackup = pickConstraintBool(raw, next, prev, "nightShiftBackup");
  if (lockPreferred) out.lockPreferred = true;
  if (stayFloor) out.stayFloor = true;
  if (excluded) out.excluded = true;
  if (fieldBackup) out.fieldBackup = true;
  if (nightShiftBackup) out.nightShiftBackup = true;

  if (raw && Object.prototype.hasOwnProperty.call(raw, "doughCore")) {
    if (raw.doughCore === true) out.doughCore = true;
    else if (raw.doughCore === false) out.doughCore = false;
  } else if (next.doughCore === true || next.doughCore === false) {
    out.doughCore = next.doughCore;
  } else if (prev.doughCore === true || prev.doughCore === false) {
    out.doughCore = prev.doughCore;
  }

  const qualificationsByGroup = mergeQualificationsByGroup(prev.qualificationsByGroup, next.qualificationsByGroup);
  if (qualificationsByGroup) out.qualificationsByGroup = qualificationsByGroup;

  const preferredByGroup = mergePreferredByGroup(prev.preferredByGroup, next.preferredByGroup);
  if (preferredByGroup) out.preferredByGroup = preferredByGroup;

  const skillConfiguredGroups = Array.from(
    new Set([...(prev.skillConfiguredGroups ?? []), ...(next.skillConfiguredGroups ?? [])])
  ) as ProductGroup[];
  if (skillConfiguredGroups.length > 0) out.skillConfiguredGroups = skillConfiguredGroups;

  return out;
}

export function constraintsForSave(constraints: PersonConstraints | undefined, existing?: unknown): PersonConstraints {
  return mergePersonConstraints(existing, constraints);
}

export function isDoughCorePerson(person: Person): boolean {
  if (person.constraints?.doughCore === true) return true;
  if (person.constraints?.doughCore === false) return false;
  return DOUGH_CORE_IDS.some((name) => personNameKey(name) === personNameKey(person.name));
}

export function isFieldBackup(person: Person): boolean {
  return person.constraints?.fieldBackup === true;
}

/** 09~19조 결원이 나면 그날 하루 근무조를 바꿔 쓸 수 있는 사람 */
export function isNightShiftBackup(person: Person): boolean {
  return person.constraints?.nightShiftBackup === true;
}

export function canTakeProcess(person: Person, process: ProcessId, group: ProductGroup): boolean {
  if (!person.constraints?.lockPreferred) return true;
  const preferred = preferredProcess(person, group);
  if (preferred === process) return true;
  // 가열 마감은 가열실 설비 정리·세척이라 가열의 마무리에 해당한다. 주공정이 가열이면 주공정만을 켜도 마감에 남을 수 있다
  if (preferred === "heating" && process === "heatingClose") return true;
  if (isDoughCorePerson(person) && process === "heating") return true;
  if (
    isFieldBackup(person) &&
    requiredQualificationsForProcess(process, group).some((key) => hasQualification(person, key, group))
  ) {
    return true;
  }
  return false;
}

export function isRotationExcluded(person: Person): boolean {
  return isExcludedFlag(person.constraints?.excluded);
}

export function hardStayFloor(person: Person): boolean {
  return person.constraints?.stayFloor === true;
}

export function withSkillGroupConfigured(rows: Person[], personId: string, group: ProductGroup): Person[] {
  return rows.map((row) => {
    if (row.id !== personId) return row;
    const current = row.constraints?.skillConfiguredGroups ?? [];
    if (current.includes(group)) return row;
    return {
      ...row,
      constraints: { ...row.constraints, skillConfiguredGroups: [...current, group] },
    };
  });
}

export { hasQualification };
