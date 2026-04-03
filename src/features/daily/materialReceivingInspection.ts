import { calcTotalWeightG, parseOptionalNum } from "@/features/daily/rawThawing";

export type ReceivingStorageCategory = "cold" | "frozen" | "room";

export const RECEIVING_STORAGE_OPTIONS: { value: ReceivingStorageCategory; label: string }[] = [
  { value: "cold", label: "냉장" },
  { value: "frozen", label: "냉동" },
  { value: "room", label: "실온" },
];

/**
 * `ecount_inventory_current.category` 값과 매핑.
 * 원료 해동 일지(RawThawingForm)는 냉동에 `.eq("category", "냉동")` 사용.
 */
export function ecountCategoryLabelForReceiving(storage: ReceivingStorageCategory): string {
  switch (storage) {
    case "cold":
      return "냉장";
    case "frozen":
      return "냉동";
    case "room":
      return "실온";
    default:
      return "";
  }
}

export type EcountMaterialPickerOption = {
  itemCode: string;
  materialName: string;
  /** 이카운트 품목 카테고리(냉장/냉동/실온 등) */
  category: string | null;
  boxWeightG: number;
  unitWeightG: number;
};

/** 원재료 재고 행에서 item_code 기준 1회만 펼쳐 목록 생성 (원료 해동 일지와 동일 패턴) */
export function buildEcountMaterialPickerOptions(
  rows: Array<{
    item_code: string | null;
    display_item_name: string | null;
    category: string | null;
    box_weight_g: number | null;
    unit_weight_g: number | null;
  }>
): EcountMaterialPickerOption[] {
  const seen = new Set<string>();
  const opts: EcountMaterialPickerOption[] = [];
  for (const r of rows) {
    const code = (r.item_code ?? "").trim();
    if (!code || seen.has(code)) continue;
    const name = (r.display_item_name ?? "").trim();
    if (!name) continue;
    seen.add(code);
    const cat = (r.category ?? "").trim();
    opts.push({
      itemCode: code,
      materialName: name,
      category: cat || null,
      boxWeightG: Number(r.box_weight_g) || 0,
      unitWeightG: Number(r.unit_weight_g) || 0,
    });
  }
  opts.sort((a, b) => a.materialName.localeCompare(b.materialName, "ko"));
  return opts;
}

/**
 * 품목마스터(ecount_item_master) 행 → 채우기 옵션.
 * 재고에 아직 없는 품목도 동일 형태로 선택할 수 있게 한다.
 */
export function masterRowsToPickerOptions(
  rows: Array<{
    item_code: string | null;
    item_name: string | null;
    category: string | null;
    box_weight_g: number | null;
    unit_weight_g: number | null;
  }>
): EcountMaterialPickerOption[] {
  const opts: EcountMaterialPickerOption[] = [];
  for (const r of rows) {
    const code = (r.item_code ?? "").trim();
    const name = (r.item_name ?? "").trim();
    if (!code || !name) continue;
    const cat = (r.category ?? "").trim();
    opts.push({
      itemCode: code,
      materialName: name,
      category: cat || null,
      boxWeightG: Number(r.box_weight_g) || 0,
      unitWeightG: Number(r.unit_weight_g) || 0,
    });
  }
  opts.sort((a, b) => a.materialName.localeCompare(b.materialName, "ko"));
  return opts;
}

/** 재고에서 펼친 품목을 우선하고, 마스터에만 있는 품목 코드를 이어 붙인다. */
export function mergeInventoryAndMasterPickerOptions(
  fromInventory: EcountMaterialPickerOption[],
  fromMaster: EcountMaterialPickerOption[]
): EcountMaterialPickerOption[] {
  const byCode = new Map<string, EcountMaterialPickerOption>();
  for (const o of fromInventory) {
    if (o.itemCode) byCode.set(o.itemCode, o);
  }
  for (const o of fromMaster) {
    if (!o.itemCode || byCode.has(o.itemCode)) continue;
    byCode.set(o.itemCode, o);
  }
  return Array.from(byCode.values()).sort((a, b) =>
    a.materialName.localeCompare(b.materialName, "ko")
  );
}

export function filterEcountOptionsByReceivingCategory(
  all: EcountMaterialPickerOption[],
  storage: ReceivingStorageCategory
): EcountMaterialPickerOption[] {
  const want = ecountCategoryLabelForReceiving(storage);
  return all.filter((o) => (o.category ?? "") === want);
}

export { calcTotalWeightG, parseOptionalNum };

export function hasReceivingConformityIssue(lines: { conformity: "O" | "X" | "" }[]): boolean {
  return lines.some((l) => l.conformity === "X");
}

export function buildReceivingAutoDeviationText(
  lines: { item_name: string; conformity: "O" | "X" | "" }[]
): string {
  return lines
    .filter((l) => l.conformity === "X" && l.item_name.trim())
    .map((l) => `품목 "${l.item_name.trim()}": 부적합`)
    .join("\n");
}
