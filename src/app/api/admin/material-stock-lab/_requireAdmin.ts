import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export type AdminLabAuthResult =
  | { ok: true; userId: string; supabase: SupabaseClient }
  | { ok: false; response: NextResponse };

/**
 * Bearer(+선택 refresh) 인증 후 profiles.role === 'admin' 만 통과.
 * manager / headquarters / worker 는 403.
 */
export async function requireAdminMaterialStockLab(req: Request): Promise<AdminLabAuthResult> {
  try {
    getSupabaseAdmin();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "server_config_error" }, { status: 500 }) };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const refreshToken = (req.headers.get("x-refresh-token") ?? "").trim();
  if (!accessToken) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
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
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const supabase = getSupabaseAdmin();
  const { data: profile, error: meErr } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (meErr || !profile) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  if (profile.role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "forbidden", message: "admin only" }, { status: 403 }) };
  }

  return { ok: true, userId: user.id, supabase };
}
