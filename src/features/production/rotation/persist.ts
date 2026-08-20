import { DEFAULT_CATALOG } from "./catalog";
import { productGroup } from "./seedRoster";
import type { PlanningLeaveItem, RotationLeaveKind } from "./planningLeave";
import type { PlannedRotationProduct } from "./mapPlanProducts";
import type {
  PeriodAssignments,
  PeriodId,
  Person,
  PositionCatalog,
  PositionDef,
  Priority,
  ProcessId,
  ProductGroup,
  ProductLine,
  RotationModes,
  ShiftId,
  SkillMatrix,
} from "./types";
import { PERIODS } from "./types";

export type RotationMasterPayload = {
  workers: Person[];
  catalog: PositionCatalog;
  skills: SkillMatrix;
};

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
  rows: { product_group: string; position_id: string; process: string; label: string; sort_order: number }[]
): PositionCatalog {
  const catalog = emptyCatalog();
  for (const g of GROUPS) catalog[g] = [];
  for (const row of rows) {
    const g = row.product_group as ProductGroup;
    if (!GROUPS.includes(g)) continue;
    catalog[g].push({
      id: row.position_id,
      label: row.label,
      process: row.process as ProcessId,
    });
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
  rows: { worker_id: string; name: string; preferred: string; shift: string; worker_group: string; sort_order: number }[]
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
    }));
}

export function seedPositionRows(org: string): {
  organization_code: string;
  product_group: ProductGroup;
  position_id: string;
  process: string;
  label: string;
  sort_order: number;
}[] {
  const out: {
    organization_code: string;
    product_group: ProductGroup;
    position_id: string;
    process: string;
    label: string;
    sort_order: number;
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

export function flattenPositions(org: string, catalog: PositionCatalog) {
  const rows: {
    organization_code: string;
    product_group: ProductGroup;
    position_id: string;
    process: string;
    label: string;
    sort_order: number;
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
