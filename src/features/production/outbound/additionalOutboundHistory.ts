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
};

export type InsertAdditionalOutboundHistoryInput = {
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
      "id, production_date, product_name, material_name, lot_expiry, box_qty, bag_qty, g_qty, author_name, created_at"
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
  }));
}
