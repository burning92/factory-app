import { NextRequest, NextResponse } from "next/server";
import type { VacuumBagMovementType } from "@/features/materials/vacuum-bag-ordering/types";
import { createAdminClient, verifyPurchasingAccess } from "@/app/api/materials/purchasing/_auth";

type MovementPayload = {
  kind_key?: string;
  movement_type?: VacuumBagMovementType;
  qty?: number;
  movement_date?: string;
  memo?: string;
};

function parseQty(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export async function POST(req: NextRequest) {
  const auth = await verifyPurchasingAccess({
    authorizationHeader: req.headers.get("authorization"),
    refreshTokenHeader: req.headers.get("x-refresh-token"),
  });
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: MovementPayload;
  try {
    body = (await req.json()) as MovementPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const kindKey = String(body.kind_key ?? "").trim();
  const movementType = body.movement_type;
  const qty = parseQty(body.qty);
  const movementDate = String(body.movement_date ?? "").trim() || new Date().toISOString().slice(0, 10);
  const memo = body.memo != null ? String(body.memo).trim() : "";

  if (!kindKey) return NextResponse.json({ error: "kind_key_required" }, { status: 400 });
  if (movementType !== "stock_set" && movementType !== "receipt") {
    return NextResponse.json({ error: "invalid_movement_type" }, { status: 400 });
  }
  if (qty == null) return NextResponse.json({ error: "invalid_qty" }, { status: 400 });

  try {
    const admin = createAdminClient();

    const { data: kindRow, error: kindErr } = await admin
      .from("vacuum_bag_kinds")
      .select("kind_key")
      .eq("kind_key", kindKey)
      .maybeSingle();
    if (kindErr) throw kindErr;
    if (!kindRow) return NextResponse.json({ error: "unknown_kind" }, { status: 400 });

    const { data: balanceRow, error: balanceErr } = await admin
      .from("vacuum_bag_balances")
      .select("current_qty")
      .eq("kind_key", kindKey)
      .maybeSingle();
    if (balanceErr) throw balanceErr;

    const currentQty = Number(balanceRow?.current_qty) || 0;
    const nextQty = movementType === "stock_set" ? qty : currentQty + qty;

    const { error: insErr } = await admin.from("vacuum_bag_movements").insert({
      kind_key: kindKey,
      movement_type: movementType,
      qty,
      movement_date: movementDate,
      memo: memo || null,
      created_by: auth.userId,
    });
    if (insErr) throw insErr;

    const { error: upsertErr } = await admin.from("vacuum_bag_balances").upsert({
      kind_key: kindKey,
      current_qty: nextQty,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    });
    if (upsertErr) throw upsertErr;

    return NextResponse.json({ ok: true, current_qty: nextQty });
  } catch (e) {
    const message = e instanceof Error ? e.message : "movement_failed";
    return NextResponse.json({ ok: false, error: "movement_failed", message }, { status: 500 });
  }
}
