import { getAppRecentValue, setAppRecentValue } from "@/lib/appRecentValues";

/**
 * 화면별 작성자명 기본값 조회 (cross-device).
 * 0순위: 로그인 사용자 displayName (인자로 전달 시)
 * 1순위: Supabase app_recent_values (동기화)
 * 2순위: localStorage
 */
export async function getDefaultAuthorName(
  supabaseKey: string,
  localStorageKey: string,
  options?: { displayName?: string | null }
): Promise<string> {
  const fromUser = (options?.displayName ?? "").trim();
  if (fromUser) return fromUser;

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
