import type { SupabaseClient } from "@supabase/supabase-js";

export const RECEIVING_ITEMS_TABLE = "daily_material_receiving_inspection_log_items";

/** 사진(label_photo_url, base64 data URL 최대 약 1MB)을 뺀 항목 컬럼. 컬럼 추가 시 함께 갱신. */
export const RECEIVING_ITEM_COLUMNS_WITHOUT_PHOTO =
  "id, log_id, line_index, storage_category, item_name, box_qty, unit_qty, remainder_g, box_weight_g, unit_weight_g, total_weight_g, expiry_or_lot, conformity, remarks, created_at";

/**
 * 항목 사진을 한 장씩 순서대로 읽는다. 한 요청에 사진 여러 장이 실리지 않게 한다.
 * 실패하면 예외를 던진다. 호출부는 사진을 모두 읽기 전에는 항목을 다시 저장하면 안 된다.
 */
export async function loadReceivingPhotosOneByOne(
  client: SupabaseClient,
  itemIds: string[],
  onPhoto?: (itemId: string, url: string | null, done: number) => void
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const itemId of itemIds) {
    const { data, error } = await client
      .from(RECEIVING_ITEMS_TABLE)
      .select("id, label_photo_url")
      .eq("id", itemId)
      .maybeSingle();
    if (error) throw new Error(`사진을 불러오지 못했습니다: ${error.message}`);
    const url = (data as { label_photo_url: string | null } | null)?.label_photo_url ?? null;
    out.set(itemId, url);
    onPhoto?.(itemId, url, out.size);
  }
  return out;
}
