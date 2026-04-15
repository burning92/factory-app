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
  if (meErr || !me || (me.role !== "admin" && me.role !== "manager")) {
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
