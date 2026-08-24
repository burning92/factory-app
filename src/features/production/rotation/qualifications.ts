import type {
  Person,
  ProcessId,
  RotationQualificationKey,
  RotationQualifications,
} from "./types";

export const ROTATION_QUALIFICATIONS: { key: RotationQualificationKey; label: string }[] = [
  { key: "threeSidePacker", label: "삼면포장기 관리" },
];

export function qualificationLabel(key: RotationQualificationKey | string): string {
  return ROTATION_QUALIFICATIONS.find((q) => q.key === key)?.label ?? key;
}

export function parseQualifications(raw: unknown): RotationQualifications | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as Record<string, unknown>;
  const next: RotationQualifications = {};
  for (const [key, value] of Object.entries(src)) {
    if (!key || value !== true) continue;
    next[key] = true;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function hasQualification(person: Person, key: RotationQualificationKey | string): boolean {
  return person.constraints?.qualifications?.[key] === true;
}

export function requiredQualificationsForProcess(process: ProcessId): RotationQualificationKey[] {
  if (process === "inner") return ["threeSidePacker"];
  return [];
}

export function personMeetsProcessQualifications(person: Person, process: ProcessId): boolean {
  const keys = requiredQualificationsForProcess(process);
  if (keys.length === 0) return true;
  return keys.every((key) => hasQualification(person, key));
}

export type QualificationCoverage = {
  key: RotationQualificationKey;
  label: string;
  registered: number;
  present: number;
  presentFreeOfDoughCore: number;
  presentFieldBackup: number;
};

export function buildQualificationCoverage(roster: Person[]): QualificationCoverage[] {
  return ROTATION_QUALIFICATIONS.map((q) => {
    const holders = roster.filter((p) => hasQualification(p, q.key));
    const present = holders.filter((p) => p.present);
    return {
      key: q.key,
      label: q.label,
      registered: holders.length,
      present: present.length,
      presentFreeOfDoughCore: present.filter((p) => p.constraints?.doughCore !== true).length,
      presentFieldBackup: present.filter((p) => p.constraints?.fieldBackup === true).length,
    };
  });
}
