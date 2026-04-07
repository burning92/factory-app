import { NextResponse } from "next/server";
import { getEquipmentHistoryAuthedClient } from "@/lib/equipmentHistoryRequestAuth";

/** 결과 이력 1건 삭제 — manager·admin (RLS + API 역할 이중 검증) */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: updateId } = await context.params;
  if (!updateId) {
    return NextResponse.json({ error: "id가 없습니다." }, { status: 400 });
  }

  const auth = await getEquipmentHistoryAuthedClient(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.role !== "manager" && auth.role !== "admin") {
    return NextResponse.json({ error: "삭제 권한이 없습니다." }, { status: 403 });
  }

  const { error } = await auth.client.from("equipment_history_updates").delete().eq("id", updateId);
  if (error) {
    const msg = error.message?.includes("permission") || error.code === "42501" ? "삭제 권한이 없습니다." : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
