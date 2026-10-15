export type AccountProfile = {
  display_name: string | null;
  login_id: string | null;
  organization_code: string | null;
  organization_name: string | null;
};

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function authorCompareLabel(
  recordedName: unknown,
  userId: unknown,
  profile: AccountProfile | undefined
): string {
  const recorded = text(recordedName);
  if (!userId) {
    if (recorded === null) return "기록상 이름 NULL, 작성 계정 없음";
    if (recorded === "") return "기록상 이름 빈 문자열, 작성 계정 없음";
    return "작성 계정 없음";
  }
  if (!profile) return "작성 계정 프로필 없음";
  const display = profile.display_name;
  if (recorded === null && display === null) return "기록상 이름 NULL, 계정 표시이름 NULL";
  if (recorded === null) return "기록상 이름 NULL";
  if (recorded === "") return "기록상 이름 빈 문자열";
  if (display === null) return "계정 표시이름 NULL";
  if (display === "") return "계정 표시이름 빈 문자열";
  if (recorded.trim() === display.trim()) return "일치";
  return "불일치";
}

export function approvalConsistencyLabel(
  row: Record<string, unknown>,
  approverProfile: AccountProfile | undefined
): string {
  const status = text(row.status);
  const approvedAt = row.approved_at;
  const approvedBy = row.approved_by;
  const approvedName = text(row.approved_by_name);
  const hasAt = approvedAt !== null && approvedAt !== undefined && approvedAt !== "";
  const hasBy = approvedBy !== null && approvedBy !== undefined && approvedBy !== "";
  const hasName = approvedName !== null && approvedName !== "";
  const issues: string[] = [];

  if (status === "approved") {
    if (!hasAt) issues.push("승인 상태이나 승인시각 없음");
    if (!hasBy) issues.push("승인 상태이나 승인자 계정 없음");
    if (!hasName) issues.push("승인 상태이나 승인자 이름 없음");
    if (hasBy && !approverProfile) issues.push("승인자 계정 프로필 없음");
    if (hasName && approverProfile) {
      const display = approverProfile.display_name;
      if (display == null || display === "") issues.push("승인자 계정 표시이름 없음");
      else if (approvedName!.trim() !== display.trim()) issues.push("승인자 이름과 현재 계정 표시이름 불일치");
    }
    return issues.length === 0 ? "정합" : issues.join("; ");
  }

  if (hasAt) issues.push("승인 상태가 아닌데 승인시각 있음");
  if (hasBy) issues.push("승인 상태가 아닌데 승인자 계정 있음");
  if (hasName) issues.push("승인 상태가 아닌데 승인자 이름 있음");
  return issues.length === 0 ? "해당 없음" : issues.join("; ");
}

export const AUDIT_MISSING_LABEL = "이력 추적자료 미보유";

export function auditTraceLabel(count: number): string {
  if (count <= 0) return AUDIT_MISSING_LABEL;
  return `연결 이력 ${count}건`;
}
