import type { SupabaseClient } from "@supabase/supabase-js";

/** 제조설비 점검표 항목 중 설비이력기록부로 연동하는 주요 설비 (대시보드 그룹 기준) */
export type TrackedEquipmentGroup = "화덕" | "호이스트";

export type TrackedEquipmentSlot = {
  group: TrackedEquipmentGroup;
  /** 점검표가 다루는 층. 같은 그룹 설비가 여러 층에 있을 때 구분용 */
  floor: string | null;
};

const TRACKED_SLOTS: Record<string, TrackedEquipmentSlot> = {
  "가열실::터널오븐(화덕)": { group: "화덕", floor: "2층" },
  "3층 가열실::터널오븐(화덕)": { group: "화덕", floor: "3층" },
};

/** 체크리스트 (분류 key, 항목명) → 연동 대상 설비 */
export function checklistSlotToTrackedEquipment(category: string, question: string): TrackedEquipmentSlot | null {
  return TRACKED_SLOTS[`${category}::${question}`] ?? null;
}

/** 해당 그룹·층의 운영중(없으면 예비) 설비 ID */
export async function resolveTrackedEquipmentId(
  supabase: SupabaseClient,
  organizationCode: string,
  slot: TrackedEquipmentSlot
): Promise<string | null> {
  let q = supabase
    .from("equipment_master")
    .select("id, lifecycle_status, floor_label, management_no")
    .eq("organization_code", organizationCode)
    .eq("dashboard_group", slot.group)
    .in("lifecycle_status", ["운영중", "예비"])
    .order("management_no", { ascending: false });
  if (slot.floor) q = q.eq("floor_label", slot.floor);
  const { data, error } = await q;
  if (error || !data?.length) return null;
  const rows = data as { id: string; lifecycle_status: string }[];
  return (rows.find((r) => r.lifecycle_status === "운영중") ?? rows[0]).id;
}

export function equipmentHistoryNewHref(slot: TrackedEquipmentSlot, detail: string, inspectionId?: string | null): string {
  const q = new URLSearchParams({ group: slot.group, detail });
  if (slot.floor) q.set("floor", slot.floor);
  if (inspectionId) q.set("inspection", inspectionId);
  return `/daily/equipment-history/new?${q.toString()}`;
}
