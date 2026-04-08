import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export async function POST(request: Request) {
  const webhookUrl = process.env.LOGS_SHEETS_WEBHOOK_URL ?? "";
  const webhookSecret = process.env.LOGS_SHEETS_WEBHOOK_SECRET ?? "";
  if (!url || !anonKey) {
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
  }
  if (!webhookUrl || !webhookSecret) {
    return NextResponse.json(
      { error: "LOGS_SHEETS_WEBHOOK_URL / LOGS_SHEETS_WEBHOOK_SECRET 환경변수가 필요합니다." },
      { status: 500 }
    );
  }

  let body: {
    access_token?: string;
    refresh_token?: string;
    days?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문" }, { status: 400 });
  }

  const { access_token, refresh_token } = body;
  const days = Math.min(30, Math.max(1, Number(body.days ?? 7)));
  if (!access_token || !refresh_token) {
    return NextResponse.json({ error: "access_token, refresh_token이 필요합니다." }, { status: 400 });
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
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || profile?.role !== "admin") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const admin = getSupabaseAdmin();
  const [accessRes, auditRes] = await Promise.all([
    admin
      .from("access_logs")
      .select("id, created_at, login_id, display_name, role, event, page_path, ip_address, user_agent")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(2000),
    admin
      .from("audit_logs")
      .select(
        "id, created_at, actor_login_id, actor_display_name, actor_role, action, target_table, target_id, target_label, before_data, after_data, meta, ip_address, user_agent"
      )
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(2000),
  ]);
  if (accessRes.error) return NextResponse.json({ error: accessRes.error.message }, { status: 500 });
  if (auditRes.error) return NextResponse.json({ error: auditRes.error.message }, { status: 500 });

  const payload = {
    secret: webhookSecret,
    generated_at: new Date().toISOString(),
    days,
    access_rows: accessRes.data ?? [],
    audit_rows: auditRes.data ?? [],
  };

  const webhookRes = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const webhookText = await webhookRes.text();
  if (!webhookRes.ok) {
    return NextResponse.json(
      {
        error: "시트 동기화 실패",
        status: webhookRes.status,
        message: webhookText.slice(0, 800),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    days,
    access_count: accessRes.data?.length ?? 0,
    audit_count: auditRes.data?.length ?? 0,
    webhook_result: webhookText.slice(0, 800),
  });
}
