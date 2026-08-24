import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, verifyRoleAccess } from "@/app/api/materials/purchasing/_auth";
import { assignmentsFromRows, type RotationDayPayload } from "@/features/production/rotation/persist";
import {
  leaveKindFromPlanningType,
  leaveItemsToMap,
  matchLeaveToWorkerId,
  mergeLeaveKind,
  parseOtherLeaveNote,
  rangeAppliesToDate,
  type PlanningLeaveItem,
  type RotationLeaveKind,
} from "@/features/production/rotation/planningLeave";
import { ROTATION_FACTORY_ORG } from "@/features/production/rotation/factoryOrg";
import { summarizePlannedRotationProducts } from "@/features/production/rotation/mapPlanProducts";
import { overridesFromDbRows } from "@/features/production/planning/productClassification";
import { PERIODS, type PeriodId } from "@/features/production/rotation/types";

const READ_ROLES = ["manager", "quality_manager", "headquarters", "admin"];
const WRITE_ROLES = ["manager", "quality_manager", "headquarters", "admin"];

async function resolvePlanningMonths(
  admin: ReturnType<typeof createAdminClient>,
  date: string
): Promise<{ ids: string[]; preferred: string | null }> {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const { data: months } = await admin
    .from("production_plan_months")
    .select("id,version_type")
    .eq("plan_year", year)
    .eq("plan_month", month);
  const monthRows = (months ?? []) as { id: string; version_type: string }[];
  const preferred =
    monthRows.find((m) => m.version_type === "master")?.id ??
    monthRows.find((m) => m.version_type === "end")?.id ??
    monthRows.find((m) => m.version_type === "draft")?.id ??
    monthRows[0]?.id ??
    null;
  return { ids: monthRows.map((m) => m.id), preferred };
}

async function loadMatchWorkers(admin: ReturnType<typeof createAdminClient>) {
  const [{ data: workerRows }, { data: org }] = await Promise.all([
    admin.from("rotation_workers").select("worker_id,name").eq("organization_code", ROTATION_FACTORY_ORG).eq("is_active", true),
    admin.from("organizations").select("id").eq("organization_code", ROTATION_FACTORY_ORG).maybeSingle(),
  ]);
  const workers: { id: string; name: string; loginId?: string | null }[] = (workerRows ?? []).map((w) => ({
    id: String(w.worker_id),
    name: String(w.name ?? ""),
  }));
  if (org?.id) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id,display_name,login_id")
      .eq("organization_id", org.id)
      .eq("is_active", true);
    for (const p of profiles ?? []) {
      const id = String(p.id);
      if (workers.some((w) => w.id === id)) {
        const row = workers.find((w) => w.id === id)!;
        row.loginId = p.login_id;
        if (!row.name) row.name = String(p.display_name ?? p.login_id ?? "");
        continue;
      }
      workers.push({
        id,
        name: String(p.display_name ?? p.login_id ?? ""),
        loginId: p.login_id,
      });
    }
  }
  return workers;
}

function pushLeave(
  items: PlanningLeaveItem[],
  workers: { id: string; name: string; loginId?: string | null }[],
  personName: string,
  kind: RotationLeaveKind,
  source: PlanningLeaveItem["source"],
  profileId: string | null,
  detail?: string
) {
  const name = personName.trim();
  if (!name || kind === "none") return;
  const workerId = matchLeaveToWorkerId(workers, profileId, name);
  const existing = items.find((i) => (workerId && i.workerId === workerId) || i.name === name);
  if (existing) {
    existing.kind = mergeLeaveKind(existing.kind, kind);
    if (detail && !existing.detail) existing.detail = detail;
    if (workerId) existing.workerId = workerId;
    return;
  }
  items.push({ name, kind, workerId, source, detail });
}

async function loadPlanningLeaves(
  admin: ReturnType<typeof createAdminClient>,
  date: string,
  monthIds: string[],
  workers: { id: string; name: string; loginId?: string | null }[]
): Promise<{ items: PlanningLeaveItem[]; leaves: Record<string, RotationLeaveKind>; unmatched: string[] }> {
  const items: PlanningLeaveItem[] = [];

  const leaveQuery = admin.from("production_plan_leaves").select("leave_type,person_name,profile_id,plan_date");
  const { data: dayLeaves } = monthIds.length
    ? await leaveQuery.in("month_id", monthIds).eq("plan_date", date)
    : await leaveQuery.eq("plan_date", date);
  for (const row of dayLeaves ?? []) {
    const planDate = String(row.plan_date ?? "").slice(0, 10);
    if (planDate && planDate !== date) continue;
    pushLeave(
      items,
      workers,
      String(row.person_name ?? ""),
      leaveKindFromPlanningType(String(row.leave_type ?? "annual")),
      "day",
      row.profile_id != null ? String(row.profile_id) : null
    );
  }

  const notesQuery = admin.from("production_plan_notes").select("note_text,plan_date").eq("plan_date", date);
  const { data: notes } = monthIds.length ? await notesQuery.in("month_id", monthIds) : await notesQuery;
  for (const row of notes ?? []) {
    const parsed = parseOtherLeaveNote(String(row.note_text ?? ""));
    if (!parsed) continue;
    pushLeave(items, workers, parsed.person_name, "other", "other", null, parsed.detail);
  }

  const { data: ranges } = await admin
    .from("planning_range_entries")
    .select("person_name,entry_type,start_date,end_date,apply_mode")
    .lte("start_date", date)
    .gte("end_date", date);
  for (const row of ranges ?? []) {
    const start = String(row.start_date).slice(0, 10);
    const end = String(row.end_date).slice(0, 10);
    if (!rangeAppliesToDate(date, start, end, String(row.apply_mode ?? "all_days"))) continue;
    pushLeave(
      items,
      workers,
      String(row.person_name ?? ""),
      leaveKindFromPlanningType(String(row.entry_type ?? "annual")),
      "range",
      null
    );
  }

  return {
    items,
    leaves: leaveItemsToMap(items),
    unmatched: Array.from(new Set(items.filter((i) => !i.workerId).map((i) => i.name))),
  };
}

