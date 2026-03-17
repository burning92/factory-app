import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { toAuthEmailLocal } from "@/lib/authEmail";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const AUTH_EMAIL_SUFFIX = ".local";

export async function POST(request: Request) {
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
  }
  let body: {
    access_token?: string;
    refresh_token?: string;
    organization_code?: string;
    login_id?: string;
    display_name?: string;
    password?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const { access_token, refresh_token, organization_code, login_id, display_name, password } = body;
  if (!access_token || !refresh_token || !organization_code?.trim() || !login_id?.trim() || !password) {
    return NextResponse.json(
      { error: "access_token, refresh_token, organization_code, login_id, password 필요" },
      { status: 400 }
    );
  }

  const anon = createClient(url, anonKey);
  const { data: { user }, error: sessionError } = await anon.auth.setSession({
    access_token,
    refresh_token,
  });
  if (sessionError || !user) {
    return NextResponse.json({ error: "인증 실패" }, { status: 401 });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const code = organization_code.trim().toLowerCase();
  const id = login_id.trim();
  const localPart = toAuthEmailLocal(id);
  if (!localPart) {
    return NextResponse.json({ error: "login_id가 비어 있습니다." }, { status: 400 });
  }
  const email = `${localPart}@${code}${AUTH_EMAIL_SUFFIX}`;

  const { data: org } = await admin.from("organizations").select("id").eq("organization_code", code).single();
  if (!org) {
    return NextResponse.json({ error: "해당 회사코드가 없습니다." }, { status: 400 });
  }

  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 400 });
  }
  if (!newUser.user) {
    return NextResponse.json({ error: "사용자 생성 실패" }, { status: 500 });
  }

  const { error: insertError } = await admin.from("profiles").insert({
    id: newUser.user.id,
    organization_id: org.id,
    login_id: id,
    display_name: (display_name ?? "").trim() || null,
    role: "worker",
    is_active: true,
    must_change_password: false,
  });
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, user_id: newUser.user.id });
}
