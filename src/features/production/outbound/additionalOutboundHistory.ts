import { supabase } from "@/lib/supabase";

export type AdditionalOutboundHistoryRow = {
  id: string;
  production_date: string;
  product_name: string;
  material_name: string;
  lot_expiry: string;
  box_qty: number;
  bag_qty: number;
  g_qty: number;
  author_name: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancelled_by_name: string | null;
};

export type InsertAdditionalOutboundHistoryInput = {
  /** 출고 라인(additional_outbound_log_id)과 같은 값. 라인 삭제 시 내역 연동용 */
  id: string;
  organizationCode: string;
  productionDate: string;
  productName: string;
  materialName: string;
  lotExpiry: string;
  boxQty: number;
  bagQty: number;
  gQty: number;
  authorName?: string;
  authorUserId?: string;
};

/** 박스/낱개/g → 표시용 중량 텍스트 */
export function formatAdditionalOutboundWeight(
  box: number,
  bag: number,
  g: number
): string {
  const parts: string[] = [];
  if (box > 0) parts.push(`${box}박스`);
  if (bag > 0) parts.push(`${bag}개`);
  if (g > 0) parts.push(`${g.toLocaleString("ko-KR")}g`);
  return parts.length > 0 ? parts.join(" ") : "0";
}

export async function insertAdditionalOutboundHistory(
  input: InsertAdditionalOutboundHistoryInput
): Promise<void> {
  const { error } = await supabase.from("additional_outbound_logs").insert({
    id: input.id,
    organization_code: input.organizationCode,
    production_date: input.productionDate.slice(0, 10),
    product_name: input.productName.trim(),
    material_name: input.materialName.trim(),
    lot_expiry: input.lotExpiry.trim(),
    box_qty: Math.max(0, input.boxQty || 0),
    bag_qty: Math.max(0, input.bagQty || 0),
    g_qty: Math.max(0, input.gQty || 0),
    author_name: input.authorName?.trim() || null,
    author_user_id: input.authorUserId ?? null,
  });
  if (error) throw error;
}

export async function fetchAdditionalOutboundHistory(
  organizationCode: string,
  options?: { productionDate?: string; limit?: number }
): Promise<AdditionalOutboundHistoryRow[]> {
  const limit = options?.limit ?? 200;
  const productionDate = (options?.productionDate ?? "").slice(0, 10);
  let query = supabase
    .from("additional_outbound_logs")
    .select(
      "id, production_date, product_name, material_name, lot_expiry, box_qty, bag_qty, g_qty, author_name, created_at, cancelled_at, cancelled_by_name"
    )
    .eq("organization_code", organizationCode)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (productionDate) {
    query = query.eq("production_date", productionDate);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    production_date: row.production_date,
    product_name: row.product_name ?? "",
    material_name: row.material_name,
    lot_expiry: row.lot_expiry,
    box_qty: Number(row.box_qty) || 0,
    bag_qty: Number(row.bag_qty) || 0,
    g_qty: Number(row.g_qty) || 0,
    author_name: row.author_name,
    created_at: row.created_at,
    cancelled_at: row.cancelled_at ?? null,
    cancelled_by_name: row.cancelled_by_name ?? null,
  }));
}

async function resolveCurrentActor(): Promise<{ userId: string | null; name: string | null }> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id ?? null;
  if (!userId) return { userId: null, name: null };
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, login_id")
    .eq("id", userId)
    .maybeSingle();
  const name =
    (profile?.display_name ?? "").trim() || (profile?.login_id ?? "").trim() || null;
  return { userId, name };
}

/** 출고 라인 삭제에 맞춰 추가 출고 내역을 삭제됨으로 표시 */
export async function cancelAdditionalOutboundHistory(ids: string[]): Promise<void> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return;
  const actor = await resolveCurrentActor();
  const { error } = await supabase
    .from("additional_outbound_logs")
    .update({
      cancelled_at: new Date().toISOString(),
      cancelled_by_name: actor.name,
      cancelled_by_user_id: actor.userId,
    })
    .in("id", unique)
    .is("cancelled_at", null);
  if (error) throw error;
}

export type UnlinkedOutboundLineMatch = {
  productionDate: string;
  productName: string;
  materialName: string;
  lotExpiry: string;
  boxQty: number;
  bagQty: number;
  gQty: number;
  /** 같은 원료 로그에 남아 있는 라인들이 가리키는 내역 id (이미 연결된 내역은 제외) */
  excludeIds: string[];
};

/**
 * 내역 id가 없는 예전 라인 삭제 시: 같은 날짜·제품·원료·LOT·수량의 유효한 내역 중 최신 1건을 삭제됨 처리.
 */
export async function cancelUnlinkedAdditionalOutboundHistory(
  match: UnlinkedOutboundLineMatch
): Promise<void> {
  const { data, error } = await supabase
    .from("additional_outbound_logs")
    .select("id")
    .eq("production_date", match.productionDate.slice(0, 10))
    .eq("product_name", match.productName.trim())
    .eq("material_name", match.materialName.trim())
    .eq("lot_expiry", match.lotExpiry.trim())
    .eq("box_qty", match.boxQty)
    .eq("bag_qty", match.bagQty)
    .eq("g_qty", match.gQty)
    .is("cancelled_at", null)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  const exclude = new Set(match.excludeIds);
  const target = (data ?? []).find((row) => !exclude.has(row.id));
  if (target) await cancelAdditionalOutboundHistory([target.id]);
}

export async function updateAdditionalOutboundHistoryQty(
  id: string,
  qty: { boxQty: number; bagQty: number; gQty: number }
): Promise<void> {
  const { error } = await supabase
    .from("additional_outbound_logs")
    .update({
      box_qty: Math.max(0, qty.boxQty || 0),
      bag_qty: Math.max(0, qty.bagQty || 0),
      g_qty: Math.max(0, qty.gQty || 0),
    })
    .eq("id", id)
    .is("cancelled_at", null);
  if (error) throw error;
}
