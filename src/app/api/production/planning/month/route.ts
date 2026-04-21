import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPlanningMonthData } from "@/features/production/planning/getPlanningMonthData";
import type { PlanningVersionType } from "@/features/production/planning/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function toVersion(v: string | null): PlanningVersionType {
  if (v === "draft") return "draft";
  if (v === "end") return "end";
  return "master";
}

export async function GET(req: NextRequest) {
  if (!serviceRoleKey) return NextResponse.json({ error: "server_config_error" }, { status: 500 });
  const authHeader = req.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const refreshToken = (req.headers.get("x-refresh-token") ?? "").trim();
  if (!accessToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const anon = createClient(url, anonKey);
  // 로컬/세션 환경에 따라 refresh_token이 없을 수 있으므로 access token 단독 검증을 우선 사용한다.
  const {
    data: { user: userFromAccess },
    error: userErr,
  } = await anon.auth.getUser(accessToken);
  let user = userFromAccess ?? null;
  if (!user && refreshToken) {
    const {
      data: { user: userFromSession },
      error: sessionError,
    } = await anon.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (!sessionError) user = userFromSession ?? null;
  }
  if (userErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: me, error: meErr } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (meErr || !me || (me.role !== "admin" && me.role !== "manager" && me.role !== "headquarters")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get("year"));
  const month = Number(sp.get("month"));
  const version = toVersion(sp.get("version"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year/month query is required" }, { status: 400 });
  }
  try {
    const data = await getPlanningMonthData(year, month, version);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "failed_to_load_month", message }, { status: 500 });
  }
}

type PatchBody = {
  access_token?: string;
  refresh_token?: string;
  year?: number;
  month?: number;
  baseline_headcount?: number;
};

/** 월 마스터 행의 기준 인원만 수정 (DB 마이그레이션 없음) */
export async function PATCH(req: NextRequest) {
  if (!serviceRoleKey) return NextResponse.json({ error: "server_config_error" }, { status: 500 });

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const accessToken = String(body.access_token ?? "").trim();
  const refreshToken = String(body.refresh_token ?? "").trim();
  if (!accessToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const year = Number(body.year);
  const month = Number(body.month);
  const baseline = Number(body.baseline_headcount);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year/month invalid" }, { status: 400 });
  }
  if (!Number.isFinite(baseline) || baseline < 1 || baseline > 500) {
    return NextResponse.json({ error: "baseline_headcount invalid" }, { status: 400 });
  }

  const anon = createClient(url, anonKey);
  const {
    data: { user: userFromAccess },
    error: userErr,
  } = await anon.auth.getUser(accessToken);
  let user = userFromAccess ?? null;
  if (!user && refreshToken) {
    const {
      data: { user: userFromSession },
      error: sessionError,
    } = await anon.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (!sessionError) user = userFromSession ?? null;
  }
  if (userErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: me, error: meErr } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (meErr || !me || (me.role !== "admin" && me.role !== "manager" && me.role !== "headquarters")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { data: row, error: findErr } = await admin
      .from("production_plan_months")
      .select("id")
      .eq("plan_year", year)
      .eq("plan_month", month)
      .eq("version_type", "master")
      .maybeSingle();
    if (findErr) throw findErr;
    if (!row?.id) {
      return NextResponse.json({ error: "month_row_not_found" }, { status: 404 });
    }
    const { error: upErr } = await admin
      .from("production_plan_months")
      .update({
        baseline_headcount: Math.round(baseline),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (upErr) throw upErr;
    return NextResponse.json({ ok: true, baseline_headcount: Math.round(baseline) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "patch_failed", message }, { status: 500 });
  }
}
