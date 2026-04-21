import { NextResponse } from "next/server";
import { getEquipmentHistoryAuthedClient } from "@/lib/equipmentHistoryRequestAuth";
import { writeAuditLog } from "@/lib/serverAuditLog";

/** 결과 이력 1건 삭제 — manager·headquarters·admin (RLS + API 역할 이중 검증) */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: updateId } = await context.params;
  if (!updateId) {
    return NextResponse.json({ error: "id가 없습니다." }, { status: 400 });
  }

  const auth = await getEquipmentHistoryAuthedClient(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.role !== "manager" && auth.role !== "headquarters" && auth.role !== "admin") {
    return NextResponse.json({ error: "삭제 권한이 없습니다." }, { status: 403 });
  }

  const { data: beforeRow } = await auth.client
    .from("equipment_history_updates")
    .select("id, result_date, text")
    .eq("id", updateId)
    .maybeSingle();

  const { error } = await auth.client.from("equipment_history_updates").delete().eq("id", updateId);
  if (error) {
    const msg = error.message?.includes("permission") || error.code === "42501" ? "삭제 권한이 없습니다." : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = request.headers.get("user-agent");
  await writeAuditLog({
    actorUserId: auth.userId,
    action: "delete",
    targetTable: "equipment_history_updates",
    targetId: updateId,
    targetLabel: beforeRow?.text ?? null,
    beforeData: beforeRow ?? null,
    afterData: null,
    meta: { via: "api/equipment-history/updates/[id]" },
    ipAddress: ip,
    userAgent: ua,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
