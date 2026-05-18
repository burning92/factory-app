import { NextRequest, NextResponse } from "next/server";
import { requireAdminMaterialStockLab } from "../../../_requireAdmin";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminMaterialStockLab(req);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let body: { void_reason?: string };
  try {
    body = (await req.json()) as { void_reason?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const void_reason = String(body.void_reason ?? "").trim();
  if (!void_reason) {
    return NextResponse.json({ error: "void_reason_required" }, { status: 400 });
  }

  const { supabase, userId } = auth;

  const { data: existing, error: findErr } = await supabase
    .from("material_stock_movements")
    .select("id, voided_at")
    .eq("id", id)
    .maybeSingle();

  if (findErr) {
    return NextResponse.json({ error: "movement_lookup_failed", message: findErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if ((existing as { voided_at?: string | null }).voided_at != null) {
    return NextResponse.json({ error: "already_voided" }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("material_stock_movements")
    .update({
      voided_at: nowIso,
      voided_by: userId,
      void_reason: void_reason.slice(0, 2000),
    })
    .eq("id", id)
    .is("voided_at", null);

  if (updErr) {
    return NextResponse.json({ error: "void_failed", message: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id, voided_at: nowIso });
}
