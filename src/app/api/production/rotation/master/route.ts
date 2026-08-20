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

type ProfileRow = {
  id: string;
  display_name: string | null;
  login_id: string | null;
  role: string | null;
  is_active: boolean | null;
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
    .select("id,display_name,login_id,role,is_active")
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
  if (eErr) return { admin, error: eErr.message, workerRows: [] as { worker_id: string; name: string; preferred: string; shift: string; worker_group: string; sort_order: number }[] };

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
    if (error) return { admin, error: error.message, workerRows: [] as typeof upserts };
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
  if (wErr) return { admin, error: wErr.message, workerRows: [] as NonNullable<typeof workerRows> };
  return { admin, error: null as string | null, workerRows: workerRows ?? [] };
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

  let { data: posRows, error: pErr } = await admin
    .from("rotation_positions")
    .select("product_group,position_id,process,label,sort_order")
    .eq("organization_code", org)
    .order("sort_order");
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  if (!posRows || posRows.length === 0) {
    const seed = seedPositionRows(org);
    const { error } = await admin.from("rotation_positions").upsert(seed, {
      onConflict: "organization_code,product_group,position_id",
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    posRows = seed.map((s) => ({
      product_group: s.product_group,
      position_id: s.position_id,
      process: s.process,
      label: s.label,
      sort_order: s.sort_order,
    }));
  }

  const { data: priRows, error: priErr } = await admin
    .from("rotation_priorities")
    .select("worker_id,product_group,position_id,priority")
    .eq("organization_code", org);
  if (priErr) return NextResponse.json({ error: priErr.message }, { status: 500 });

  const workers = workersFromRows(synced.workerRows);
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

  for (const group of Object.keys(body.catalog) as ProductGroup[]) {
    for (const pos of body.catalog[group]) {
      for (const rank of [1, 2, 3, 4] as const) {
        const holders = (body.workers as Person[]).filter(
          (w) => (body.skills[w.id]?.[group]?.[pos.id] ?? 0) === rank
        );
        if (holders.length > 1) {
          return NextResponse.json(
            { error: "duplicate_rank", message: `${pos.label} ${rank}순위가 여러 명입니다.` },
            { status: 409 }
          );
        }
      }
    }
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
  const { error: pErr } = await admin.from("rotation_positions").insert(posRows);
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  await admin.from("rotation_priorities").delete().eq("organization_code", org);
  if (priRows.length > 0) {
    const { error: priErr } = await admin.from("rotation_priorities").insert(priRows);
    if (priErr) return NextResponse.json({ error: priErr.message, message: priErr.message }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
