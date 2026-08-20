import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, verifyRoleAccess } from "@/app/api/materials/purchasing/_auth";
import {
  catalogFromRows,
  flattenPositions,
  flattenPriorities,
  seedPositionRows,
  skillsFromRows,
  workersFromRows,
  type RotationMasterPayload,
} from "@/features/production/rotation/persist";
import { ROTATION_FACTORY_ORG } from "@/features/production/rotation/factoryOrg";
import { defaultWorkerFields } from "@/features/production/rotation/planningLeave";
import {
  isExcludedFromFieldHeadcountByLoginId,
  isFieldHeadcountRole,
} from "@/lib/profileFieldHeadcount";
import type { Person, ProductGroup } from "@/features/production/rotation/types";

const READ_ROLES = ["worker", "assistant_manager", "manager", "quality_manager", "headquarters", "admin"];
const WRITE_ROLES = ["manager", "quality_manager", "headquarters", "admin"];

const POS_COLS =
  "product_group,position_id,process,label,sort_order,min_by_period,max_by_period";
const POS_COLS_BASIC = "product_group,position_id,process,label,sort_order";

function missingStaffingColumn(message: string): boolean {
  return /min_by_period|max_by_period|schema cache/i.test(message);
}

type PositionRow = {
  product_group: string;
  position_id: string;
  process: string;
  label: string;
  sort_order: number;
  min_by_period?: unknown;
  max_by_period?: unknown;
};

async function loadPositionRows(admin: ReturnType<typeof createAdminClient>, org: string) {
  const withStaff = await admin
    .from("rotation_positions")
    .select(POS_COLS)
    .eq("organization_code", org)
    .order("sort_order");
  if (!withStaff.error) return { rows: (withStaff.data ?? []) as PositionRow[], error: null as string | null };
  if (!missingStaffingColumn(withStaff.error.message)) {
    return { rows: [] as PositionRow[], error: withStaff.error.message };
  }
  const basic = await admin
    .from("rotation_positions")
    .select(POS_COLS_BASIC)
    .eq("organization_code", org)
    .order("sort_order");
  if (basic.error) return { rows: [] as PositionRow[], error: basic.error.message };
  return { rows: (basic.data ?? []) as PositionRow[], error: null as string | null };
}

function withoutStaffingColumns<T extends { min_by_period?: unknown; max_by_period?: unknown }>(rows: T[]) {
  return rows.map(({ min_by_period: _min, max_by_period: _max, ...rest }) => rest);
}

async function upsertPositionRows(
  admin: ReturnType<typeof createAdminClient>,
  rows: ReturnType<typeof seedPositionRows>
) {
  const first = await admin.from("rotation_positions").upsert(rows, {
    onConflict: "organization_code,product_group,position_id",
  });
  if (!first.error) return null;
  if (!missingStaffingColumn(first.error.message)) return first.error.message;
  const retry = await admin.from("rotation_positions").upsert(withoutStaffingColumns(rows), {
    onConflict: "organization_code,product_group,position_id",
  });
  return retry.error?.message ?? null;
}

async function insertPositionRows(
  admin: ReturnType<typeof createAdminClient>,
  rows: ReturnType<typeof flattenPositions>
) {
  const first = await admin.from("rotation_positions").insert(rows);
  if (!first.error) return null;
  if (!missingStaffingColumn(first.error.message)) return first.error.message;
  const retry = await admin.from("rotation_positions").insert(withoutStaffingColumns(rows));
  return retry.error?.message ?? null;
}

type ProfileRow = {
  id: string;
  display_name: string | null;
  login_id: string | null;
  role: string | null;
  is_active: boolean | null;
  hire_date: string | null;
};

async function factoryProfiles() {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("organization_code", ROTATION_FACTORY_ORG)
    .maybeSingle();
  if (!org?.id) return { admin, profiles: [] as ProfileRow[] };
  const { data } = await admin
    .from("profiles")
    .select("id,display_name,login_id,role,is_active,hire_date")
    .eq("organization_id", org.id)
    .eq("is_active", true);
  const profiles = ((data ?? []) as ProfileRow[]).filter(
    (p) =>
      p.is_active !== false &&
      isFieldHeadcountRole(p.role) &&
      !isExcludedFromFieldHeadcountByLoginId(p.login_id)
  );
  profiles.sort((a, b) => {
    const an = (a.display_name ?? a.login_id ?? "").trim();
    const bn = (b.display_name ?? b.login_id ?? "").trim();
    return an.localeCompare(bn, "ko");
  });
  return { admin, profiles };
}

