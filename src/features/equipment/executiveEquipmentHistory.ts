/**
 * 임원 대시보드용: equipment_master의 dashboard_group·lifecycle·노출 플래그 기준 집계
 * (설비명 문자열 매칭 없음 — 개별 equipment_id 단위)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatEquipmentMasterListLabel } from "./equipmentDisplay";
import type { EquipmentMasterRow } from "./equipmentTypes";

export type ExecutiveEquipmentUnitSnapshot = {
  dashboardGroup: "화덕" | "호이스트";
  displayTitle: string;
  masterId: string | null;
  /** max(record_date) — 신규 고장 이력 기준 */
  lastFaultOrStopAt: string | null;
  daysWithoutFault: number | null;
  /** 최신 이력 행 기준 */
  statusLabel: "진행 중" | "조치 완료" | "이력 없음";
  /** 진행 중이면서 최근(30일 이내) 고장 이력이 있으면 주의 톤 */
  recentHighImpact: boolean;
};

export type ExecutiveEquipmentHistoryDetail = ExecutiveEquipmentUnitSnapshot & {
  latestIssueLine: string | null;
  /** 최신 결과 1~2건 */
  recentUpdateLines: { result_date: string; text: string }[];
  /** 최근 이력 최대 5건 */
  recentRecords: { id: string; record_date: string; issue_summary: string; closure_status: string }[];
  lifecycleStatus: string;
  floorLabel: string | null;
};

