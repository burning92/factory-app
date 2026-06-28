import type { HarangCategory } from "@/features/harang/types";
import { fetchLotStockAsOfMap, isOnOrBeforeAsOf } from "@/features/harang/inventoryAsOf";
import { supabase } from "@/lib/supabase";

export type DefectDisposalHeader = {
  id: string;
  disposal_date: string;
  disposal_no: string;
  processing_method: string;
  handler_name: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  lines?: DefectDisposalLine[];
  profiles?:
    | { display_name: string | null; login_id: string | null }
    | { display_name: string | null; login_id: string | null }[]
    | null;
};

export type DefectDisposalLine = {
  id: string;
  header_id: string;
  category: HarangCategory;
  item_id: string;
  item_code: string;
  item_name: string;
  lot_id: string;
  lot_date: string;
  quantity: number;
  unit: string;
  defect_type: string;
  sort_order: number;
};

export type DisposalEligibleLotGroup = {
  category: HarangCategory;
  item_id: string;
  item_code: string;
  item_name: string;
  lot_date: string;
  unit: string;
  stock_qty: number;
};

export type DisposalLineInput = {
  category: HarangCategory;
  item_id: string;
  lot_date: string;
  quantity: number;
  defect_type: string;
};

export const DEFECT_PROCESSING_METHODS = ["폐기"] as const;

function isParbakeDoughName(name: string): boolean {
  return name.replace(/\s/g, "").includes("파베이크도우");
}

export function displayDisposalUnit(category: HarangCategory, itemName: string): "EA" | "g" {
  if (category === "packaging_material") return "EA";
  return isParbakeDoughName(itemName) ? "EA" : "g";
}

export function itemKey(category: HarangCategory, itemId: string): string {
  return `${category}:${itemId}`;
}

export function formatLotDateDot(iso: string): string {
  return iso ? iso.slice(0, 10).replaceAll("-", ".") : "";
}

export async function previewDisposalNo(disposalDate: string): Promise<string> {
  const cut = disposalDate.slice(0, 10);
  if (!cut) return "";
  const { count, error } = await supabase
    .from("harang_defect_disposal_headers")
    .select("id", { count: "exact", head: true })
    .eq("disposal_date", cut);
  if (error) throw error;
  const seq = (count ?? 0) + 1;
  const [y, m, d] = cut.split("-");
  return `${y}/${m}/${d}-${seq}`;
}

export async function fetchDisposalEligibleLotGroups(
  asOfDate: string,
): Promise<DisposalEligibleLotGroup[]> {
  const cut = asOfDate.slice(0, 10);
  if (!cut) return [];

  const [stockAsOf, lotsRes] = await Promise.all([
    fetchLotStockAsOfMap(cut),
    supabase
      .from("harang_inventory_lots")
      .select("id, category, item_id, item_code, item_name, lot_date, inbound_date, unit")
      .lte("inbound_date", cut),
  ]);
  if (lotsRes.error) throw lotsRes.error;

  const grouped = new Map<string, DisposalEligibleLotGroup>();

  for (const lot of lotsRes.data ?? []) {
    if (!isOnOrBeforeAsOf(cut, String(lot.inbound_date ?? ""))) continue;
    const lotId = String(lot.id);
    const stock = stockAsOf?.get(lotId) ?? 0;
    if (stock <= 0.0005) continue;

    const category = lot.category as HarangCategory;
    const itemId = String(lot.item_id);
    const lotDate = String(lot.lot_date ?? "");
    const key = `${category}|${itemId}|${lotDate}`;
    const unit = displayDisposalUnit(category, String(lot.item_name ?? ""));
    const prev = grouped.get(key);
    if (prev) {
      prev.stock_qty = Math.round((prev.stock_qty + stock) * 1000) / 1000;
    } else {
      grouped.set(key, {
        category,
        item_id: itemId,
        item_code: String(lot.item_code ?? ""),
        item_name: String(lot.item_name ?? ""),
        lot_date: lotDate,
        unit,
        stock_qty: Math.round(stock * 1000) / 1000,
      });
    }
  }

  return Array.from(grouped.values()).sort((a, b) => {
    const catOrder = (c: HarangCategory) => (c === "raw_material" ? 0 : 1);
    const d = catOrder(a.category) - catOrder(b.category);
    if (d !== 0) return d;
    const nameCmp = a.item_name.localeCompare(b.item_name, "ko");
    if (nameCmp !== 0) return nameCmp;
    return a.lot_date.localeCompare(b.lot_date);
  });
}

export async function fetchDefectDisposalHeaders(): Promise<DefectDisposalHeader[]> {
  const { data, error } = await supabase
    .from("harang_defect_disposal_headers")
    .select(`
      id, disposal_date, disposal_no, processing_method, handler_name, note, created_by, created_at,
      profiles:created_by(display_name, login_id),
      lines:harang_defect_disposal_lines(
        id, header_id, category, item_id, item_code, item_name, lot_id, lot_date,
        quantity, unit, defect_type, sort_order
      )
    `)
    .order("disposal_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DefectDisposalHeader[];
}

export async function fetchDefectDisposalHeader(id: string): Promise<DefectDisposalHeader | null> {
  const { data, error } = await supabase
    .from("harang_defect_disposal_headers")
    .select(`
      id, disposal_date, disposal_no, processing_method, handler_name, note, created_by, created_at,
      profiles:created_by(display_name, login_id),
      lines:harang_defect_disposal_lines(
        id, header_id, category, item_id, item_code, item_name, lot_id, lot_date,
        quantity, unit, defect_type, sort_order
      )
    `)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as DefectDisposalHeader | null) ?? null;
}

export function summarizeDisposalItemName(lines: DefectDisposalLine[] | undefined): string {
  if (!lines?.length) return "-";
  const names = Array.from(new Set(lines.map((l) => l.item_name).filter(Boolean)));
  if (names.length === 0) return "-";
  if (names.length === 1) return names[0]!;
  return `${names[0]} 외 ${names.length - 1}건`;
}

export function sumDisposalQuantity(lines: DefectDisposalLine[] | undefined): string {
  if (!lines?.length) return "-";
  const totals = new Map<string, number>();
  for (const line of lines) {
    const prev = totals.get(line.unit) ?? 0;
    totals.set(line.unit, prev + Number(line.quantity ?? 0));
  }
  return Array.from(totals.entries())
    .map(([unit, qty]) => `${qty.toLocaleString("ko-KR")} ${unit}`)
    .join(" / ");
}

export async function createDefectDisposal(input: {
  disposal_date: string;
  handler_name: string;
  processing_method: string;
  note?: string;
  lines: DisposalLineInput[];
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_harang_defect_disposal", {
    p_disposal_date: input.disposal_date.slice(0, 10),
    p_handler_name: input.handler_name.trim() || null,
    p_processing_method: input.processing_method,
    p_note: input.note?.trim() || null,
    p_lines: input.lines,
  });
  if (error) throw error;
  return String(data);
}

export async function deleteDefectDisposal(headerId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_harang_defect_disposal", {
    p_header_id: headerId,
  });
  if (error) throw error;
}
