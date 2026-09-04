import { DEFAULT_CATALOG } from "./catalog";
import { mergePersonConstraints, parsePersonConstraints } from "./personRules";
import { productGroup } from "./seedRoster";
import { normalizePositionStaffing, parsePeriodStaffJson, processNeedsStaffing, withDefaultStaffing } from "./staffing";
import type { PlanningLeaveItem, RotationLeaveKind } from "./planningLeave";
import type { PlannedRotationProduct } from "./mapPlanProducts";
import { normalizeDoughSettings } from "./doughPolicy";
import type {
  PeriodAssignments,
  PeriodId,
  Person,
  PersonConstraints,
  PositionCatalog,
  PositionDef,
  Priority,
  ProcessId,
  ProductGroup,
  ProductLine,
  RotationModes,
  RotationOps,
  ShiftId,
  SkillMatrix,
} from "./types";
import { PERIODS } from "./types";

export type RotationMasterPayload = {
  workers: Person[];
  catalog: PositionCatalog;
  skills: SkillMatrix;
  ops?: RotationOps;
};

export function opsFromRow(payload: unknown): RotationOps {
  const src = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const doughRaw = src.dough && typeof src.dough === "object" ? (src.dough as Record<string, unknown>) : src;
  return {
    dough: normalizeDoughSettings({
      minStaff: typeof doughRaw.minStaff === "number" ? doughRaw.minStaff : undefined,
      rotationPolicy:
        doughRaw.rotationPolicy === "FIXED_DOUGH" || doughRaw.rotationPolicy === "CURRENT_LUNCH_BACKUP"
          ? doughRaw.rotationPolicy
          : undefined,
    }),
  };
}

export function workerConstraintsMapFromPayload(payload: unknown): Record<string, PersonConstraints> {
  const src = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const raw = src.workerConstraints;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, PersonConstraints> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = parsePersonConstraints(value);
    out[id] = parsed ?? {};
  }
  return out;
}

/** GET: workers.constraints를 기본으로 두고 ops 값은 필드 단위로만 얹는다. ops `{}`는 삭제하지 않는다. */
export function mergeWorkerAndOpsConstraints(
  workerConstraints: unknown,
  opsConstraints: unknown
): PersonConstraints {
  return mergePersonConstraints(workerConstraints, opsConstraints);
}

export function applyWorkerConstraintsMap(
  workers: Person[],
  stored: Record<string, PersonConstraints>
): Person[] {
  return workers.map((w) => {
    if (!Object.prototype.hasOwnProperty.call(stored, w.id)) return w;
    const merged = mergeWorkerAndOpsConstraints(w.constraints, stored[w.id]);
    return { ...w, constraints: Object.keys(merged).length > 0 ? merged : w.constraints };
  });
}

/** PUT: live 워커 + live ops + incoming을 한 helper로 합친다. */
export function constraintsForPut(
  incoming: PersonConstraints | undefined,
  liveWorker: unknown,
  liveOps: unknown
): PersonConstraints {
  return mergePersonConstraints(mergePersonConstraints(liveWorker, liveOps), incoming);
}

/** rotation_workers.constraints는 NOT NULL이라 upsert 시 null/누락을 빈 객체로 보낸다. */
export function constraintsJsonForDb(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function opsPayloadForSave(
  ops: RotationOps | undefined,
  workerConstraints: Record<string, PersonConstraints>
): Record<string, unknown> {
  return {
    ...opsFromRow(ops ?? {}),
    workerConstraints,
  };
}

export type RotationDayPayload = {
  date: string;
  productLine: ProductLine;
  modes: RotationModes;
  attendance: Record<string, boolean>;
  assignments: PeriodAssignments | null;
  saved?: boolean;
  planningLeaves?: Record<string, RotationLeaveKind>;
  planningLeaveItems?: PlanningLeaveItem[];
  unmatchedLeaves?: string[];
  plannedProducts?: PlannedRotationProduct[];
  plannedLine?: ProductLine | null;
  plannedMixed?: boolean;
};

const GROUPS: ProductGroup[] = ["phono_signature", "phono_basil_corn", "phono_ricotta", "parbake"];

export function emptyCatalog(): PositionCatalog {
  return structuredClone(DEFAULT_CATALOG);
}

export function catalogFromRows(
  rows: {
    product_group: string;
    position_id: string;
    process: string;
    label: string;
    sort_order: number;
    min_by_period?: unknown;
    max_by_period?: unknown;
  }[]
): PositionCatalog {
  const catalog = emptyCatalog();
  for (const g of GROUPS) catalog[g] = [];
  for (const row of rows) {
    const g = row.product_group as ProductGroup;
    if (!GROUPS.includes(g)) continue;
    const process = row.process as ProcessId;
    const minMap = parsePeriodStaffJson(row.min_by_period);
    const maxMap = parsePeriodStaffJson(row.max_by_period);
    let staffing = processNeedsStaffing(process) ? normalizePositionStaffing(process, undefined) : undefined;
    if (processNeedsStaffing(process) && (minMap || maxMap)) {
      const merged = normalizePositionStaffing(process, undefined)!;
      for (const period of PERIODS) {
        merged[period.id] = {
          min: minMap?.[period.id]?.min ?? merged[period.id].min,
          max: maxMap?.[period.id]?.max ?? merged[period.id].max,
        };
        if (merged[period.id].max < merged[period.id].min) {
          merged[period.id].max = merged[period.id].min;
        }
      }
      staffing = merged;
    }
    catalog[g].push(
      withDefaultStaffing({
        id: row.position_id,
        label: row.label,
        process,
        staffing,
      })
    );
  }
  for (const g of GROUPS) {
    if (catalog[g].length === 0) catalog[g] = structuredClone(DEFAULT_CATALOG[g]);
  }
  return catalog;
}

export function skillsFromRows(
  rows: { worker_id: string; product_group: string; position_id: string; priority: number }[],
  workers: Person[],
  catalog: PositionCatalog
): SkillMatrix {
  const skills: SkillMatrix = {};
  for (const w of workers) {
    skills[w.id] = { phono_signature: {}, phono_basil_corn: {}, phono_ricotta: {}, parbake: {} };
    for (const g of GROUPS) {
      for (const pos of catalog[g]) skills[w.id][g]![pos.id] = 0;
    }
  }
  for (const row of rows) {
    const g = row.product_group as ProductGroup;
    const p = row.priority;
    if (!skills[row.worker_id]) continue;
    if (!(p === 0 || p === 1 || p === 2 || p === 3 || p === 4 || p === 5)) continue;
    if (!skills[row.worker_id][g]) skills[row.worker_id][g] = {};
    skills[row.worker_id][g]![row.position_id] = p;
  }
  return skills;
}

export function workersFromRows(
  rows: {
    worker_id: string;
    name: string;
    preferred: string;
    shift: string;
    worker_group: string;
    sort_order: number;
    constraints?: unknown;
  }[]
): Person[] {
  return [...rows]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "ko"))
    .map((r) => ({
      id: r.worker_id,
      name: r.name,
      preferred: r.preferred as ProcessId,
      shift: (r.shift === "0900-1900" ? "0900-1900" : "0800-1800") as ShiftId,
      group: r.worker_group === "office" ? "office" : "floor",
      present: true,
      constraints: parsePersonConstraints(r.constraints),
    }));
}

