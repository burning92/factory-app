import { NextResponse } from "next/server";
import { getEquipmentHistoryAuthedClient } from "@/lib/equipmentHistoryRequestAuth";
import { writeAuditLog } from "@/lib/serverAuditLog";

/**
 * 설비이력기록부 본문 삭제 — admin만 (RLS + API 역할 이중 검증)
 * 연결된 equipment_history_updates는 FK ON DELETE CASCADE로 함께 삭제
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: recordId } = await context.params;
  if (!recordId) {
    return NextResponse.json({ error: "id가 없습니다." }, { status: 400 });
  }

  const auth = await getEquipmentHistoryAuthedClient(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "삭제 권한이 없습니다." }, { status: 403 });
  }

  const { data: beforeRow } = await auth.client
    .from("equipment_history_records")
    .select("id, record_date, issue_summary, issue_detail, closure_status")
    .eq("id", recordId)
    .maybeSingle();

  const { error } = await auth.client.from("equipment_history_records").delete().eq("id", recordId);
  if (error) {
    const msg = error.message?.includes("permission") || error.code === "42501" ? "삭제 권한이 없습니다." : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = request.headers.get("user-agent");
  await writeAuditLog({
    actorUserId: auth.userId,
    action: "delete",
    targetTable: "equipment_history_records",
    targetId: recordId,
    targetLabel: beforeRow?.issue_summary ?? null,
    beforeData: beforeRow ?? null,
    afterData: null,
    meta: { via: "api/equipment-history/records/[id]" },
    ipAddress: ip,
    userAgent: ua,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
