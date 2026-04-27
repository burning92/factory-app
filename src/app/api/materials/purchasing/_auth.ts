import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function createAdminClient() {
  if (!serviceRoleKey) throw new Error("server_config_error");
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function verifyPurchasingAccess(params: {
  authorizationHeader: string | null;
  refreshTokenHeader: string | null;
}): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  if (!serviceRoleKey) return { ok: false, status: 500, error: "server_config_error" };
  const authHeader = params.authorizationHeader ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const refreshToken = (params.refreshTokenHeader ?? "").trim();
  if (!accessToken) return { ok: false, status: 401, error: "unauthorized" };

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
  if (userErr || !user) return { ok: false, status: 401, error: "unauthorized" };

  const admin = createAdminClient();
  const { data: me, error: meErr } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (meErr || !me || (me.role !== "admin" && me.role !== "manager" && me.role !== "headquarters")) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, userId: user.id };
}

