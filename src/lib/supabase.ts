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
  try {
    const remember = window.localStorage.getItem("rememberMe");
    return remember === "false" ? window.sessionStorage : window.localStorage;
  } catch {
    // 모바일 시크릿 모드/스토리지 제한 환경에서는 접근 예외가 날 수 있음
    return undefined;
  }
}

const storage =
  typeof window !== "undefined"
    ? ({
        getItem: (k: string) => {
          try {
            return getAuthStorage()?.getItem(k) ?? null;
          } catch {
            return null;
          }
        },
        setItem: (k: string, v: string) => {
          try {
            getAuthStorage()?.setItem(k, v);
          } catch {
            // ignore
          }
        },
        removeItem: (k: string) => {
          try {
            window.sessionStorage.removeItem(k);
          } catch {
            // ignore
          }
          try {
            window.localStorage.removeItem(k);
          } catch {
            // ignore
          }
        },
        clear: () => {
          try {
            getAuthStorage()?.clear();
          } catch {
            // ignore
          }
        },
        key: (index: number) => {
          try {
            return getAuthStorage()?.key(index) ?? null;
          } catch {
            return null;
          }
        },
        get length() {
          try {
            return getAuthStorage()?.length ?? 0;
          } catch {
            return 0;
          }
        },
      } as Storage)
    : undefined;

export const supabase = createClient(url, key, {
  auth: {
    storage: storage ?? undefined,
    persistSession: true,
    /**
     * 모바일 브라우저(특히 WebView/일부 안드로이드)에서 Navigator LockManager 기반
     * auth-token 락 획득이 timeout 되는 이슈가 있어 멀티탭 동기화를 비활성화한다.
     * 단일 탭 사용이 대부분인 운영 환경에서는 안정성이 우선이다.
     */
    multiTab: false,
  },
});
