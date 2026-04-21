/** 월간 플래닝·인력 KPI 등 «현장 총원» 참고 집계에 쓰는 역할 */
export const FIELD_HEADCOUNT_ROLES = ["worker", "assistant_manager", "manager"] as const;

export type FieldHeadcountRole = (typeof FIELD_HEADCOUNT_ROLES)[number];

/** 회사코드 100번대: 숫자 100~199 (예: 100 공장, 추후 101 등) */
export function isOrgCodeHundredSeries(organizationCode: string | null | undefined): boolean {
  const c = (organizationCode ?? "").trim();
  if (!/^\d{3}$/.test(c)) return false;
  const n = parseInt(c, 10);
  return n >= 100 && n <= 199;
}

export function isFieldHeadcountRole(role: string | null | undefined): boolean {
  const r = (role ?? "").trim();
  return r === "worker" || r === "assistant_manager" || r === "manager";
}

/** 시험·시스템용 로그인 아이디는 현장 총원 집계에서 제외 */
export function isExcludedFromFieldHeadcountByLoginId(loginId: string | null | undefined): boolean {
  const id = (loginId ?? "").trim().toLowerCase();
  if (!id) return false;
  if (id === "admin") return true;
  if (id === "test" || id.startsWith("test")) return true;
  return false;
}

/** 활성 + 100번대 조직 + 현장 직군만 «총원» 참고 집계에 포함 (test·admin 계열 로그인 제외) */
export function profileCountsTowardFieldHeadcount(params: {
  isActive: boolean;
  role: string | null | undefined;
  organizationCode: string | null | undefined;
  loginId?: string | null | undefined;
}): boolean {
  if (!params.isActive) return false;
  if (isExcludedFromFieldHeadcountByLoginId(params.loginId)) return false;
  if (!isFieldHeadcountRole(params.role)) return false;
  return isOrgCodeHundredSeries(params.organizationCode);
}

export function organizationCodeFromProfileRow(
  organizations: { organization_code?: string | null } | { organization_code?: string | null }[] | null | undefined
): string {
  if (!organizations) return "";
  const o = Array.isArray(organizations) ? organizations[0] : organizations;
  return (o?.organization_code ?? "").trim();
}
