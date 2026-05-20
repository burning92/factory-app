import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeInventoryItemCode } from "@/lib/inventoryItemCodeNormalize";
import type { MaterialWeightMeta } from "@/lib/materialStockLab/computeFirstCloseReturns";

export async function loadMaterialsMeta(supabase: SupabaseClient): Promise<MaterialWeightMeta[]> {
  const { data, error } = await supabase
    .from("materials")
    .select("material_name, unit_weight_g, box_weight_g");
  if (error || !data) return [];
  return data.map((row) => ({
    materialName: String((row as { material_name?: string }).material_name ?? ""),
    unitWeightG: Number((row as { unit_weight_g?: number }).unit_weight_g) || 0,
    boxWeightG: Number((row as { box_weight_g?: number }).box_weight_g) || 0,
  }));
}

export async function loadBomRefs(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("bom")
    .select("product_name, material_name, bom_g_per_ea, basis");
  if (error || !data) return [];
  return data.map((row) => ({
    productName: String((row as { product_name?: string }).product_name ?? ""),
    materialName: String((row as { material_name?: string }).material_name ?? ""),
    bomGPerEa: Number((row as { bom_g_per_ea?: number }).bom_g_per_ea) || 0,
    basis: String((row as { basis?: string }).basis ?? ""),
  }));
}

export async function resolveMaterialByName(
  supabase: SupabaseClient,
  materialName: string
): Promise<{ id: string; inventory_item_code: string } | null> {
  const name = String(materialName ?? "").trim();
  if (!name) return null;
  const { data, error } = await supabase
    .from("materials")
    .select("id, inventory_item_code")
    .eq("material_name", name)
    .maybeSingle();
  if (error || !data) return null;
  const code = normalizeInventoryItemCode((data as { inventory_item_code?: string }).inventory_item_code);
  if (!code) return null;
  return { id: String((data as { id: string }).id), inventory_item_code: code };
}

export function effectiveAtFromDateKey(dateKey: string): string {
  const d = String(dateKey ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d}T12:00:00.000Z`;
  return new Date().toISOString();
}
