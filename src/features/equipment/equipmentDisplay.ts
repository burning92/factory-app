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
  const place = (loc.startsWith(floor) ? [loc] : [floor, loc]).filter(Boolean).join(" ");
  return place ? `${base} · ${place}` : base;
}

function compareManagementNo(a: string, b: string): number {
  return a.localeCompare(b, "ko", { numeric: true });
}

function floorSortKey(floor: string): number {
  const n = /^(\d+)층$/.exec(floor);
  if (n) return Number(n[1]);
  return floor === "미지정" ? 1000 : 999;
}

/** 드롭다운 optgroup용: 층별(2층 → 3층 → 전층 → 미지정)로 묶고 관리번호 순 정렬 */
export function groupEquipmentMastersByFloor<
  T extends Pick<EquipmentMasterRow, "management_no" | "floor_label">,
>(rows: T[]): { floor: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const floor = (r.floor_label ?? "").trim() || "미지정";
    const list = map.get(floor) ?? [];
    list.push(r);
    map.set(floor, list);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => floorSortKey(a) - floorSortKey(b) || a.localeCompare(b, "ko"))
    .map(([floor, items]) => ({
      floor,
      items: items.sort((x, y) => compareManagementNo(x.management_no, y.management_no)),
    }));
}

export function summarizeText(text: string | null | undefined, maxLen = 56): string {
  const s = String(text ?? "").trim();
  if (!s) return "—";
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}
