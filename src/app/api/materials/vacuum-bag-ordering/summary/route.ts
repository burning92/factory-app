import { NextRequest, NextResponse } from "next/server";
import { getPlanningMonthData } from "@/features/production/planning/getPlanningMonthData";
import { ymd } from "@/features/production/planning/calculations";
import type { PlanningVersionType } from "@/features/production/planning/types";
import {
  addDaysIso,
  computeVacuumBagForecast,
  resolveVacuumBagWeeks,
  vacuumBagForecastRange,
} from "@/features/materials/vacuum-bag-ordering/calculations";
import type { VacuumBagKindRow, VacuumBagMovementRow, VacuumBagSummaryData } from "@/features/materials/vacuum-bag-ordering/types";
import { createAdminClient, verifyPurchasingAccess } from "@/app/api/materials/purchasing/_auth";

function toVersion(v: string | null): PlanningVersionType {
  if (v === "draft") return "draft";
  if (v === "end") return "end";
  return "master";
}

function monthTargetsBetween(startIso: string, endIso: string): Array<{ year: number; month: number }> {
  const targets: Array<{ year: number; month: number }> = [];
  const cursor = new Date(`${startIso}T00:00:00`);
  const endDate = new Date(`${endIso}T00:00:00`);
  while (cursor <= endDate) {
    const target = { year: cursor.getFullYear(), month: cursor.getMonth() + 1 };
    if (!targets.some((m) => m.year === target.year && m.month === target.month)) targets.push(target);
    cursor.setMonth(cursor.getMonth() + 1, 1);
  }
  return targets;
}

export async function GET(req: NextRequest) {
  const auth = await verifyPurchasingAccess({
    authorizationHeader: req.headers.get("authorization"),
    refreshTokenHeader: req.headers.get("x-refresh-token"),
  });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = req.nextUrl.searchParams;
  const weeks = resolveVacuumBagWeeks(sp.get("weeks"));
  const version = toVersion(sp.get("version"));
  const today = new Date();
  const todayIso = ymd(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const { start, end } = vacuumBagForecastRange(todayIso, weeks);
  const planFetchStart = addDaysIso(todayIso, -90);

  try {
    const admin = createAdminClient();
    const monthTargets = monthTargetsBetween(planFetchStart, end);
    if (monthTargets.length === 0) {
      monthTargets.push({ year: today.getFullYear(), month: today.getMonth() + 1 });
    }

    const [kindsRes, balancesRes, movementsRes, recentMovementsRes, ...planningMonths] = await Promise.all([
      admin.from("vacuum_bag_kinds").select("kind_key,label,planning_material_name,sort_order").order("sort_order"),
      admin.from("vacuum_bag_balances").select("kind_key,current_qty"),
      admin.from("vacuum_bag_movements").select("id,kind_key,movement_type,qty,movement_date,memo,created_at").order("created_at", { ascending: true }),
      admin
        .from("vacuum_bag_movements")
        .select("id,kind_key,movement_type,qty,movement_date,memo,created_at")
        .order("created_at", { ascending: false })
        .limit(30),
      ...monthTargets.map((m) => getPlanningMonthData(m.year, m.month, version)),
    ]);

    if (kindsRes.error) throw kindsRes.error;
    if (balancesRes.error) throw balancesRes.error;
    if (movementsRes.error) throw movementsRes.error;
    if (recentMovementsRes.error) throw recentMovementsRes.error;

    const kinds = (kindsRes.data ?? []) as VacuumBagKindRow[];
    const balances: Record<string, number> = {};
    for (const row of balancesRes.data ?? []) {
      balances[String(row.kind_key)] = Number(row.current_qty) || 0;
    }
    for (const kind of kinds) {
      if (balances[kind.kind_key] == null) balances[kind.kind_key] = 0;
    }

    const mapMovement = (r: Record<string, unknown>): VacuumBagMovementRow => ({
      id: String(r.id ?? ""),
      kind_key: String(r.kind_key ?? ""),
      movement_type: r.movement_type as VacuumBagMovementRow["movement_type"],
      qty: Number(r.qty) || 0,
      movement_date: String(r.movement_date ?? ""),
      memo: r.memo != null ? String(r.memo) : null,
      created_at: String(r.created_at ?? ""),
    });

    const allMovements = ((movementsRes.data ?? []) as Record<string, unknown>[]).map(mapMovement);
    const mergedEntries = planningMonths.flatMap((m) => m.entries);

    const { rows: forecast_rows, excluded_plan_qty } = computeVacuumBagForecast({
      kinds,
      balances,
      movements: allMovements,
      entries: mergedEntries,
      todayIso,
      rangeStart: start,
      rangeEnd: end,
    });

    const data: VacuumBagSummaryData = {
      today_iso: todayIso,
      weeks,
      range_start: start,
      range_end: end,
      kinds,
      balances,
      forecast_rows,
      recent_movements: ((recentMovementsRes.data ?? []) as Record<string, unknown>[]).map(mapMovement),
      entries: mergedEntries.filter((e) => e.plan_date >= start && e.plan_date <= end),
      excluded_plan_qty,
    };

    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "summary_failed";
    return NextResponse.json({ ok: false, error: "summary_failed", message }, { status: 500 });
  }
}
