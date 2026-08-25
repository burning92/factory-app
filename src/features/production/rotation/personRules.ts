import { DOUGH_CORE_IDS } from "./seedRoster";
import { hasQualification, parseQualifications, requiredQualificationsForProcess } from "./qualifications";
import type { Person, PersonConstraints, ProcessId, ProductGroup } from "./types";

const PRODUCT_GROUPS: ProductGroup[] = ["phono_signature", "phono_basil_corn", "phono_ricotta", "parbake"];

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
  key: "lockPreferred" | "stayFloor" | "excluded" | "fieldBackup"
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

export function parsePersonConstraints(raw: unknown): PersonConstraints | undefined {
  const src = asConstraintObject(raw);
  if (!src) return undefined;
  const next: PersonConstraints = {};
  if (src.lockPreferred === true) next.lockPreferred = true;
  if (src.stayFloor === true) next.stayFloor = true;
  if (isExcludedFlag(src.excluded)) next.excluded = true;
  if (src.excluded === false) next.excluded = false;
  if (src.fieldBackup === true) next.fieldBackup = true;
  if (src.doughCore === true) next.doughCore = true;
  if (src.doughCore === false) next.doughCore = false;
  const qualifications = parseQualifications(src.qualifications);
  if (qualifications) next.qualifications = qualifications;
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
  if (lockPreferred) out.lockPreferred = true;
  if (stayFloor) out.stayFloor = true;
  if (excluded) out.excluded = true;
  if (fieldBackup) out.fieldBackup = true;

  if (raw && Object.prototype.hasOwnProperty.call(raw, "doughCore")) {
    if (raw.doughCore === true) out.doughCore = true;
    else if (raw.doughCore === false) out.doughCore = false;
  } else if (next.doughCore === true || next.doughCore === false) {
    out.doughCore = next.doughCore;
  } else if (prev.doughCore === true || prev.doughCore === false) {
    out.doughCore = prev.doughCore;
  }

  const qualifications = { ...prev.qualifications, ...next.qualifications };
  if (Object.keys(qualifications).length > 0) out.qualifications = qualifications;

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

export function canTakeProcess(person: Person, process: ProcessId): boolean {
  if (!person.constraints?.lockPreferred) return true;
  if (person.preferred === process) return true;
  if (process === "cleanup" && person.preferred === "dough") return true;
  if (isDoughCorePerson(person) && process === "heating") return true;
  if (
    isFieldBackup(person) &&
    requiredQualificationsForProcess(process).some((key) => hasQualification(person, key))
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
