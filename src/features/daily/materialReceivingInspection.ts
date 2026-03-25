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
