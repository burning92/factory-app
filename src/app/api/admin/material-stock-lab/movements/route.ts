import { NextRequest, NextResponse } from "next/server";
import { normalizeInventoryItemCode } from "@/lib/inventoryItemCodeNormalize";
import { requireAdminMaterialStockLab } from "../_requireAdmin";

const ALLOWED_MANUAL_TYPES = new Set([
  "receipt",
  "waste",
  "adjustment",
  "return_unused",
  "ecount_reconcile",
]);

function signedQtyG(movementType: string, qtyInput: number): number {
  if (movementType === "adjustment" || movementType === "ecount_reconcile") return Number(qtyInput);
  const n = Math.abs(Number(qtyInput));
  if (!Number.isFinite(n)) return 0;
  if (movementType === "waste") return -n;
  return n;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminMaterialStockLab(req);
  if (!auth.ok) return auth.response;

  const { supabase } = auth;
  const codeRaw = req.nextUrl.searchParams.get("code") ?? "";
  const code = normalizeInventoryItemCode(codeRaw);
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 50));

  let q = supabase
    .from("material_stock_movements")
    .select(
      "id, inventory_item_code, material_id, movement_type, qty_g, effective_at, recorded_at, memo, voided_at, voided_by, void_reason, created_at, created_by"
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (code) q = q.eq("inventory_item_code", code);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: "movements_load_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminMaterialStockLab(req);
  if (!auth.ok) return auth.response;

  const { supabase, userId } = auth;

  let body: {
    inventory_item_code?: string;
    movement_type?: string;
    qty_g?: number;
    effective_at?: string;
    memo?: string | null;
    material_id?: string | null;
    idempotency_key?: string | null;
    source_table?: string | null;
    source_id?: string | null;
    source_version?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const movementType = String(body.movement_type ?? "").trim();
  if (!ALLOWED_MANUAL_TYPES.has(movementType)) {
    return NextResponse.json({ error: "invalid_movement_type" }, { status: 400 });
  }

  const inventory_item_code = normalizeInventoryItemCode(body.inventory_item_code);
  if (!inventory_item_code) {
    return NextResponse.json({ error: "invalid_inventory_item_code" }, { status: 400 });
  }

  const qty_g = signedQtyG(movementType, Number(body.qty_g));
  if (!Number.isFinite(qty_g) || qty_g === 0) {
    return NextResponse.json({ error: "invalid_qty_g" }, { status: 400 });
  }

  const effective_at = String(body.effective_at ?? "").trim();
  if (!effective_at) {
    return NextResponse.json({ error: "effective_at_required" }, { status: 400 });
  }

  let material_id: string | null = null;
  if (body.material_id != null && String(body.material_id).trim() !== "") {
    const mid = String(body.material_id).trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mid)) {
      return NextResponse.json({ error: "invalid_material_id" }, { status: 400 });
    }
    material_id = mid;
  }

  const row = {
    inventory_item_code,
    material_id,
    movement_type: movementType,
    qty_g,
    effective_at,
    memo: body.memo != null ? String(body.memo).slice(0, 2000) : null,
    idempotency_key: body.idempotency_key != null && String(body.idempotency_key).trim() !== "" ? String(body.idempotency_key).trim() : null,
    source_table: body.source_table != null ? String(body.source_table).slice(0, 200) : null,
    source_id: body.source_id != null ? String(body.source_id).slice(0, 200) : null,
    source_version: body.source_version != null ? String(body.source_version).slice(0, 200) : null,
    created_by: userId,
  };

  const { data, error } = await supabase.from("material_stock_movements").insert(row).select("id").single();
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "idempotency_conflict", message: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "movement_insert_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: (data as { id?: string })?.id });
}
