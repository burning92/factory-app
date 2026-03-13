import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[Supabase] Missing env: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Set them in Vercel → Settings → Environment Variables for runtime."
  );
}

// 빌드 시 env 없을 때 createClient가 throw하지 않도록 placeholder 사용 (실제 요청은 런타임에 env 있으면 정상 동작)
const url = supabaseUrl || "https://placeholder.supabase.co";
const key = supabaseAnonKey || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder";
export const supabase = createClient(url, key);
