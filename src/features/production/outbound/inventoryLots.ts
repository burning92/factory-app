import { supabase } from "@/lib/supabase";

export type EcountLotRow = {
  item_code: string | null;
  lot_no: string;
  qty: number | null;
  display_item_name: string | null;
};

export type InventoryLotOption = {
  lotNo: string;
  qty: number;
  iso: string;
};

/** 재고 lot_no → YYYY-MM-DD (FIFO/그룹핑과 동일 형식) */
export function parseLotNoToIso(lotNo: string): string {
  const t = lotNo.trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{4})[\.\-](\d{1,2})[\.\-](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return "";
}

export function normalizeStoredExpiryToIso(s: string): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return parseLotNoToIso(t);
}

export function resolveOutboundExpiry(input: {
  manualLotIso: string;
  selectedLotIso: string;
  fallbackIso?: string;
}): string {
  const m = input.manualLotIso.trim();
  if (m) return m;
  const s = input.selectedLotIso.trim();
  if (s) return s;
  const f = (input.fallbackIso ?? "").trim();
  return f || new Date().toISOString().slice(0, 10);
}

export function buildLotOptions(rows: EcountLotRow[]): InventoryLotOption[] {
  const seen = new Set<string>();
  const out: InventoryLotOption[] = [];
  for (const r of rows) {
    const lotNo = String(r.lot_no ?? "").trim();
    const iso = parseLotNoToIso(lotNo);
    if (!iso || seen.has(iso)) continue;
    seen.add(iso);
    out.push({ lotNo, qty: Number(r.qty) || 0, iso });
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso));
}

export async function fetchInventoryLotsForMaterial(
  materialName: string,
  inventoryItemCode?: string
): Promise<{ rows: EcountLotRow[]; hint: string | null }> {
  const name = String(materialName ?? "").trim();
  const mappedCode = String(inventoryItemCode ?? "").trim();
  if (!name && !mappedCode) {
    return { rows: [], hint: null };
  }

  const { data, error } = await supabase
    .from("ecount_inventory_current")
    .select("item_code, display_item_name, lot_no, qty")
    .eq("inventory_type", "원재료")
    .order("lot_no", { ascending: true });

  if (error) {
    return { rows: [], hint: "재고 LOT 목록을 불러오지 못했습니다." };
  }

  const raw = (data ?? []) as EcountLotRow[];
  const filtered = mappedCode
    ? raw.filter((r) => String(r.item_code ?? "").trim() === mappedCode)
    : raw.filter((r) => (r.display_item_name ?? "").trim() === name);

  if (filtered.length === 0) {
    return {
      rows: [],
      hint: mappedCode
        ? "재고연동 코드와 일치하는 재고 LOT가 없습니다. 직접입력을 사용하세요."
        : "이 원료명과 일치하는 재고 LOT가 없습니다. 직접입력을 사용하세요.",
    };
  }

  return { rows: filtered, hint: null };
}
