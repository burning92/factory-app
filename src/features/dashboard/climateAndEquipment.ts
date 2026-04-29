import type { SupabaseClient } from "@supabase/supabase-js";

export type ClimateZoneStat = {
  zoneName: string;
  avgTemp: number | null;
  avgHumidity: number | null;
  maxTemp: number | null;
  minTemp: number | null;
  sampleCount: number;
};

export type ClimateSummary = {
  overallAvgTemp: number | null;
  overallAvgHumidity: number | null;
  hottestZone: string | null;
  coolestZone: string | null;
  /** 구역별 평균 온도 기준 최고/최저 구역 라벨 */
  zones: ClimateZoneStat[];
  dayCount: number;
};

export type EquipmentIssueRow = {
  inspectionDate: string;
  category: string;
  questionText: string;
  note: string;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgoYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return ymd(d);
}

function shiftYmdByDays(baseYmd: string, deltaDays: number): string {
  const d = new Date(`${baseYmd}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return ymd(d);
}

async function fetchClimateSummaryForWindow(
  supabase: SupabaseClient,
  organizationCode: string,
  startYmd: string,
  endYmd: string
): Promise<ClimateSummary> {
  const { data: logs, error } = await supabase
    .from("daily_temp_humidity_logs")
    .select("id, inspection_date")
    .eq("organization_code", organizationCode)
    .eq("status", "approved")
    .gte("inspection_date", startYmd)
    .lte("inspection_date", endYmd)
    .order("inspection_date", { ascending: false });

  if (error || !logs?.length) {
    return {
      overallAvgTemp: null,
      overallAvgHumidity: null,
      hottestZone: null,
      coolestZone: null,
      zones: [],
      dayCount: 0,
    };
  }

  const logIds = logs.map((l) => (l as { id: string }).id);
  const { data: items } = await supabase
    .from("daily_temp_humidity_log_items")
    .select("zone_name, actual_temp_c, actual_humidity_pct")
    .in("log_id", logIds);

  const byZone = new Map<
    string,
    { temps: number[]; hums: number[] }
  >();
  const allTemps: number[] = [];
  const allHums: number[] = [];

  for (const row of items ?? []) {
    const r = row as {
      zone_name: string | null;
      actual_temp_c: unknown;
      actual_humidity_pct: unknown;
    };
    const zone = (r.zone_name ?? "").trim() || "구역";
    const t = Number(r.actual_temp_c);
    const h = Number(r.actual_humidity_pct);
    if (!byZone.has(zone)) byZone.set(zone, { temps: [], hums: [] });
    const z = byZone.get(zone)!;
    if (Number.isFinite(t)) {
      z.temps.push(t);
      allTemps.push(t);
    }
    if (Number.isFinite(h)) {
      z.hums.push(h);
      allHums.push(h);
    }
  }

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const zones: ClimateZoneStat[] = [];
  for (const [zoneName, zd] of Array.from(byZone.entries())) {
    const { temps, hums } = zd;
    zones.push({
      zoneName,
      avgTemp: avg(temps),
      avgHumidity: avg(hums),
      maxTemp: temps.length ? Math.max(...temps) : null,
      minTemp: temps.length ? Math.min(...temps) : null,
      sampleCount: temps.length,
    });
  }

  zones.sort((a, b) => (b.avgTemp ?? -999) - (a.avgTemp ?? -999));

  let hottestZone: string | null = null;
  let coolestZone: string | null = null;
  if (zones.length) {
    hottestZone = zones[0].zoneName;
    coolestZone = zones[zones.length - 1].zoneName;
  }

  const uniqueDays = new Set(logs.map((l) => String((l as { inspection_date: string }).inspection_date).slice(0, 10)));

  return {
    overallAvgTemp: avg(allTemps),
    overallAvgHumidity: avg(allHums),
    hottestZone,
    coolestZone,
    zones,
    dayCount: uniqueDays.size,
  };
}

/** 최근 `days`일, 승인된 온습도 일지 기준 구역별·전체 요약 */
export async function loadClimateSummary(
  supabase: SupabaseClient,
  organizationCode: string,
  days = 7
): Promise<ClimateSummary> {
  const start = daysAgoYmd(days - 1);
  const end = daysAgoYmd(0);
  return fetchClimateSummaryForWindow(supabase, organizationCode, start, end);
}

/** 임의 기간(start~end) 요약 */
export async function loadClimateSummaryForRange(
  supabase: SupabaseClient,
  organizationCode: string,
  startYmd: string,
  endYmd: string
): Promise<ClimateSummary> {
  return fetchClimateSummaryForWindow(supabase, organizationCode, startYmd, endYmd);
}

export type ClimateDashboardWindows = {
  current: ClimateSummary;
  /** 직전 동일 일수 구간 (예: 최근 7일 vs 그 이전 7일) — 대시보드 트렌드용 */
  previous: ClimateSummary;
};

/** 최근 N일 + 바로 이전 N일을 한 번에 조회 (대시보드 카드 증감 표시) */
export async function loadClimateDashboardWindows(
  supabase: SupabaseClient,
  organizationCode: string,
  days = 7
): Promise<ClimateDashboardWindows> {
  const endCur = daysAgoYmd(0);
  const startCur = daysAgoYmd(days - 1);
  const endPrev = daysAgoYmd(days);
  const startPrev = daysAgoYmd(days * 2 - 1);
  const [current, previous] = await Promise.all([
    fetchClimateSummaryForWindow(supabase, organizationCode, startCur, endCur),
    fetchClimateSummaryForWindow(supabase, organizationCode, startPrev, endPrev),
  ]);
  return { current, previous };
}

/** 임의 기간 + 직전 동일 기간 */
export async function loadClimateDashboardWindowsForRange(
  supabase: SupabaseClient,
  organizationCode: string,
  startYmd: string,
  endYmd: string
): Promise<ClimateDashboardWindows> {
  const start = new Date(`${startYmd}T00:00:00`);
  const end = new Date(`${endYmd}T00:00:00`);
  const spanDays = Math.max(1, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const prevEnd = shiftYmdByDays(startYmd, -1);
  const prevStart = shiftYmdByDays(prevEnd, -(spanDays - 1));
  const [current, previous] = await Promise.all([
    fetchClimateSummaryForWindow(supabase, organizationCode, startYmd, endYmd),
    fetchClimateSummaryForWindow(supabase, organizationCode, prevStart, prevEnd),
  ]);
  return { current, previous };
}

/** 최근 `days`일 제조설비 점검 중 부적합(X) 목록 */
export async function loadEquipmentIssues(
  supabase: SupabaseClient,
  organizationCode: string,
  days = 7
): Promise<{ issueCount: number; issues: EquipmentIssueRow[] }> {
  const start = daysAgoYmd(days - 1);
  const end = daysAgoYmd(0);
  return loadEquipmentIssuesForRange(supabase, organizationCode, start, end);
}

/** 임의 기간(start~end) 제조설비 점검 부적합(X) 목록 */
export async function loadEquipmentIssuesForRange(
  supabase: SupabaseClient,
  organizationCode: string,
  startYmd: string,
  endYmd: string
): Promise<{ issueCount: number; issues: EquipmentIssueRow[] }> {
  const { data: logs, error } = await supabase
    .from("daily_manufacturing_equipment_logs")
    .select("id, inspection_date")
    .eq("organization_code", organizationCode)
    .eq("status", "approved")
    .gte("inspection_date", startYmd)
    .lte("inspection_date", endYmd);

  if (error || !logs?.length) {
    return { issueCount: 0, issues: [] };
  }

  const logIds = logs.map((l) => (l as { id: string }).id);
  const dateByLog = new Map<string, string>();
  for (const l of logs) {
    const row = l as { id: string; inspection_date: string };
    dateByLog.set(row.id, String(row.inspection_date).slice(0, 10));
  }

  const { data: items } = await supabase
    .from("daily_manufacturing_equipment_log_items")
    .select("log_id, category, question_text, result, nonconformity_note")
    .in("log_id", logIds)
    .eq("result", "X");

  const issues: EquipmentIssueRow[] = [];
  for (const row of items ?? []) {
    const r = row as {
      log_id: string;
      category: string | null;
      question_text: string | null;
      nonconformity_note: string | null;
    };
    issues.push({
      inspectionDate: dateByLog.get(r.log_id) ?? "",
      category: (r.category ?? "").trim(),
      questionText: (r.question_text ?? "").trim(),
      note: (r.nonconformity_note ?? "").trim(),
    });
  }
  issues.sort((a, b) => b.inspectionDate.localeCompare(a.inspectionDate));
  return { issueCount: issues.length, issues };
}
