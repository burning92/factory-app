import { getSupabaseAdmin } from "@/lib/supabaseServer";

type AuditLogWriteParams = {
  actorUserId: string;
  action: string;
  targetTable: string;
  targetId?: string | null;
  targetLabel?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  meta?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function writeAuditLog(params: AuditLogWriteParams): Promise<void> {
  const admin = getSupabaseAdmin();
  const { data: actor } = await admin
    .from("profiles")
    .select("organization_id, login_id, display_name, role")
    .eq("id", params.actorUserId)
    .maybeSingle();

  await admin.from("audit_logs").insert({
    actor_user_id: params.actorUserId,
    organization_id: actor?.organization_id ?? null,
    actor_login_id: actor?.login_id ?? null,
    actor_display_name: actor?.display_name ?? null,
    actor_role: actor?.role ?? null,
    action: params.action,
    target_table: params.targetTable,
    target_id: params.targetId ?? null,
    target_label: params.targetLabel ?? null,
    before_data: params.beforeData ?? null,
    after_data: params.afterData ?? null,
    meta: params.meta ?? null,
    ip_address: params.ipAddress ?? null,
    user_agent: params.userAgent ?? null,
  });
}
