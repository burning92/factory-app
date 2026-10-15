import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { isAdminLikeRole } from "@/lib/roles";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export async function requireHaccpExportAdmin(
  req: Request
): Promise<{ ok: true; supabase: SupabaseClient } | { ok: false; response: NextResponse }> {
  if (!url || !anonKey) {
    return { ok: false, response: NextResponse.json({ error: "서버 설정 오류" }, { status: 500 }) };
  }
  try {
    getSupabaseAdmin();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "서버 설정 오류" }, { status: 500 }) };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const refreshToken = (req.headers.get("x-refresh-token") ?? "").trim();
  if (!accessToken) {
    return { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  }

  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const {
    data: { user: userFromAccess },
  } = await anon.auth.getUser(accessToken);
  let user = userFromAccess ?? null;
  if (!user && refreshToken) {
    const { data, error } = await anon.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (!error) user = data.user ?? null;
  }
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "인증에 실패했습니다." }, { status: 401 }) };
  }

  const supabase = getSupabaseAdmin();
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error || !profile || !isAdminLikeRole(profile.role)) {
    return { ok: false, response: NextResponse.json({ error: "관리자만 내보낼 수 있습니다." }, { status: 403 }) };
  }
  return { ok: true, supabase };
}