export async function GET(req: NextRequest) {
  const auth = await verifyRoleAccess({
    authorizationHeader: req.headers.get("authorization"),
    refreshTokenHeader: req.headers.get("x-refresh-token"),
    allowedRoles: READ_ROLES,
  });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date_required" }, { status: 400 });
  }
  const org = ROTATION_FACTORY_ORG;
  const admin = createAdminClient();
  const [{ data: meta }, { data: att }, { data: asg }, matchWorkers, months] = await Promise.all([
    admin.from("rotation_day_meta").select("product_line,lunch,break_rotation,split_shift").eq("organization_code", org).eq("work_date", date).maybeSingle(),
    admin.from("rotation_day_attendance").select("worker_id,present").eq("organization_code", org).eq("work_date", date),
    admin.from("rotation_day_assignments").select("period_id,worker_id,station,position_id,priority,is_manual").eq("organization_code", org).eq("work_date", date),
    loadMatchWorkers(admin),
    resolvePlanningMonths(admin, date),
  ]);
  const attendance: Record<string, boolean> = {};
  for (const row of att ?? []) attendance[row.worker_id] = row.present;
  const manual = (asg ?? []).filter((r) => r.is_manual);
  const monthId = months.preferred;
  const [{ data: classRows }, { data: planEntries }, planned] = await Promise.all([
    admin.from("planning_product_classifications").select("base_name,major,pizza_subtype"),
    monthId
      ? admin.from("production_plan_entries").select("product_name_snapshot,qty").eq("month_id", monthId).eq("plan_date", date)
      : Promise.resolve({ data: [] as { product_name_snapshot: string; qty: number }[] }),
    loadPlanningLeaves(admin, date, months.ids, matchWorkers),
  ]);
  const overrides = overridesFromDbRows((classRows ?? []) as { base_name: string; major: string; pizza_subtype: string | null }[]);
  const plannedProducts = summarizePlannedRotationProducts(
    (planEntries ?? []).map((e) => ({
      name: String(e.product_name_snapshot ?? ""),
      qty: Number(e.qty) || 0,
    })),
    overrides
  );
  const payload: RotationDayPayload = {
    date,
    productLine: plannedProducts.plannedLine ?? (meta?.product_line as RotationDayPayload["productLine"]) ?? "phono_signature",
    modes: {
      lunch: meta?.lunch ?? true,
      breakRotation: meta?.break_rotation ?? false,
      splitShift: meta?.split_shift ?? false,
    },
    attendance,
    assignments: assignmentsFromRows(manual),
    saved: Boolean(meta),
    planningLeaves: planned.leaves,
    planningLeaveItems: planned.items,
    unmatchedLeaves: planned.unmatched,
    plannedProducts: plannedProducts.products,
    plannedLine: plannedProducts.plannedLine,
    plannedMixed: plannedProducts.mixed,
  };
  return NextResponse.json({ ok: true, data: payload });
}

export async function PUT(req: NextRequest) {
  const auth = await verifyRoleAccess({
    authorizationHeader: req.headers.get("authorization"),
    refreshTokenHeader: req.headers.get("x-refresh-token"),
    allowedRoles: WRITE_ROLES,
  });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: RotationDayPayload;
  try {
    body = (await req.json()) as RotationDayPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body?.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return NextResponse.json({ error: "date_required" }, { status: 400 });
  }
  const org = ROTATION_FACTORY_ORG;
  const admin = createAdminClient();
  const { error: mErr } = await admin.from("rotation_day_meta").upsert({
    organization_code: org,
    work_date: body.date,
    product_line: body.productLine,
    lunch: body.modes.lunch,
    break_rotation: body.modes.breakRotation,
    split_shift: body.modes.splitShift,
    updated_at: new Date().toISOString(),
  });
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  await admin.from("rotation_day_attendance").delete().eq("organization_code", org).eq("work_date", body.date);
  const attRows = Object.entries(body.attendance ?? {}).map(([worker_id, present]) => ({
    organization_code: org,
    work_date: body.date,
    worker_id,
    present,
  }));
  if (attRows.length > 0) {
    const { error } = await admin.from("rotation_day_attendance").insert(attRows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await admin.from("rotation_day_assignments").delete().eq("organization_code", org).eq("work_date", body.date);
  if (body.assignments) {
    const rows = [];
    for (const period of PERIODS) {
      for (const a of body.assignments[period.id as PeriodId]) {
        rows.push({
          organization_code: org,
          work_date: body.date,
          period_id: period.id,
          worker_id: a.personId,
          station: a.station,
          position_id: a.positionId ?? null,
          priority: a.priority ?? null,
          is_manual: true,
        });
      }
    }
    if (rows.length > 0) {
      const { error } = await admin.from("rotation_day_assignments").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
