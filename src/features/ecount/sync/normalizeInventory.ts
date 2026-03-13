import type {
  RawMasterRow,
  RawInventoryRow,
  NormalizedMasterRow,
  NormalizedInventoryRow,
} from "./types";
import {
  ALLOWED_INVENTORY_TYPES,
  LOT_PLACEHOLDER,
} from "./types";

function trim(s: unknown): string {
  if (s == null) return "";
  return String(s).trim();
}

function num(val: unknown): number {
  if (val == null || val === "") return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

/** 품목명 끝이 '계'인 행 제외, 코드/품목명 없으면 제외 */
function isSubtotalOrInvalidName(name: string): boolean {
  return name.endsWith("계");
}

/**
 * masterRows 정규화. item_code/item_name 필수, inventory_type 허용값만, weights 빈칸→0, use_yn→is_active.
 * 필수 없으면 해당 행 스킵.
 */
export function normalizeMasterRows(
  rows: RawMasterRow[]
): { rows: NormalizedMasterRow[]; filtered: number } {
  const out: NormalizedMasterRow[] = [];
  let filtered = 0;
  for (const r of rows) {
    const code = trim(r.item_code);
    const name = trim(r.item_name);
    if (!code || !name) {
      filtered++;
      continue;
    }
    const rawType = trim(r.inventory_type);
    const inventory_type = ALLOWED_INVENTORY_TYPES.includes(
      rawType as (typeof ALLOWED_INVENTORY_TYPES)[number]
    )
      ? (rawType as NormalizedMasterRow["inventory_type"])
      : "원재료"; // 기본값
    const category = trim(r.category) || null;
    const box_weight_g = Math.max(0, num(r.box_weight_g));
    const unit_weight_g = Math.max(0, num(r.unit_weight_g));
    const useRaw = trim(r.use_yn).toUpperCase();
    const is_active = useRaw === "N" || useRaw === "NO" ? false : true;
    const note = trim(r.note) || null;
    out.push({
      item_code: code,
      item_name: name,
      inventory_type,
      category,
      box_weight_g,
      unit_weight_g,
      is_active,
      note,
    });
  }
  return { rows: out, filtered };
}

/**
 * inventoryRows 정규화: item_code/raw_item_name 필수, qty 숫자, lot_no 빈칸→NO_LOT.
 * raw_item_name 끝이 '계'인 행 제외.
 * masterMap으로 display_item_name, inventory_type, category, weights 채움. 없으면 raw_item_name, '미분류', null, 0, 0.
 */
export function normalizeInventoryRows(
  rows: RawInventoryRow[],
  masterMap: Map<string, NormalizedMasterRow>
): { rows: NormalizedInventoryRow[]; filtered: number } {
  const out: NormalizedInventoryRow[] = [];
  let filtered = 0;
  for (const r of rows) {
    const code = trim(r.item_code);
    const rawName = trim(r.raw_item_name);
    if (!code || !rawName) {
      filtered++;
      continue;
    }
    if (isSubtotalOrInvalidName(rawName)) {
      filtered++;
      continue;
    }
    const qty = num(r.qty);
    const lot_no = trim(r.lot_no) || LOT_PLACEHOLDER;
    const master = masterMap.get(code);
    const display_item_name = master?.item_name ?? rawName;
    const inventory_type = master?.inventory_type ?? "미분류";
    const category = master?.category ?? null;
    const box_weight_g = master?.box_weight_g ?? 0;
    const unit_weight_g = master?.unit_weight_g ?? 0;
    out.push({
      item_code: code,
      lot_no,
      qty,
      raw_item_name: rawName,
      display_item_name,
      inventory_type,
      category,
      box_weight_g,
      unit_weight_g,
    });
  }
  return { rows: out, filtered };
}
