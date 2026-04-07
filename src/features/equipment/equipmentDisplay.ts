import type { EquipmentMasterRow } from "./equipmentTypes";

/** 레거시·짧은 라벨 */
export function formatEquipmentLabel(row: Pick<EquipmentMasterRow, "management_no" | "equipment_name">): string {
  return `${row.management_no} · ${row.equipment_name}`;
}

/**
 * 목록·드롭다운·대시보드용
 * 예: FP-812-1-02 · 화덕 2호기 · 2층 가열실
 */
export function formatEquipmentMasterListLabel(
  row: Pick<EquipmentMasterRow, "management_no" | "display_name" | "equipment_name" | "floor_label" | "install_location">
): string {
  const name = (row.display_name || row.equipment_name || "").trim();
  const base = `${row.management_no} · ${name}`;
  const floor = (row.floor_label ?? "").trim();
  const loc = (row.install_location ?? "").trim();
  const place = [floor, loc].filter(Boolean).join(" ");
  return place ? `${base} · ${place}` : base;
}

export function summarizeText(text: string | null | undefined, maxLen = 56): string {
  const s = String(text ?? "").trim();
  if (!s) return "—";
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}
