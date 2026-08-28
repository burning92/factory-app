import type {
  Person,
  ProcessId,
  ProductGroup,
  QualificationsByGroup,
  RotationQualificationKey,
  RotationQualifications,
} from "./types";

export const ROTATION_QUALIFICATIONS: { key: RotationQualificationKey; label: string }[] = [
  { key: "threeSidePacker", label: "삼면포장기 관리" },
];

/** 구형 전역 자격은 포노 제품군에만 이전한다. 파베이크는 별도 */
export const PHONO_PRODUCT_GROUPS: ProductGroup[] = ["phono_signature", "phono_basil_corn", "phono_ricotta"];

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

function isProductGroup(value: string): value is ProductGroup {
  return (
    value === "phono_signature" ||
    value === "phono_basil_corn" ||
    value === "phono_ricotta" ||
    value === "parbake"
  );
}

/** 구형 flat qualifications → 포노 제품군만 */
export function migrateLegacyQualifications(flat: RotationQualifications | undefined): QualificationsByGroup | undefined {
  if (!flat) return undefined;
  const out: QualificationsByGroup = {};
  for (const group of PHONO_PRODUCT_GROUPS) out[group] = { ...flat };
  return out;
}

export function parseQualificationsByGroup(raw: unknown, legacyFlat?: unknown): QualificationsByGroup | undefined {
  const out: QualificationsByGroup = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [groupKey, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!isProductGroup(groupKey)) continue;
      const parsed = parseQualifications(value);
      if (parsed) out[groupKey] = parsed;
    }
  }
  const legacy = migrateLegacyQualifications(parseQualifications(legacyFlat));
  if (legacy) {
    for (const group of PHONO_PRODUCT_GROUPS) {
      out[group] = { ...legacy[group], ...out[group] };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function qualificationsForGroup(person: Person, group: ProductGroup): RotationQualifications | undefined {
  const direct = person.constraints?.qualificationsByGroup?.[group];
  if (direct && Object.keys(direct).length > 0) return direct;
  return undefined;
}

export function hasQualification(
  person: Person,
  key: RotationQualificationKey | string,
  group: ProductGroup
): boolean {
  return qualificationsForGroup(person, group)?.[key] === true;
}

export function requiredQualificationsForProcess(
  process: ProcessId,
  group: ProductGroup
): RotationQualificationKey[] {
  if (process === "inner" && group !== "parbake") return ["threeSidePacker"];
  return [];
}

export function processNeedsQualifications(process: ProcessId, group: ProductGroup): boolean {
  return requiredQualificationsForProcess(process, group).length > 0;
}

export function personMeetsProcessQualifications(
  person: Person,
  process: ProcessId,
  group: ProductGroup
): boolean {
  const keys = requiredQualificationsForProcess(process, group);
  if (keys.length === 0) return true;
  return keys.every((key) => hasQualification(person, key, group));
}

export type QualificationCoverage = {
  key: RotationQualificationKey;
  label: string;
  registered: number;
  present: number;
  presentFreeOfDoughCore: number;
  presentFieldBackup: number;
};

export function buildQualificationCoverage(roster: Person[], group: ProductGroup): QualificationCoverage[] {
  return ROTATION_QUALIFICATIONS.filter(() => processNeedsQualifications("inner", group)).map((q) => {
    const holders = roster.filter((p) => hasQualification(p, q.key, group));
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
