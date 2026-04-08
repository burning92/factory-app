import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

function clientIpFromRequest(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (!xff) return null;
  const first = xff.split(",")[0]?.trim();
  return first || null;
}

export async function POST(request: Request) {
  if (!url || !anonKey) {
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
  }

  let body: {
    access_token?: string;
    refresh_token?: string;
    page_path?: string;
    event?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const { access_token, refresh_token, page_path, event } = body;
  if (!access_token || !refresh_token || !page_path) {
    return NextResponse.json({ error: "access_token, refresh_token, page_path가 필요합니다." }, { status: 400 });
  }

  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const {
    data: { user },
    error: sessionError,
  } = await anon.auth.setSession({ access_token, refresh_token });
  if (sessionError || !user) {
    return NextResponse.json({ error: "인증 실패" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await anon
    .from("profiles")
    .select("organization_id, login_id, display_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile || profile.is_active === false) {
    return NextResponse.json({ error: "프로필을 확인할 수 없습니다." }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  const fifteenMinAgoIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: recent } = await admin
    .from("access_logs")
    .select("id")
    .eq("user_id", user.id)
    .eq("page_path", page_path)
    .eq("event", event || "page_view")
    .gte("created_at", fifteenMinAgoIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recent?.id) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  const userAgent = request.headers.get("user-agent");
  const ip = clientIpFromRequest(request);
  const { error: insertError } = await admin.from("access_logs").insert({
    user_id: user.id,
    organization_id: profile.organization_id,
    login_id: profile.login_id,
    display_name: profile.display_name,
    role: profile.role,
    event: event || "page_view",
    page_path,
    ip_address: ip,
    user_agent: userAgent,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
