import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
  }
  let body: { access_token?: string; refresh_token?: string; target_user_id?: string; new_password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const { access_token, refresh_token, target_user_id, new_password } = body;
  if (!access_token || !refresh_token || !target_user_id || !new_password || new_password.length < 6) {
    return NextResponse.json(
      { error: "access_token, refresh_token, target_user_id, new_password(6자 이상) 필요" },
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
  if (profile?.role !== "master") {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const { error } = await admin.auth.admin.updateUserById(target_user_id, { password: new_password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
