import { detectFloorFromColumn, detectFloorFromRecord, isFloorValue, type FloorValue } from "@/features/haccpExport/floor";

export type EquipmentMasterRow = {
  management_no: string | null;
  equipment_name: string | null;
  display_name: string | null;
  floor_label: string | null;
  organization_code: string | null;
};

export type FloorResult = { floor: FloorValue | null; basis: string };

const NONE: FloorResult = { floor: null, basis: "" };

/** 비교용 이름: 공백·마침표·'호기'를 지운다. "진공포장기 1호기" → "진공포장기1" */
export function normalizeEquipmentName(name: string): string {
  return name.replace(/\s+/g, "").replace(/\./g, "").replace(/호기/g, "");
}

export type EquipmentFloorIndex = Map<string, { floor: FloorValue | null; managementNos: string[] }>;

/**
 * 설비 마스터의 표시명·설비명을 정규화해 층을 모은다.
 * 같은 이름이 여러 층에 있거나 층이 1~3층이 아니면(예: 전층) floor 는 null 이다.
 */
export function buildEquipmentFloorIndex(rows: EquipmentMasterRow[], organizationCode = "100"): EquipmentFloorIndex {
  const index: EquipmentFloorIndex = new Map();
  const add = (name: string | null, row: EquipmentMasterRow) => {
    if (!name || !name.trim()) return;
    const key = normalizeEquipmentName(name);
    const floor = row.floor_label && isFloorValue(row.floor_label.trim()) ? (row.floor_label.trim() as FloorValue) : null;
    const entry = index.get(key);
    const no = row.management_no ?? "";
    if (!entry) {
      index.set(key, { floor, managementNos: [no] });
      return;
    }
    if (!entry.managementNos.includes(no)) entry.managementNos.push(no);
    if (entry.floor !== floor) entry.floor = null;
  };
  for (const row of rows) {
    if (row.organization_code && row.organization_code !== organizationCode) continue;
    add(row.display_name, row);
    add(row.equipment_name, row);
  }
  return index;
}

/** 항목 문구 → 층. 근거가 하나로 정해질 때만 층을 적고, 아니면 비운다. */
export function resolveItemFloor(item: Record<string, unknown>, equipment: EquipmentFloorIndex, equipmentText: string | null): FloorResult {
  const fromText = detectFloorFromRecord(item);
  if (fromText) return { floor: fromText, basis: "항목 문구" };
  if (equipmentText) {
    const entry = equipment.get(normalizeEquipmentName(equipmentText));
    if (entry?.floor) return { floor: entry.floor, basis: `설비마스터 ${entry.managementNos.join(",")}` };
  }
  return NONE;
}

export function resolveColumnFloor(column: string): FloorResult {
  const floor = detectFloorFromColumn(column);
  return floor ? { floor, basis: "측정 항목명" } : NONE;
}
