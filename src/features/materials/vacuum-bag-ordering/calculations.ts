import { productKindFromSnapshot, ymd } from "@/features/production/planning/calculations";
import {
  classifyPlanningProductSnapshot,
  isMiniProductKind,
} from "@/features/production/planning/productClassification";
import type { PlanningEntryRow } from "@/features/production/planning/types";
import type { VacuumBagForecastRow, VacuumBagKindRow, VacuumBagMovementRow } from "./types";

export const VACUUM_BAG_WEEK_OPTIONS = [1, 2, 3, 4, 5, 6] as const;
export const DEFAULT_VACUUM_BAG_WEEKS = 3;

export type VacuumBagPlanKind = "pizza" | "mini";

export type VacuumBagStockAnchor = {
  movement_date: string;
  qty: number;
  created_at: string;
};

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

/** 계획 수량 = 봉투 1장 */
export function vacuumBagQtyFromPlanEntry(rawQty: number): number {
  const q = Number(rawQty) || 0;
  return q > 0 ? q : 0;
}

export function latestStockSetByKind(movements: VacuumBagMovementRow[]): Map<string, VacuumBagStockAnchor> {
  const map = new Map<string, VacuumBagStockAnchor>();
  const sorted = [...movements]
    .filter((m) => m.movement_type === "stock_set")
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.movement_date.localeCompare(a.movement_date));
  for (const m of sorted) {
    if (!map.has(m.kind_key)) {
      map.set(m.kind_key, {
        movement_date: m.movement_date,
        qty: m.qty,
        created_at: m.created_at,
      });
    }
  }
  return map;
}

function isMovementAfterAnchor(movement: VacuumBagMovementRow, anchor: VacuumBagStockAnchor): boolean {
  if (movement.movement_date > anchor.movement_date) return true;
  if (movement.movement_date < anchor.movement_date) return false;
  return movement.created_at > anchor.created_at;
}

export function sumPlanQtyByKind(params: {
  entries: PlanningEntryRow[];
  fromDateExclusive: string | null;
  toDateInclusive: string;
}): { pizza: number; mini: number; excluded: number } {
  const { entries, fromDateExclusive, toDateInclusive } = params;
  const totals = { pizza: 0, mini: 0, excluded: 0 };

  for (const entry of entries) {
    if (entry.plan_date > toDateInclusive) continue;
    if (fromDateExclusive != null && entry.plan_date <= fromDateExclusive) continue;

    const bagQty = vacuumBagQtyFromPlanEntry(entry.qty);
    if (bagQty <= 0) continue;

    const planKind = vacuumBagKindForPlanningEntry(entry.product_name_snapshot);
    if (!planKind) {
      totals.excluded += bagQty;
      continue;
    }
    totals[planKind] += bagQty;
  }

  return totals;
}

export function computeVacuumBagForecast(params: {
  kinds: VacuumBagKindRow[];
  balances: Record<string, number>;
  movements: VacuumBagMovementRow[];
  entries: PlanningEntryRow[];
  todayIso: string;
  rangeStart: string;
  rangeEnd: string;
}): { rows: VacuumBagForecastRow[]; excluded_plan_qty: number } {
  const { kinds, balances, movements, entries, todayIso, rangeStart, rangeEnd } = params;
  const materialNameByKind = new Map(kinds.map((k) => [k.kind_key, k.planning_material_name.trim()]));
  const labelByKind = new Map(kinds.map((k) => [k.kind_key, k.label]));
  const anchors = latestStockSetByKind(movements);

  const rows: VacuumBagForecastRow[] = kinds.map((kind) => {
    const anchor = anchors.get(kind.kind_key) ?? null;
    const receipt_qty = anchor
      ? movements
          .filter((m) => m.kind_key === kind.kind_key && m.movement_type === "receipt" && isMovementAfterAnchor(m, anchor))
          .reduce((sum, m) => sum + m.qty, 0)
      : 0;

    const autoUsedTotals = sumPlanQtyByKind({
      entries,
      fromDateExclusive: anchor?.movement_date ?? null,
      toDateInclusive: todayIso,
    });
    const auto_used_qty = Number((autoUsedTotals[kind.kind_key as VacuumBagPlanKind] ?? 0).toFixed(3));

    const futureTotals = sumPlanQtyByKind({
      entries,
      fromDateExclusive: todayIso,
      toDateInclusive: rangeEnd,
    });
    const required_qty = Number((futureTotals[kind.kind_key as VacuumBagPlanKind] ?? 0).toFixed(3));

    const base_qty = anchor ? anchor.qty : Number(balances[kind.kind_key] ?? 0);
    const current_qty = Number((base_qty + receipt_qty - auto_used_qty).toFixed(3));
    const projected_qty = Number((current_qty - required_qty).toFixed(3));
    const is_shortage = projected_qty < 0;
    const shortage_qty = is_shortage ? Number(Math.abs(projected_qty).toFixed(3)) : 0;

    return {
      kind_key: kind.kind_key,
      label: labelByKind.get(kind.kind_key) ?? kind.label,
      planning_material_name: materialNameByKind.get(kind.kind_key) ?? kind.planning_material_name,
      anchor_date: anchor?.movement_date ?? null,
      anchor_qty: anchor?.qty ?? null,
      receipt_qty: Number(receipt_qty.toFixed(3)),
      auto_used_qty,
      current_qty,
      required_qty,
      projected_qty,
      is_shortage,
      shortage_qty,
    };
  });

  const futureExcluded = sumPlanQtyByKind({
    entries,
    fromDateExclusive: todayIso,
    toDateInclusive: rangeEnd,
  }).excluded;

  return { rows, excluded_plan_qty: Number(futureExcluded.toFixed(3)) };
}
