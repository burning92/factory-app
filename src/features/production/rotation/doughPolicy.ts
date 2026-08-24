import { positionsForProcess } from "./catalog";
import { staffingForPosition } from "./staffing";
import type { DoughRotationPolicy, DoughSettings, PositionCatalog, ProductGroup } from "./types";

export const DEFAULT_DOUGH_POLICY: DoughRotationPolicy = "CURRENT_LUNCH_BACKUP";

export function isDoughRotationPolicy(value: unknown): value is DoughRotationPolicy {
  return value === "CURRENT_LUNCH_BACKUP" || value === "FIXED_DOUGH";
}

export function defaultDoughMinStaff(catalog?: PositionCatalog, group?: ProductGroup): number {
  if (!catalog || !group) return 3;
  const pos = positionsForProcess(catalog, group, "dough")[0];
  if (!pos) return 3;
  return Math.max(0, staffingForPosition(pos, "start").min);
}

export function normalizeDoughSettings(
  raw: DoughSettings | undefined,
  catalog?: PositionCatalog,
  group?: ProductGroup
): { minStaff: number; rotationPolicy: DoughRotationPolicy } {
  const fallbackMin = defaultDoughMinStaff(catalog, group);
  const n = Number(raw?.minStaff);
  const minStaff = Number.isFinite(n) && n >= 0 ? Math.min(20, Math.round(n)) : fallbackMin;
  return {
    minStaff,
    rotationPolicy: isDoughRotationPolicy(raw?.rotationPolicy) ? raw.rotationPolicy : DEFAULT_DOUGH_POLICY,
  };
}
