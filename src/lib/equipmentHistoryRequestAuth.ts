import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export type EquipmentHistoryAuthedClient = {
  client: SupabaseClient;
  userId: string;
  role: "worker" | "manager" | "admin" | undefined;
};

/** API 라우트: 요청 본문의 세션으로 Supabase 클라이언트·역할 조회 */
export async function getEquipmentHistoryAuthedClient(request: Request): Promise<
  EquipmentHistoryAuthedClient | { error: string; status: number }
> {
  let body: { access_token?: string; refresh_token?: string };
  try {
    body = await request.json();
  } catch {
    return { error: "잘못된 요청 본문", status: 400 };
  }
  const { access_token, refresh_token } = body;
  if (!access_token || !refresh_token) {
    return { error: "access_token, refresh_token이 필요합니다.", status: 401 };
  }
  if (!url || !anonKey) {
    return { error: "서버 설정 오류", status: 500 };
  }
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: sessionError } = await client.auth.setSession({
    access_token,
    refresh_token,
  });
  if (sessionError || !user) {
    return { error: "인증 실패", status: 401 };
  }
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profileError) {
    return { error: "프로필을 확인할 수 없습니다.", status: 403 };
  }
  const role = profile?.role as EquipmentHistoryAuthedClient["role"];
  return { client, userId: user.id, role };
}
