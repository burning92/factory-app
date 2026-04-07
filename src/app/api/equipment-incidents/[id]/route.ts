import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import {
  assertNoForbiddenKeysForLinkedPatch,
  parseEquipmentIncidentLinkedPatch,
  parseEquipmentIncidentManualPatch,
  type EquipmentIncidentRow,
} from "@/features/daily/equipmentIncidents";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const AUTH_KEYS = new Set(["access_token", "refresh_token", "organization_code"]);

function patchBodyOnly(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!AUTH_KEYS.has(k)) out[k] = v;
  }
  return out;
}

async function resolveSessionUser(access_token: string, refresh_token: string) {
  const anon = createClient(url, anonKey);
  const {
    data: { user },
    error: sessionError,
  } = await anon.auth.setSession({ access_token, refresh_token });
  if (sessionError || !user) return { user: null as null };
  return { user };
}

async function loadProfileOrgCode(admin: ReturnType<typeof getSupabaseAdmin>, userId: string) {
  const { data: prof } = await admin.from("profiles").select("organization_id, role").eq("id", userId).maybeSingle();
  if (!prof) return { orgCode: null as string | null, role: null as string | null };
  const { data: org } = await admin
    .from("organizations")
    .select("organization_code")
    .eq("id", (prof as { organization_id: string }).organization_id)
    .maybeSingle();
  const orgCode = (org as { organization_code: string } | null)?.organization_code ?? null;
  return { orgCode, role: (prof as { role: string }).role };
}

function canAccessOrg(
  role: string | null,
  userHomeOrgCode: string | null,
  targetOrgCode: string
): boolean {
  if (!userHomeOrgCode) return false;
  if (targetOrgCode === userHomeOrgCode) return true;
  if (role === "manager" || role === "admin") {
    return targetOrgCode === "100" || targetOrgCode === "200";
  }
  return false;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const access_token = typeof body.access_token === "string" ? body.access_token : "";
  const refresh_token = typeof body.refresh_token === "string" ? body.refresh_token : "";
  const organization_code = typeof body.organization_code === "string" ? body.organization_code : "";
  if (!access_token || !refresh_token || !organization_code) {
    return NextResponse.json(
      { error: "access_token, refresh_token, organization_code가 필요합니다." },
      { status: 400 }
    );
  }

  if (!url || !anonKey) {
    return NextResponse.json({ error: "서버 환경 변수 오류" }, { status: 500 });
  }

  const { user } = await resolveSessionUser(access_token, refresh_token);
  if (!user) {
    return NextResponse.json({ error: "인증 실패" }, { status: 401 });
  }

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: "서버 Supabase 설정 오류" }, { status: 500 });
  }

  const { orgCode: profileOrgCode, role } = await loadProfileOrgCode(admin, user.id);
  if (!canAccessOrg(role, profileOrgCode, organization_code)) {
    return NextResponse.json({ error: "이 조직 데이터를 수정할 권한이 없습니다." }, { status: 403 });
  }

  const { data: row, error: loadErr } = await admin
    .from("equipment_incidents")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  }

  const incident = row as EquipmentIncidentRow;
  if (incident.organization_code !== organization_code) {
    return NextResponse.json({ error: "조직이 일치하지 않습니다." }, { status: 403 });
  }

  const rawPatch = patchBodyOnly(body);
  const updated_at = new Date().toISOString();

  if (incident.source_type === "linked_from_inspection") {
    const forbidden = assertNoForbiddenKeysForLinkedPatch(rawPatch);
    if (forbidden) {
      return NextResponse.json({ error: forbidden }, { status: 400 });
    }
    const { patch, error: pe } = parseEquipmentIncidentLinkedPatch(rawPatch);
    if (!patch || pe) {
      return NextResponse.json({ error: pe ?? "유효하지 않은 본문" }, { status: 400 });
    }
    const { error: upErr } = await admin
      .from("equipment_incidents")
      .update({
        has_production_impact: patch.has_production_impact,
        action_status: patch.action_status,
        resumed_at: patch.resumed_at,
        notes: patch.notes,
        updated_at,
      })
      .eq("id", id);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const { patch, error: me } = parseEquipmentIncidentManualPatch(rawPatch);
  if (!patch || me) {
    return NextResponse.json({ error: me ?? "유효하지 않은 본문" }, { status: 400 });
  }

  const { error: upErr } = await admin
    .from("equipment_incidents")
    .update({
      equipment_name: patch.equipment_name,
      equipment_custom_name: patch.equipment_custom_name,
      occurred_at: patch.occurred_at,
      incident_type: patch.incident_type,
      symptom_type: patch.symptom_type,
      symptom_other: patch.symptom_other,
      detail: patch.detail,
      has_production_impact: patch.has_production_impact,
      action_status: patch.action_status,
      resumed_at: patch.resumed_at,
      notes: patch.notes,
      updated_at,
    })
    .eq("id", id);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const access_token = typeof body.access_token === "string" ? body.access_token : "";
  const refresh_token = typeof body.refresh_token === "string" ? body.refresh_token : "";
  const organization_code = typeof body.organization_code === "string" ? body.organization_code : "";
  if (!access_token || !refresh_token || !organization_code) {
    return NextResponse.json(
      { error: "access_token, refresh_token, organization_code가 필요합니다." },
      { status: 400 }
    );
  }

  if (!url || !anonKey) {
    return NextResponse.json({ error: "서버 환경 변수 오류" }, { status: 500 });
  }

  const { user } = await resolveSessionUser(access_token, refresh_token);
  if (!user) {
    return NextResponse.json({ error: "인증 실패" }, { status: 401 });
  }

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: "서버 Supabase 설정 오류" }, { status: 500 });
  }

  const { orgCode: profileOrgCode, role } = await loadProfileOrgCode(admin, user.id);
  if (!canAccessOrg(role, profileOrgCode, organization_code)) {
    return NextResponse.json({ error: "이 조직 데이터를 삭제할 권한이 없습니다." }, { status: 403 });
  }

  const { data: row, error: loadErr } = await admin
    .from("equipment_incidents")
    .select("id, organization_code, source_type")
    .eq("id", id)
    .maybeSingle();

  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  }

  const incident = row as { organization_code: string; source_type: string };
  if (incident.organization_code !== organization_code) {
    return NextResponse.json({ error: "조직이 일치하지 않습니다." }, { status: 403 });
  }
  if (incident.source_type !== "manual") {
    return NextResponse.json({ error: "점검표 연동 건은 삭제할 수 없습니다." }, { status: 400 });
  }

  const { error: delErr } = await admin.from("equipment_incidents").delete().eq("id", id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