async function syncWorkersFromProfiles() {
  const { admin, profiles } = await factoryProfiles();
  const org = ROTATION_FACTORY_ORG;
  const { data: existing, error: eErr } = await admin
    .from("rotation_workers")
    .select("worker_id,preferred,shift,worker_group,sort_order,is_active")
    .eq("organization_code", org);
  if (eErr) return { admin, error: eErr.message, workerRows: [] as { worker_id: string; name: string; preferred: string; shift: string; worker_group: string; sort_order: number }[], profiles };

  const byId = new Map((existing ?? []).map((r) => [String(r.worker_id), r]));
  const keep = new Set(profiles.map((p) => p.id));
  const upserts = profiles.map((p, i) => {
    const name = (p.display_name ?? "").trim() || (p.login_id ?? "").trim() || p.id;
    const prev = byId.get(p.id);
    const hint = defaultWorkerFields(name);
    return {
      organization_code: org,
      worker_id: p.id,
      name,
      preferred: prev?.preferred ?? hint.preferred,
      shift: prev?.shift ?? hint.shift,
      worker_group: prev?.worker_group ?? hint.group,
      sort_order: i,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
  });
  if (upserts.length > 0) {
    const { error } = await admin.from("rotation_workers").upsert(upserts, { onConflict: "organization_code,worker_id" });
    if (error) return { admin, error: error.message, workerRows: [] as typeof upserts, profiles };
  }
  const gone = (existing ?? []).filter((r) => !keep.has(String(r.worker_id)));
  if (gone.length > 0) {
    await admin
      .from("rotation_workers")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("organization_code", org)
      .in(
        "worker_id",
        gone.map((r) => String(r.worker_id))
      );
  }
  const { data: workerRows, error: wErr } = await admin
    .from("rotation_workers")
    .select("worker_id,name,preferred,shift,worker_group,sort_order")
    .eq("organization_code", org)
    .eq("is_active", true)
    .order("sort_order");
  if (wErr) return { admin, error: wErr.message, workerRows: [] as NonNullable<typeof workerRows>, profiles };
  return { admin, error: null as string | null, workerRows: workerRows ?? [], profiles };
}

export async function GET(req: NextRequest) {
  const auth = await verifyRoleAccess({
    authorizationHeader: req.headers.get("authorization"),
    refreshTokenHeader: req.headers.get("x-refresh-token"),
    allowedRoles: READ_ROLES,
  });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const org = ROTATION_FACTORY_ORG;
  const synced = await syncWorkersFromProfiles();
  if (synced.error) return NextResponse.json({ error: synced.error }, { status: 500 });
  const admin = synced.admin;

  const loaded = await loadPositionRows(admin, org);
  if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: 500 });
  let posRows = loaded.rows;

  if (!posRows || posRows.length === 0) {
    const seed = seedPositionRows(org);
    const seedErr = await upsertPositionRows(admin, seed);
    if (seedErr) return NextResponse.json({ error: seedErr }, { status: 500 });
    posRows = seed.map((s) => ({
      product_group: s.product_group,
      position_id: s.position_id,
      process: s.process,
      label: s.label,
      sort_order: s.sort_order,
      min_by_period: s.min_by_period,
      max_by_period: s.max_by_period,
    }));
  }

  const { data: priRows, error: priErr } = await admin
    .from("rotation_priorities")
    .select("worker_id,product_group,position_id,priority")
    .eq("organization_code", org);
  if (priErr) return NextResponse.json({ error: priErr.message }, { status: 500 });

  const workers = workersFromRows(synced.workerRows).map((w) => {
    const hire = synced.profiles.find((p) => p.id === w.id)?.hire_date;
    return { ...w, hireDate: hire ? String(hire).slice(0, 10) : null };
  });
  const catalog = catalogFromRows(posRows);
  const skills = skillsFromRows(priRows ?? [], workers, catalog);
  return NextResponse.json({ ok: true, data: { workers, catalog, skills } satisfies RotationMasterPayload });
}

export async function PUT(req: NextRequest) {
  const auth = await verifyRoleAccess({
    authorizationHeader: req.headers.get("authorization"),
    refreshTokenHeader: req.headers.get("x-refresh-token"),
    allowedRoles: WRITE_ROLES,
  });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const org = ROTATION_FACTORY_ORG;
  let body: RotationMasterPayload;
  try {
    body = (await req.json()) as RotationMasterPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body?.catalog || !body?.skills || !Array.isArray(body.workers)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const synced = await syncWorkersFromProfiles();
  if (synced.error) return NextResponse.json({ error: synced.error }, { status: 500 });
  const allowed = new Set(synced.workerRows.map((w) => w.worker_id));
  const workers = body.workers.filter((w) => allowed.has(w.id));
  const admin = synced.admin;
  const workerRows = workers.map((w, i) => {
    const live = synced.workerRows.find((r) => r.worker_id === w.id);
    return {
      organization_code: org,
      worker_id: w.id,
      name: live?.name ?? w.name,
      preferred: w.preferred,
      shift: w.shift,
      worker_group: w.group,
      sort_order: i,
      is_active: true,
      updated_at: new Date().toISOString(),
    };
  });
  const posRows = flattenPositions(org, body.catalog);
  const priRows = flattenPriorities(org, body.skills, body.catalog, workers);

  if (workerRows.length > 0) {
    const { error: wErr } = await admin.from("rotation_workers").upsert(workerRows, { onConflict: "organization_code,worker_id" });
    if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 });
  }

  await admin.from("rotation_positions").delete().eq("organization_code", org);
  const pErr = await insertPositionRows(admin, posRows);
  if (pErr) return NextResponse.json({ error: pErr }, { status: 500 });

  await admin.from("rotation_priorities").delete().eq("organization_code", org);
  if (priRows.length > 0) {
    const { error: priErr } = await admin.from("rotation_priorities").insert(priRows);
    if (priErr) return NextResponse.json({ error: priErr.message, message: priErr.message }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