export function seedPositionRows(org: string): {
  organization_code: string;
  product_group: ProductGroup;
  position_id: string;
  process: string;
  label: string;
  sort_order: number;
  min_by_period: Record<string, number>;
  max_by_period: Record<string, number>;
}[] {
  const out: {
    organization_code: string;
    product_group: ProductGroup;
    position_id: string;
    process: string;
    label: string;
    sort_order: number;
    min_by_period: Record<string, number>;
    max_by_period: Record<string, number>;
  }[] = [];
  for (const g of GROUPS) {
    DEFAULT_CATALOG[g].forEach((p: PositionDef, i: number) => {
      out.push({
        organization_code: org,
        product_group: g,
        position_id: p.id,
        process: p.process,
        label: p.label,
        sort_order: i,
        ...staffingColumns(p),
      });
    });
  }
  return out;
}

export function flattenPriorities(org: string, skills: SkillMatrix, catalog: PositionCatalog, workers: Person[]) {
  const rows: {
    organization_code: string;
    worker_id: string;
    product_group: ProductGroup;
    position_id: string;
    priority: number;
  }[] = [];
  for (const w of workers) {
    for (const g of GROUPS) {
      for (const pos of catalog[g]) {
        const priority = skills[w.id]?.[g]?.[pos.id] ?? 0;
        if (priority === 0) continue;
        rows.push({
          organization_code: org,
          worker_id: w.id,
          product_group: g,
          position_id: pos.id,
          priority,
        });
      }
    }
  }
  return rows;
}

function staffingColumns(p: PositionDef): {
  min_by_period: Record<string, number>;
  max_by_period: Record<string, number>;
} {
  const staffing = processNeedsStaffing(p.process) ? normalizePositionStaffing(p.process, p.staffing) : undefined;
  const min_by_period: Record<string, number> = {};
  const max_by_period: Record<string, number> = {};
  if (staffing) {
    for (const period of PERIODS) {
      min_by_period[period.id] = staffing[period.id].min;
      max_by_period[period.id] = staffing[period.id].max;
    }
  }
  return { min_by_period, max_by_period };
}

export function flattenPositions(org: string, catalog: PositionCatalog) {
  const rows: {
    organization_code: string;
    product_group: ProductGroup;
    position_id: string;
    process: string;
    label: string;
    sort_order: number;
    min_by_period: Record<string, number>;
    max_by_period: Record<string, number>;
  }[] = [];
  for (const g of GROUPS) {
    catalog[g].forEach((p, i) => {
      rows.push({
        organization_code: org,
        product_group: g,
        position_id: p.id,
        process: p.process,
        label: p.label,
        sort_order: i,
        ...staffingColumns(p),
      });
    });
  }
  return rows;
}

export function assignmentsFromRows(
  rows: { period_id: string; worker_id: string; station: string; position_id: string | null; priority: number | null }[]
): PeriodAssignments | null {
  if (rows.length === 0) return null;
  const empty: PeriodAssignments = { start: [], lunch1: [], lunch2: [], after: [] };
  for (const row of rows) {
    const period = row.period_id as PeriodId;
    if (!PERIODS.some((p) => p.id === period)) continue;
    empty[period].push({
      personId: row.worker_id,
      station: row.station as PeriodAssignments["start"][number]["station"],
      positionId: row.position_id ?? undefined,
      priority: (row.priority ?? undefined) as Priority | undefined,
    });
  }
  return empty;
}

export { productGroup, GROUPS };
