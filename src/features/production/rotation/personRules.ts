import { DOUGH_CORE_IDS } from "./seedRoster";
import type { Person, PersonConstraints, ProcessId } from "./types";

function personNameKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, "");
}

export function parsePersonConstraints(raw: unknown): PersonConstraints | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as Record<string, unknown>;
  const next: PersonConstraints = {};
  if (src.lockPreferred === true) next.lockPreferred = true;
  if (src.stayFloor === true) next.stayFloor = true;
  if (src.excluded === true) next.excluded = true;
  if (src.doughCore === true) next.doughCore = true;
  if (src.doughCore === false) next.doughCore = false;
  return Object.keys(next).length > 0 ? next : undefined;
}

export function constraintsForSave(constraints: PersonConstraints | undefined): PersonConstraints {
  const parsed = parsePersonConstraints(constraints ?? {});
  return parsed ?? {};
}

export function isDoughCorePerson(person: Person): boolean {
  if (person.constraints?.doughCore === true) return true;
  if (person.constraints?.doughCore === false) return false;
  return DOUGH_CORE_IDS.some((name) => personNameKey(name) === personNameKey(person.name));
}

export function canTakeProcess(person: Person, process: ProcessId): boolean {
  if (!person.constraints?.lockPreferred) return true;
  if (person.preferred === process) return true;
  if (process === "cleanup" && person.preferred === "dough") return true;
  if (isDoughCorePerson(person) && process === "heating") return true;
  return false;
}

export function isRotationExcluded(person: Person): boolean {
  return person.constraints?.excluded === true;
}

export function hardStayFloor(person: Person): boolean {
  return person.constraints?.stayFloor === true;
}
