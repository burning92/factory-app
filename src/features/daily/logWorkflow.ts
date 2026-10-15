import type { SupabaseClient } from "@supabase/supabase-js";
import { getDailyLogAccess, type DailyLogAccessRow } from "@/app/daily/dailyLogPermissions";

type Row = Record<string, unknown>;

/** 제출·승인 흐름 컬럼: 정정 전후 비교에서 내용 변경으로 보지 않는다 (DB daily_log_workflow_columns 와 같음) */
export const DAILY_LOG_WORKFLOW_COLUMNS = [
  "status",
  "submitted_at",
  "submitted_by",
  "approved_at",
  "approved_by",
  "approved_by_name",
  "rejected_at",
  "rejected_by",
  "reject_reason",
  "updated_at",
] as const;

const NOT_CONTENT = new Set<string>([...DAILY_LOG_WORKFLOW_COLUMNS, "id", "created_at"]);

export class DailyLogLockedError extends Error {}

async function fetchHeader(client: SupabaseClient, table: string, logId: string): Promise<Row | null> {
  const { data, error } = await client.from(table).select("*").eq("id", logId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Row | null) ?? null;
}

/**
 * 기존 일지에 저장·제출하기 직전에 최신 상태로 권한을 다시 확인한다.
 * (다른 화면에서 이미 제출·승인됐거나, 날짜로 찾은 일지가 다른 사람 것일 수 있음)
 */
export async function assertDailyLogWritable(
  client: SupabaseClient,
  table: string,
  logId: string,
  userId: string | null | undefined,
  role: string | null | undefined
): Promise<void> {
  const row = await fetchHeader(client, table, logId);
  if (!row) throw new DailyLogLockedError("일지를 찾을 수 없습니다. 목록에서 다시 열어 주세요.");
  const access = getDailyLogAccess(row as DailyLogAccessRow, userId, role);
  if (!access.canEdit) {
    throw new DailyLogLockedError(access.lockReason ?? "이 일지는 지금 수정할 수 없습니다.");
  }
}

/** 제출 회수: 제출 → 작성 중. 제출시각은 이력으로 남긴다. */
export async function withdrawDailyLogSubmission(client: SupabaseClient, table: string, logId: string): Promise<void> {
  const { data, error } = await client
    .from(table)
    .update({ status: "draft", updated_at: new Date().toISOString() })
    .eq("id", logId)
    .eq("status", "submitted")
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("이미 승인·반려됐거나 제출 상태가 아니어서 회수하지 못했습니다. 화면을 새로고침해 주세요.");
  }
}

function isMissingRpc(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "");
}

/** 관리자급: 승인된 일지를 사유와 함께 재검토(반려) 상태로 되돌린다. 정정 전 기록은 DB가 보존한다. */
export async function requestDailyLogCorrection(
  client: SupabaseClient,
  table: string,
  logId: string,
  reason: string
): Promise<string> {
  const trimmed = reason.trim();
  if (trimmed.length < 5) throw new Error("정정 사유를 5자 이상 입력하세요.");
  const { data, error } = await client.rpc("request_daily_log_correction", {
    p_table: table,
    p_log_id: logId,
    p_reason: trimmed,
  });
  if (error) {
    if (isMissingRpc(error)) {
      throw new Error("정정 요청 기능은 DB 업데이트(정정 절차 마이그레이션) 적용 후 사용할 수 있습니다. 시스템 관리자에게 문의하세요.");
    }
    throw new Error(error.message);
  }
  return String(data);
}

export type DailyLogCorrection = {
  id: string;
  created_at: string;
  kind: string | null;
  reason: string;
  requested_by_name: string | null;
  approved_by_name: string | null;
  before_header: Row | null;
  before_item_count: number | null;
};

/** 관리자급만 조회 가능(data_corrections RLS). 권한이 없거나 표가 없으면 빈 목록 */
export async function loadDailyLogCorrections(
  client: SupabaseClient,
  table: string,
  logId: string
): Promise<DailyLogCorrection[]> {
  const { data, error } = await client
    .from("data_corrections")
    .select("*")
    .eq("target_table", table)
    .contains("target_ids", [logId])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((c) => {
    const snapshot = (c.before_snapshot ?? null) as Row | null;
    const header = (snapshot?.header ?? null) as Row | null;
    const items = snapshot?.items;
    return {
      id: String(c.id),
      created_at: String(c.created_at),
      kind: (c.kind as string | undefined) ?? null,
      reason: String(c.reason ?? ""),
      requested_by_name: (c.requested_by_name as string | null) ?? null,
      approved_by_name: (c.approved_by_name as string | null) ?? null,
      before_header: header,
      before_item_count: Array.isArray(items) ? items.length : null,
    };
  });
}

export type FieldChange = { column: string; before: unknown; after: unknown };

/** 정정 전 머리글과 현재 머리글의 내용 차이 (제출·승인 흐름 컬럼 제외) */
export function diffDailyLogHeader(before: Row | null, current: Row | null): FieldChange[] {
  if (!before || !current) return [];
  const columns = new Set([...Object.keys(before), ...Object.keys(current)]);
  const changes: FieldChange[] = [];
  for (const column of Array.from(columns).sort()) {
    if (NOT_CONTENT.has(column)) continue;
    const a = before[column] ?? null;
    const b = current[column] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ column, before: a, after: b });
  }
  return changes;
}
