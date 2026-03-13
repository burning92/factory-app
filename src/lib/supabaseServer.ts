import { createClient } from "@supabase/supabase-js";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.SUPABASE_URL ??
  "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** 서버 전용. RLS 우회. sync API 등 내부 처리에서만 사용. */
export function getSupabaseAdmin() {
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase URL or service role key. For local dev set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local."
    );
  }
  return createClient(url, serviceRoleKey);
}
