import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PLANNING_APRIL_2026_END,
  PLANNING_APRIL_2026_START,
  PLANNING_CUTOVER_DATE,
} from "@/features/production/plan/planningMirrorPolicy";

/** 생산계획 행 → 차감 일수 */
const CATEGORY_DAYS: Record<string, number> = {
  연차: 1,
  반차: 0.5,
  월차: 1,
};

/**
 * 운영 cutover: 5월 1일 이상 및 2026년 4월 구간은 planning board를 원장으로 사용.
 * legacy production_plan_rows 기반 연차 차감은 그 밖의 날짜만 반영한다.
 */

function normalizePersonKey(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

type ProfileRow = {
  id: string;
  display_name: string | null;
  login_id: string | null;
};

/**
 * display_name / login_id 로 profiles 매칭 (첫 일치만 사용)
 */
function buildProfileLookup(profiles: ProfileRow[]): {
  byDisplay: Map<string, string>;
  byLogin: Map<string, string>;
} {
  const byDisplay = new Map<string, string>();
  const byLogin = new Map<string, string>();
  for (const p of profiles) {
    const dn = p.display_name != null ? normalizePersonKey(p.display_name) : "";
    if (dn && !byDisplay.has(dn)) byDisplay.set(dn, p.id);
    const lid = p.login_id != null ? normalizePersonKey(p.login_id) : "";
    if (lid && !byLogin.has(lid)) byLogin.set(lid, p.id);
  }
  return { byDisplay, byLogin };
}

function resolveProfileId(
  productName: string,
  byDisplay: Map<string, string>,
  byLogin: Map<string, string>
): string | null {
  const key = normalizePersonKey(productName);
  if (!key) return null;
  return byDisplay.get(key) ?? byLogin.get(key) ?? null;
}

type PlanRow = {
  plan_date: string;
  product_name: string;
  category: string | null;
  plan_version: string | null;
};

export type SyncLeaveFromPlanResult = {
  /** 삭제된 생산계획 연동 행 수 */
  deletedPlanRows: number;
  /** 새로 넣은 차감 행 수 */
  inserted: number;
  /** 시트에 있으나 프로필과 매칭 안 된 이름(중복 없이) */
  unmatchedNames: string[];
};

/**
 * 생산계획 시트 동기화 후 호출.
 * - source=production_plan 인 차감만 전부 지우고, 현재 production_plan_rows 기준으로 다시 채움.
 * - plan_version = draft 는 제외하고, master/end 를 반영 (연도 누적 반영).
 * - 수동(manual) 차감은 건드리지 않음.
 */
export async function syncLeaveDeductionsFromProductionPlan(
  supabase: SupabaseClient
): Promise<SyncLeaveFromPlanResult> {
  const unmatchedNames = new Set<string>();

  const { data: profiles, error: pe } = await supabase.from("profiles").select("id, display_name, login_id");
  if (pe) throw pe;

  const { byDisplay, byLogin } = buildProfileLookup((profiles ?? []) as ProfileRow[]);

  const { data: planRows, error: re } = await supabase
    .from("production_plan_rows")
    .select("plan_date, product_name, category, plan_version")
    .neq("source_sheet_name", "planning_board")
    .in("plan_version", ["master", "end"]);
  if (re) throw re;

  const rows = (planRows ?? []) as PlanRow[];

  /** (plan_date, product_name, category) 별 일수 합산 — 시트 중복 행 대비 */
  const agg = new Map<string, { profile_id: string; usage_date: string; year: number; days: number; memo: string }>();

  for (const r of rows) {
    const cat = r.category != null ? String(r.category).trim() : "";
    const daysUnit = CATEGORY_DAYS[cat];
    if (daysUnit == null) continue;

    const product_name = (r.product_name != null ? String(r.product_name) : "").trim();
    if (!product_name) continue;

    const profileId = resolveProfileId(product_name, byDisplay, byLogin);
    if (!profileId) {
      unmatchedNames.add(normalizePersonKey(product_name));
      continue;
    }

    const usage_date = String(r.plan_date).slice(0, 10);
    if (usage_date >= PLANNING_CUTOVER_DATE) continue;
    if (usage_date >= PLANNING_APRIL_2026_START && usage_date <= PLANNING_APRIL_2026_END) continue;

    const y = Number(usage_date.slice(0, 4));
    if (!Number.isFinite(y)) continue;

    const key = `${usage_date}\0${normalizePersonKey(product_name)}\0${cat}`;
    const memo = `생산계획 자동 (${cat})`;
    const prev = agg.get(key);
    const addDays = daysUnit;
    if (prev) {
      // 같은 날짜·사람·구분이 버전별로 중복 존재할 때 1회만 반영
      prev.days = Math.max(prev.days, addDays);
    } else {
      agg.set(key, {
        profile_id: profileId,
        usage_date,
        year: y,
        days: addDays,
        memo,
      });
    }
  }

  const { data: deletedRows, error: delErr } = await supabase
    .from("leave_deductions")
    .delete()
    .eq("source", "production_plan")
    .select("id");
  if (delErr) throw delErr;
  const deletedPlanRows = deletedRows?.length ?? 0;

  const payload = Array.from(agg.values()).map((row) => ({
    profile_id: row.profile_id,
    year: row.year,
    usage_date: row.usage_date,
    days: row.days,
    memo: row.memo,
    created_by: null as string | null,
    source: "production_plan" as const,
  }));

  if (payload.length === 0) {
    return {
      deletedPlanRows,
      inserted: 0,
      unmatchedNames: Array.from(unmatchedNames).sort(),
    };
  }

  const { error: insErr } = await supabase.from("leave_deductions").insert(payload);
  if (insErr) throw insErr;

  return {
    deletedPlanRows,
    inserted: payload.length,
    unmatchedNames: Array.from(unmatchedNames).sort(),
  };
}