function daysBetweenUtc(fromYmd: string, toDate: Date): number {
  const from = new Date(fromYmd.includes("T") ? fromYmd : `${fromYmd}T00:00:00`);
  const diff = toDate.getTime() - from.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

function oneLine(text: string | null | undefined, max = 72): string {
  const s = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function displayTitleForMaster(m: EquipmentMasterRow): string {
  return formatEquipmentMasterListLabel(m);
}

async function buildUnitSnapshot(
  supabase: SupabaseClient,
  organizationCode: string,
  group: "화덕" | "호이스트",
  master: EquipmentMasterRow | null
): Promise<ExecutiveEquipmentUnitSnapshot> {
  if (!master) {
    return {
      dashboardGroup: group,
      displayTitle: group,
      masterId: null,
      lastFaultOrStopAt: null,
      daysWithoutFault: null,
      statusLabel: "이력 없음",
      recentHighImpact: false,
    };
  }

  const masterId = master.id;
  const displayTitle = displayTitleForMaster(master);

  const { data: records, error } = await supabase
    .from("equipment_history_records")
    .select("id, record_date, issue_detail, closure_status, created_at")
    .eq("organization_code", organizationCode)
    .eq("equipment_id", masterId)
    .order("record_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("equipment_history_records (dashboard):", error.message);
  }

  const list = (records ?? []) as {
    id: string;
    record_date: string;
    issue_detail: string;
    closure_status: "ongoing" | "closed";
    created_at: string;
  }[];

  if (list.length === 0) {
    return {
      dashboardGroup: group,
      displayTitle,
      masterId,
      lastFaultOrStopAt: null,
      daysWithoutFault: null,
      statusLabel: "이력 없음",
      recentHighImpact: false,
    };
  }

  let maxDate = "";
  for (const r of list) {
    const d = String(r.record_date).slice(0, 10);
    if (d > maxDate) maxDate = d;
  }

  const now = new Date();
  const daysWithoutFault = Math.max(0, daysBetweenUtc(maxDate, now));

  const latest = list[0]!;
  const statusLabel: ExecutiveEquipmentUnitSnapshot["statusLabel"] =
    latest.closure_status === "closed" ? "조치 완료" : "진행 중";

  const recentHighImpact = latest.closure_status === "ongoing" && daysBetweenUtc(maxDate, now) <= 30;

  return {
    dashboardGroup: group,
    displayTitle,
    masterId,
    lastFaultOrStopAt: maxDate,
    daysWithoutFault,
    statusLabel,
    recentHighImpact,
  };
}

/** 대시보드 그룹·노출·운영중/예비 설비만 */
async function fetchMastersForExecutiveDashboard(
  supabase: SupabaseClient,
  organizationCode: string,
  dashboardGroup: "화덕" | "호이스트"
): Promise<EquipmentMasterRow[]> {
  const { data, error } = await supabase
    .from("equipment_master")
    .select("*")
    .eq("organization_code", organizationCode)
    .eq("dashboard_group", dashboardGroup)
    .eq("dashboard_visible", true)
    .in("lifecycle_status", ["운영중", "예비"])
    .order("unit_no", { ascending: true, nullsFirst: false })
    .order("management_no", { ascending: true });

  if (error) {
    console.warn("equipment_master (executive dashboard):", error.message);
    return [];
  }
  return (data ?? []) as EquipmentMasterRow[];
}

export async function loadExecutiveEquipmentSlotSnapshots(
  supabase: SupabaseClient,
  organizationCode: string
): Promise<{ 화덕: ExecutiveEquipmentUnitSnapshot[]; 호이스트: ExecutiveEquipmentUnitSnapshot[] }> {
  const [ovenMasters, hoistMasters] = await Promise.all([
    fetchMastersForExecutiveDashboard(supabase, organizationCode, "화덕"),
    fetchMastersForExecutiveDashboard(supabase, organizationCode, "호이스트"),
  ]);
  const [화덕, 호이스트] = await Promise.all([
    Promise.all(ovenMasters.map((m) => buildUnitSnapshot(supabase, organizationCode, "화덕", m))),
    Promise.all(hoistMasters.map((m) => buildUnitSnapshot(supabase, organizationCode, "호이스트", m))),
  ]);
  return { 화덕, 호이스트 };
}

async function fetchMastersForDetailGroup(
  supabase: SupabaseClient,
  organizationCode: string,
  dashboardGroup: "화덕" | "호이스트"
): Promise<EquipmentMasterRow[]> {
  const { data, error } = await supabase
    .from("equipment_master")
    .select("*")
    .eq("organization_code", organizationCode)
    .eq("dashboard_group", dashboardGroup)
    .order("unit_no", { ascending: true, nullsFirst: false })
    .order("management_no", { ascending: true });

  if (error) {
    console.warn("equipment_master (detail):", error.message);
    return [];
  }
  return (data ?? []) as EquipmentMasterRow[];
}

function effectiveLifecycleStatus(m: EquipmentMasterRow): string {
  if (m.lifecycle_status) return m.lifecycle_status;
  return m.is_active ? "운영중" : "사용중지";
}

function isOperatingPhase(m: EquipmentMasterRow): boolean {
  const s = effectiveLifecycleStatus(m);
  return s === "운영중" || s === "예비";
}

async function loadExecutiveEquipmentHistoryDetailForMaster(
  supabase: SupabaseClient,
  organizationCode: string,
  group: "화덕" | "호이스트",
  master: EquipmentMasterRow
): Promise<ExecutiveEquipmentHistoryDetail> {
  const base = await buildUnitSnapshot(supabase, organizationCode, group, master);

  const masterId = master.id;

  const { data: recRows } = await supabase
    .from("equipment_history_records")
    .select("id, record_date, issue_detail, closure_status")
    .eq("organization_code", organizationCode)
    .eq("equipment_id", masterId)
    .order("record_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5);

  const recentRecords = ((recRows ?? []) as { id: string; record_date: string; issue_detail: string; closure_status: string }[]).map(
    (r) => ({
      id: r.id,
      record_date: String(r.record_date).slice(0, 10),
      issue_summary: oneLine(r.issue_detail, 80),
      closure_status: r.closure_status === "closed" ? "조치 완료" : "진행 중",
    })
  );

  const latestIssueLine = recentRecords[0]?.issue_summary ?? null;

  const recordIds = recentRecords.map((r) => r.id);
  let recentUpdateLines: { result_date: string; text: string }[] = [];
  if (recordIds.length > 0) {
    const { data: ups } = await supabase
      .from("equipment_history_updates")
      .select("history_record_id, result_date, result_detail, created_at")
      .in("history_record_id", recordIds)
      .order("result_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(12);

    const sorted = ((ups ?? []) as { result_date: string; result_detail: string; created_at: string }[])
      .sort((a, b) => {
        const dr = String(b.result_date).localeCompare(String(a.result_date));
        if (dr !== 0) return dr;
        return String(b.created_at).localeCompare(String(a.created_at));
      })
      .slice(0, 2);

    recentUpdateLines = sorted.map((u) => ({
      result_date: String(u.result_date).slice(0, 10),
      text: oneLine(u.result_detail, 120),
    }));
  }

  return {
    ...base,
    latestIssueLine,
    recentUpdateLines,
    recentRecords,
    lifecycleStatus: effectiveLifecycleStatus(master),
    floorLabel: master.floor_label ?? null,
  };
}

export type ExecutiveEquipmentGroupDetail = {
  operating: ExecutiveEquipmentHistoryDetail[];
  past: ExecutiveEquipmentHistoryDetail[];
};

export async function loadExecutiveEquipmentGroupDetail(
  supabase: SupabaseClient,
  organizationCode: string,
  slot: "화덕" | "호이스트"
): Promise<ExecutiveEquipmentGroupDetail> {
  const masters = await fetchMastersForDetailGroup(supabase, organizationCode, slot);
  const operatingM = masters.filter((m) => isOperatingPhase(m));
  const pastM = masters.filter((m) => !isOperatingPhase(m));

  const [operating, past] = await Promise.all([
    Promise.all(operatingM.map((m) => loadExecutiveEquipmentHistoryDetailForMaster(supabase, organizationCode, slot, m))),
    Promise.all(pastM.map((m) => loadExecutiveEquipmentHistoryDetailForMaster(supabase, organizationCode, slot, m))),
  ]);

  return { operating, past };
}
