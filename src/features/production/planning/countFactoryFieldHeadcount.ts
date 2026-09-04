import type { SupabaseClient } from "@supabase/supabase-js";
import { ROTATION_FACTORY_ORG } from "@/features/production/rotation/factoryOrg";
import {
  organizationCodeFromProfileRow,
  profileCountsTowardFieldHeadcount,
} from "@/lib/profileFieldHeadcount";

export type FactoryFieldHeadcountRow = {
  login_id?: string | null;
  is_active?: boolean | null;
  include_in_field_headcount?: boolean | null;
  organizations?: { organization_code?: string | null } | { organization_code?: string | null }[] | null;
};

/** 공장(100) + 총원 포함 지정. 로테이션 명단·일자별 투입 인원 기준이 같다. */
export function isFactoryFieldHeadcountProfile(row: FactoryFieldHeadcountRow): boolean {
  if (organizationCodeFromProfileRow(row.organizations) !== ROTATION_FACTORY_ORG) return false;
  return profileCountsTowardFieldHeadcount({
    isActive: row.is_active !== false,
    includeInFieldHeadcount: row.include_in_field_headcount === true,
    loginId: row.login_id,
  });
}

export async function countFactoryFieldHeadcount(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin
    .from("profiles")
    .select("login_id,is_active,include_in_field_headcount,organizations(organization_code)")
    .eq("is_active", true);
  if (error) throw error;
  return ((data ?? []) as FactoryFieldHeadcountRow[]).filter(isFactoryFieldHeadcountProfile).length;
}
