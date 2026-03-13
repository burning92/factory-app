import { supabase } from "@/lib/supabase";

const TABLE = "app_recent_values";

/**
 * Supabase app_recent_values에서 key에 해당하는 value 조회.
 * 없으면 null.
 */
export async function getAppRecentValue(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.warn("[appRecentValues] get failed:", key, error.message);
    return null;
  }
  return data?.value ?? null;
}

/**
 * Supabase app_recent_values에 key-value upsert.
 * value가 비어 있으면 저장하지 않음(또는 기존 행 삭제 가능). 현재는 빈 값도 upsert함.
 */
export async function setAppRecentValue(key: string, value: string): Promise<void> {
  const trimmed = (value ?? "").trim();
  const { error } = await supabase.from(TABLE).upsert(
    { key, value: trimmed, updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
  if (error) {
    console.warn("[appRecentValues] set failed:", key, error.message);
  }
}
