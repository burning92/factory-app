import { productKindFromSnapshot, ymd } from "@/features/production/planning/calculations";
import {
  classifyPlanningProductSnapshot,
  isMiniProductKind,
} from "@/features/production/planning/productClassification";
import type { PlanningEntryRow } from "@/features/production/planning/types";
import type { VacuumBagForecastRow, VacuumBagKindRow } from "./types";

export const VACUUM_BAG_WEEK_OPTIONS = [1, 2, 3, 4, 5, 6] as const;
export const DEFAULT_VACUUM_BAG_WEEKS = 3;

export type VacuumBagPlanKind = "pizza" | "mini";

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function resolveVacuumBagWeeks(raw: number | string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_VACUUM_BAG_WEEKS;
  const rounded = Math.round(n);
  if (rounded < 1) return 1;
  if (rounded > 12) return 12;
  return rounded;
}

export function vacuumBagForecastRange(todayIso: string, weeks: number): { start: string; end: string } {
  return {
    start: addDaysIso(todayIso, 1),
    end: addDaysIso(todayIso, weeks * 7),
  };
}

/**
 * 생산계획 행 → 진공봉투 종류.
 * 부자재 BOM 없이 플래닝 제품 분류만 사용한다.
 * - 미니(조건·2입·mini 분류) → 미니진공봉투
 * - 일반 피자·파베이크(판매)·미분류 → 피자진공봉투
 * - 브레드·파베이크(보관) → 봉투 불필요
 */
export function vacuumBagKindForPlanningEntry(productNameSnapshot: string): VacuumBagPlanKind | null {
  const snap = productNameSnapshot.trim();
  if (!snap) return null;

  const classification = classifyPlanningProductSnapshot(snap);
  const kind = productKindFromSnapshot(snap);

  if (classification.major === "bread" || classification.major === "parbake_storage") {
    return null;
  }

  if (classification.major === "pizza" && classification.pizzaSubtype === "mini") {
    return "mini";
  }
  if (isMiniProductKind(kind)) {
    return "mini";
  }

  if (
    classification.major === "pizza" ||
    classification.major === "parbake_sale" ||
    classification.major === "unclassified"
  ) {
    return "pizza";
  }

  return null;
}

/** 계획 수량 = 봉투 1장 (미니 2입도 계획 입력 수량 그대로) */
export function vacuumBagQtyFromPlanEntry(rawQty: number): number {
  const q = Number(rawQty) || 0;
  return q > 0 ? q : 0;
}

export function computeVacuumBagForecast(params: {
  kinds: VacuumBagKindRow[];
  balances: Record<string, number>;
  entries: PlanningEntryRow[];
  rangeStart: string;
  rangeEnd: string;
}): { rows: VacuumBagForecastRow[]; excluded_plan_qty: number } {
  const { kinds, balances, entries, rangeStart, rangeEnd } = params;
  const materialNameByKind = new Map(kinds.map((k) => [k.kind_key, k.planning_material_name.trim()]));
  const labelByKind = new Map(kinds.map((k) => [k.kind_key, k.label]));
  const requiredByKind = new Map<string, number>();
  for (const kind of kinds) requiredByKind.set(kind.kind_key, 0);

  let excluded_plan_qty = 0;

  for (const entry of entries) {
    if (entry.plan_date < rangeStart || entry.plan_date > rangeEnd) continue;
    const bagQty = vacuumBagQtyFromPlanEntry(entry.qty);
    if (bagQty <= 0) continue;

    const planKind = vacuumBagKindForPlanningEntry(entry.product_name_snapshot);
    if (!planKind) {
      excluded_plan_qty += bagQty;
      continue;
    }

    const curr = requiredByKind.get(planKind) ?? 0;
    requiredByKind.set(planKind, curr + bagQty);
  }

  const rows: VacuumBagForecastRow[] = kinds.map((kind) => {
    const required_qty = Number((requiredByKind.get(kind.kind_key) ?? 0).toFixed(3));
    const current_qty = Number(balances[kind.kind_key] ?? 0);
    const projected_qty = Number((current_qty - required_qty).toFixed(3));
    const is_shortage = projected_qty < 0;
    const shortage_qty = is_shortage ? Number(Math.abs(projected_qty).toFixed(3)) : 0;
    return {
      kind_key: kind.kind_key,
      label: labelByKind.get(kind.kind_key) ?? kind.label,
      planning_material_name: materialNameByKind.get(kind.kind_key) ?? kind.planning_material_name,
      current_qty,
      required_qty,
      projected_qty,
      is_shortage,
      shortage_qty,
    };
  });

  return { rows, excluded_plan_qty: Number(excluded_plan_qty.toFixed(3)) };
}
