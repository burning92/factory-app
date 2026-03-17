import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[Supabase] Missing env: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Set them in Vercel → Settings → Environment Variables for runtime."
  );
}

const url = supabaseUrl || "https://placeholder.supabase.co";
const key = supabaseAnonKey || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder";

/** 로그인 유지 체크 시 localStorage, 미체크 시 sessionStorage (브라우저 종료 시 세션 해제) */
function getAuthStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  const remember = localStorage.getItem("rememberMe");
  return remember === "false" ? sessionStorage : localStorage;
}

const storage = typeof window !== "undefined" ? {
  getItem: (k: string) => getAuthStorage()?.getItem(k) ?? null,
  setItem: (k: string, v: string) => getAuthStorage()?.setItem(k, v),
  removeItem: (k: string) => {
    sessionStorage.removeItem(k);
    localStorage.removeItem(k);
  },
} as Storage : undefined;

export const supabase = createClient(url, key, {
  auth: {
    storage: storage ?? undefined,
    persistSession: true,
  },
});
