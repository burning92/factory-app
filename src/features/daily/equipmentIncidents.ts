/**
 * 설비 이상 이력 — 점검표(부적합)와 별도 관리
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type EquipmentIncidentEquipment = "화덕" | "호이스트" | "기타";
export type EquipmentIncidentType = "이상" | "고장" | "가동중지";
export type EquipmentSymptomType = "소음" | "작동불량" | "체인 이상" | "버튼 불량" | "기타";
export type EquipmentActionStatus = "확인중" | "수리요청" | "수리중" | "조치완료";
export type EquipmentIncidentSource = "manual" | "linked_from_inspection";

export type EquipmentIncidentRow = {
  id: string;
  organization_code: string;
  equipment_name: EquipmentIncidentEquipment;
  equipment_custom_name: string | null;
  occurred_at: string;
  incident_type: EquipmentIncidentType;
  symptom_type: EquipmentSymptomType;
  symptom_other: string | null;
  detail: string;
  has_production_impact: boolean;
  action_status: EquipmentActionStatus;
  resumed_at: string | null;
  notes: string | null;
  source_type: EquipmentIncidentSource;
  linked_inspection_id: string | null;
  linked_inspection_item_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type InsertEquipmentIncidentInput = {
  organization_code: string;
  equipment_name: EquipmentIncidentEquipment;
  equipment_custom_name?: string | null;
  occurred_at: string;
  incident_type: EquipmentIncidentType;
  symptom_type: EquipmentSymptomType;
  symptom_other?: string | null;
  detail: string;
  has_production_impact: boolean;
  action_status: EquipmentActionStatus;
  resumed_at?: string | null;
  notes?: string | null;
  source_type: EquipmentIncidentSource;
  linked_inspection_id?: string | null;
  linked_inspection_item_id?: string | null;
  created_by?: string | null;
};

/** 체크리스트 (categoryIndex, questionIndex) → 주요 설비명. 해당 항목만 대시보드 추적. */
export function checklistSlotToTrackedEquipment(
  categoryIndex: number,
  questionIndex: number
): EquipmentIncidentEquipment | null {
  if (categoryIndex === 2 && questionIndex === 2) return "화덕";
  if (categoryIndex === 1 && questionIndex === 2) return "호이스트";
  return null;
}

const OVEN = { category: "가열실", question: "터널오븐(화덕)" } as const;
const HOIST = { category: "성형실", question: "호이스트" } as const;

/** 승인 일지 기준: 해당 설비 항목의 가장 최근 부적합 일자 */
export async function loadLastInspectionNonconformDate(
  supabase: SupabaseClient,
  organizationCode: string,
  equipment: "화덕" | "호이스트"
): Promise<string | null> {
  const spec = equipment === "화덕" ? OVEN : HOIST;
  const { data: logs, error: logErr } = await supabase
    .from("daily_manufacturing_equipment_logs")
    .select("id, inspection_date")
    .eq("organization_code", organizationCode)
    .eq("status", "approved")
    .order("inspection_date", { ascending: false })
    .limit(800);
  if (logErr || !logs?.length) return null;

  const dateById = new Map((logs as { id: string; inspection_date: string }[]).map((l) => [l.id, l.inspection_date]));
  const logIds = Array.from(dateById.keys());
  const { data: items } = await supabase
    .from("daily_manufacturing_equipment_log_items")
    .select("log_id")
    .in("log_id", logIds)
    .eq("category", spec.category)
    .eq("question_text", spec.question)
    .eq("result", "X");

  let best = "";
  for (const row of items ?? []) {
    const lid = (row as { log_id: string }).log_id;
    const d = String(dateById.get(lid) ?? "").slice(0, 10);
    if (d && d > best) best = d;
  }
  return best || null;
}

export type MajorEquipmentIncidentStats = {
  equipment: "화덕" | "호이스트";
  /** 설비 이상 등록 중 가장 최근 발생일 (모든 구분) */
  lastIncidentAt: string | null;
  /** 고장·가동중지만 — 무고장 경과일 계산 기준 */
  lastFaultOrStopAt: string | null;
  /** 마지막 고장/가동중지 이후 경과일. 해당 이력 없으면 null */
  daysWithoutFault: number | null;
  /** 최근 등록 중 생산영향 있음 + (고장 또는 가동중지) */
  recentHighImpact: boolean;
};

