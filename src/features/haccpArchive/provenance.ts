/** 기록이 지금 저장된 곳. 최초 작성 경로(웹 앱·AppSheet 이관 등)와는 별개다. */
export const STORAGE_LABEL = "Supabase 전자일지 DB";

export const PROVENANCE_UNKNOWN = "출처 미확인(작성 감사로그 없음)";

export type CreateAudit = { actor_source?: unknown; actor_user_id?: unknown };

/**
 * 생성 감사로그로만 작성 경로를 판단한다. 감사로그가 없으면(보존기간 경과, 이관 자료 등) 단정하지 않는다.
 * - app_user 또는 구버전 트리거(로그인 사용자 필수) → 웹 전자일지
 * - service_role → 서버 처리 / direct_sql → DB 직접 입력
 */
export function provenanceLabel(createAudit: CreateAudit | null | undefined): string {
  if (!createAudit) return PROVENANCE_UNKNOWN;
  const source = createAudit.actor_source == null ? "" : String(createAudit.actor_source);
  if (source === "app_user" || (!source && createAudit.actor_user_id)) return "웹 전자일지 작성(감사로그 근거)";
  if (source === "service_role") return "서버 처리로 생성(감사로그 근거)";
  if (source === "direct_sql") return "DB 직접 입력(감사로그 근거)";
  return `확인 필요(감사로그 actor_source=${source || "없음"})`;
}
