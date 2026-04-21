import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
  }
  let body: { access_token?: string; refresh_token?: string; target_user_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const { access_token, refresh_token, target_user_id } = body;
  if (!access_token || !refresh_token || !target_user_id?.trim()) {
    return NextResponse.json(
      { error: "access_token, refresh_token, target_user_id 필요" },
      { status: 400 }
    );
  }

  const anon = createClient(url, anonKey);
  const {
    data: { user },
    error: sessionError,
  } = await anon.auth.setSession({ access_token, refresh_token });
  if (sessionError || !user) {
    return NextResponse.json({ error: "인증 실패" }, { status: 401 });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: actorProfile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (actorProfile?.role !== "admin") {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const targetId = target_user_id.trim();
  if (targetId === user.id) {
    return NextResponse.json({ error: "본인 계정은 삭제할 수 없습니다." }, { status: 400 });
  }

  const { data: targetProfile } = await admin.from("profiles").select("role").eq("id", targetId).maybeSingle();
  if (!targetProfile) {
    return NextResponse.json({ error: "해당 사용자를 찾을 수 없습니다." }, { status: 404 });
  }
  if (targetProfile.role === "admin") {
    return NextResponse.json({ error: "admin 계정은 삭제할 수 없습니다." }, { status: 400 });
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(targetId);
  if (delErr) {
    return NextResponse.json(
      { error: delErr.message || "계정 삭제에 실패했습니다. 다른 데이터에 연결된 경우 DB 제약으로 막힐 수 있습니다." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}