function daysBetweenUtc(fromYmdOrIso: string, toDate: Date): number {
  const from = new Date(fromYmdOrIso.includes("T") ? fromYmdOrIso : `${fromYmdOrIso}T00:00:00`);
  const diff = toDate.getTime() - from.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

export async function loadMajorEquipmentIncidentStats(
  supabase: SupabaseClient,
  organizationCode: string
): Promise<{ 화덕: MajorEquipmentIncidentStats; 호이스트: MajorEquipmentIncidentStats }> {
  const now = new Date();
  const { data: rows, error } = await supabase
    .from("equipment_incidents")
    .select("equipment_name, occurred_at, incident_type, has_production_impact")
    .eq("organization_code", organizationCode)
    .in("equipment_name", ["화덕", "호이스트"]);

  if (error) {
    console.warn("equipment_incidents load:", error.message);
  }

  const list = (rows ?? []) as {
    equipment_name: string;
    occurred_at: string;
    incident_type: EquipmentIncidentType;
    has_production_impact: boolean;
  }[];

  function build(equipment: "화덕" | "호이스트"): MajorEquipmentIncidentStats {
    const mine = list
      .filter((r) => r.equipment_name === equipment)
      .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));

    const lastIncidentAt = mine.length ? String(mine[0]!.occurred_at).slice(0, 10) : null;

    const faultStops = mine.filter((r) => r.incident_type === "고장" || r.incident_type === "가동중지");
    const lastFaultOrStopAt = faultStops.length
      ? String(faultStops[0]!.occurred_at).slice(0, 10)
      : null;

    const daysWithoutFault =
      lastFaultOrStopAt != null ? Math.max(0, daysBetweenUtc(lastFaultOrStopAt, now)) : null;

    const recentHighImpact = mine.some(
      (r) =>
        r.has_production_impact &&
        (r.incident_type === "고장" || r.incident_type === "가동중지") &&
        daysBetweenUtc(String(r.occurred_at).slice(0, 10), now) <= 30
    );

    return {
      equipment,
      lastIncidentAt,
      lastFaultOrStopAt,
      daysWithoutFault,
      recentHighImpact,
    };
  }

  return { 화덕: build("화덕"), 호이스트: build("호이스트") };
}

export async function insertEquipmentIncident(
  supabase: SupabaseClient,
  input: InsertEquipmentIncidentInput
): Promise<{ id: string | null; error: Error | null }> {
  const payload = {
    organization_code: input.organization_code,
    equipment_name: input.equipment_name,
    equipment_custom_name: input.equipment_custom_name ?? null,
    occurred_at: input.occurred_at,
    incident_type: input.incident_type,
    symptom_type: input.symptom_type,
    symptom_other: input.symptom_other ?? null,
    detail: input.detail,
    has_production_impact: input.has_production_impact,
    action_status: input.action_status,
    resumed_at: input.resumed_at ?? null,
    notes: input.notes ?? null,
    source_type: input.source_type,
    linked_inspection_id: input.linked_inspection_id ?? null,
    linked_inspection_item_id: input.linked_inspection_item_id ?? null,
    created_by: input.created_by ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("equipment_incidents").insert(payload).select("id").single();

  if (error) {
    return { id: null, error: new Error(error.message) };
  }
  return { id: (data as { id: string }).id, error: null };
}

export async function loadRecentIncidentsForEquipment(
  supabase: SupabaseClient,
  organizationCode: string,
  equipment: "화덕" | "호이스트",
  limit = 3
): Promise<EquipmentIncidentRow[]> {
  const { data, error } = await supabase
    .from("equipment_incidents")
    .select("*")
    .eq("organization_code", organizationCode)
    .eq("equipment_name", equipment)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as EquipmentIncidentRow[];
}
