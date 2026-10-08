/**
 * 제조설비 점검표 부적합 조회 (설비 이상 이력은 설비이력기록부로 통합됨)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

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
