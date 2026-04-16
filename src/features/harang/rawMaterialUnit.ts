import type { HarangMasterItem } from "./types";

/** 원재료 마스터에서 입고·BOM·생산에 쓸 단위 (locked_unit 우선) */
export function effectiveRawMaterialUnit(item: HarangMasterItem): string {
  const locked = item.locked_unit?.trim();
  if (locked) return locked;
  return item.default_unit?.trim() || "";
}

export function isRawMaterialUnitLocked(item: HarangMasterItem): boolean {
  return Boolean(item.locked_unit?.trim());
}
