import { getAppRecentValue, setAppRecentValue } from "@/lib/appRecentValues";

/**
 * 화면별 작성자명 기본값 조회 (cross-device).
 * 1순위: Supabase app_recent_values (동기화)
 * 2순위: localStorage
 * 로그인 도입 시: 0순위로 session user displayName 주입하도록 이 함수 시그니처만 확장하면 됨.
 */
export async function getDefaultAuthorName(
  supabaseKey: string,
  localStorageKey: string
): Promise<string> {
  const fromSupabase = await getAppRecentValue(supabaseKey);
  const v = (fromSupabase ?? "").trim();
  if (v) return v;
  if (typeof window === "undefined") return "";
  return (localStorage.getItem(localStorageKey) ?? "").trim();
}

/**
 * 작성자명을 Supabase + localStorage 양쪽에 저장 (cross-device 동기화).
 */
export async function persistAuthorName(
  supabaseKey: string,
  localStorageKey: string,
  value: string
): Promise<void> {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return;
  if (typeof window !== "undefined") localStorage.setItem(localStorageKey, trimmed);
  await setAppRecentValue(supabaseKey, trimmed);
}
