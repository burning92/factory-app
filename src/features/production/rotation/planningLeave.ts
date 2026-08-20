import { isHalfDayLeaveType, parsePlanningLeaveType } from "@/features/production/planning/leaveTypes";
import { SEED_ROSTER } from "./seedRoster";
import type { PeriodId, Person, ProcessId, ShiftId } from "./types";

export type RotationLeaveKind = "none" | "annual" | "other" | "half" | "half_am" | "half_pm";

export type PlanningLeaveItem = {
  name: string;
  kind: RotationLeaveKind;
  workerId: string | null;
  source: "day" | "range" | "other";
  detail?: string;
};

function compactPersonKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, "");
}

function normalizePersonKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function preferredHintByName(name: string): Pick<Person, "preferred" | "shift" | "group"> | null {
  const key = normalizePersonKey(name);
  const seed = SEED_ROSTER.find((p) => normalizePersonKey(p.name) === key);
  if (!seed) return null;
  return { preferred: seed.preferred, shift: seed.shift, group: seed.group };
}

export function isDoughCorePerson(person: Person): boolean {
  const names = ["조선영", "이진화", "이병일"];
  return names.includes(normalizePersonKey(person.name));
}

export function leaveKindLabel(kind: RotationLeaveKind | undefined): string | null {
  switch (kind) {
    case "annual":
      return "연차";
    case "other":
      return "기타";
    case "half_am":
      return "반(오전출근)";
    case "half_pm":
      return "반(오후출근)";
    case "half":
      return "반차";
    default:
      return null;
  }
}

export function isFullDayLeave(kind: RotationLeaveKind | undefined): boolean {
  return kind === "annual" || kind === "other";
}

export function isAvailableInPeriod(person: Person, period: PeriodId): boolean {
  if (!person.present) return false;
  const k = person.leaveKind ?? "none";
  if (k === "none") return true;
  if (k === "annual" || k === "other") return false;
  if (k === "half_pm") return period === "lunch2" || period === "after";
  return period === "start" || period === "lunch1";
}

function kindRank(kind: RotationLeaveKind): number {
  if (kind === "annual" || kind === "other") return 3;
  if (kind === "half" || kind === "half_am" || kind === "half_pm") return 2;
  return 0;
}

export function mergeLeaveKind(a: RotationLeaveKind, b: RotationLeaveKind): RotationLeaveKind {
  if (a === "none") return b;
  if (b === "none") return a;
  if ((a === "half_am" || a === "half") && b === "half_pm") return "annual";
  if ((b === "half_am" || b === "half") && a === "half_pm") return "annual";
  return kindRank(b) > kindRank(a) ? b : a;
}

export function leaveKindFromPlanningType(value: string): RotationLeaveKind {
  if (value === "other") return "other";
  const t = parsePlanningLeaveType(value);
  if (t === "annual") return "annual";
  if (t === "half_am") return "half_am";
  if (t === "half_pm") return "half_pm";
  if (isHalfDayLeaveType(t)) return "half";
  return "annual";
}

export function rangeAppliesToDate(
  date: string,
  startDate: string,
  endDate: string,
  applyMode: string
): boolean {
  if (date < startDate || date > endDate) return false;
  if (applyMode !== "weekdays_only") return true;
  const weekday = new Date(`${date}T12:00:00`).getDay();
  return weekday !== 0 && weekday !== 6;
}

export function matchLeaveToWorkerId(
  workers: { id: string; name: string; loginId?: string | null }[],
  profileId: string | null,
  personName: string
): string | null {
  if (profileId && workers.some((w) => w.id === profileId)) return profileId;
  const key = normalizePersonKey(personName);
  const compact = compactPersonKey(personName);
  if (!key && !compact) return null;
  const hit =
    workers.find((w) => normalizePersonKey(w.name) === key) ??
    workers.find((w) => compactPersonKey(w.name) === compact) ??
    workers.find((w) => compactPersonKey(w.loginId ?? "") === compact);
  return hit?.id ?? null;
}

const OTHER_NOTE_PREFIX = "[기타]";

export function parseOtherLeaveNote(noteText: string): { detail: string; person_name: string } | null {
  const t = noteText.trim();
  if (!t.startsWith(OTHER_NOTE_PREFIX)) return null;
  const body = t.slice(OTHER_NOTE_PREFIX.length).trim();
  const idx = body.lastIndexOf(" : ");
  if (idx <= 0) return null;
  const detail = body.slice(0, idx).trim();
  const person_name = body.slice(idx + 3).trim();
  if (!detail || !person_name) return null;
  return { detail, person_name };
}

export function leaveItemsToMap(items: PlanningLeaveItem[]): Record<string, RotationLeaveKind> {
  const leaves: Record<string, RotationLeaveKind> = {};
  for (const item of items) {
    if (!item.workerId || item.kind === "none") continue;
    leaves[item.workerId] = mergeLeaveKind(leaves[item.workerId] ?? "none", item.kind);
  }
  return leaves;
}

export function applyPlanningLeaves(
  workers: Person[],
  leaves: Record<string, RotationLeaveKind>,
  attendance: Record<string, boolean>
): Person[] {
  return workers.map((p) => {
    const kind = leaves[p.id] ?? "none";
    const hasSaved = Object.prototype.hasOwnProperty.call(attendance, p.id);
    if (isFullDayLeave(kind)) {
      return { ...p, leaveKind: kind, present: false };
    }
    if (kind === "half" || kind === "half_am" || kind === "half_pm") {
      return { ...p, leaveKind: kind, present: hasSaved ? attendance[p.id] : true };
    }
    return { ...p, leaveKind: "none", present: hasSaved ? attendance[p.id] : true };
  });
}

export function applyPlanningLeaveItems(
  workers: Person[],
  items: PlanningLeaveItem[],
  attendance: Record<string, boolean>
): Person[] {
  const roster = workers.map((p) => ({ id: p.id, name: p.name, loginId: null as string | null }));
  const leaves: Record<string, RotationLeaveKind> = { ...leaveItemsToMap(items) };
  for (const item of items) {
    const id = item.workerId && workers.some((w) => w.id === item.workerId)
      ? item.workerId
      : matchLeaveToWorkerId(roster, item.workerId, item.name);
    if (!id || item.kind === "none") continue;
    leaves[id] = mergeLeaveKind(leaves[id] ?? "none", item.kind);
  }
  return applyPlanningLeaves(workers, leaves, attendance);
}

export function defaultWorkerFields(name: string): {
  preferred: ProcessId;
  shift: ShiftId;
  group: "floor" | "office";
} {
  const hint = preferredHintByName(name);
  return {
    preferred: hint?.preferred ?? "heating",
    shift: hint?.shift ?? "0800-1800",
    group: hint?.group ?? "floor",
  };
}
