import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, verifyPurchasingAccess } from "../_auth";

type MaterialType = "raw_material" | "submaterial";

type VendorItemBody = {
  id?: string;
  vendor_id?: string;
  material_type?: MaterialType;
  material_code?: string | null;
  material_name_snapshot?: string;
  order_spec_label?: string;
  purchase_unit_weight_g?: number;
  purchase_unit_name?: string;
  lead_time_days?: number;
  safety_stock_g?: number;
  order_policy?: "normal" | "on_demand";
  is_primary_vendor?: boolean;
  note?: string | null;
};

async function clearOtherPrimaryVendors(params: {
  admin: ReturnType<typeof createAdminClient>;
  materialType: MaterialType;
  materialCode: string | null;
  materialNameSnapshot: string;
  excludeId?: string;
}) {
  const { admin, materialType, materialCode, materialNameSnapshot, excludeId } = params;
  let query = admin
    .from("purchase_vendor_items")
    .update({ is_primary_vendor: false, updated_at: new Date().toISOString() })
    .eq("material_type", materialType)
    .eq("is_primary_vendor", true);
  if (excludeId) query = query.neq("id", excludeId);
  if (materialCode) {
    query = query.eq("material_code", materialCode);
  } else {
    query = query.eq("material_name_snapshot", materialNameSnapshot).is("material_code", null);
  }
  await query;
}

export async function GET(req: NextRequest) {
  const verified = await verifyPurchasingAccess({
    authorizationHeader: req.headers.get("authorization"),
    refreshTokenHeader: req.headers.get("x-refresh-token"),
  });
  if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: verified.status });
  const admin = createAdminClient();
  const sp = req.nextUrl.searchParams;
  const vendorId = (sp.get("vendor_id") ?? "").trim();
  const materialType = (sp.get("material_type") ?? "raw_material").trim() as MaterialType;
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const onlyUnregistered = sp.get("only_unregistered") === "1";

  const [{ data: vendors, error: vendorsErr }, { data: materialRows, error: materialsErr }, { data: subRows, error: subErr }] =
    await Promise.all([
      admin.from("purchase_vendors").select("id,vendor_name,is_active").order("vendor_name", { ascending: true }),
      admin.from("materials").select("id,material_name,inventory_item_code").order("material_name", { ascending: true }),
      admin
        .from("planning_submaterial_items")
        .select("id,submaterial_name,inventory_item_code,active")
        .eq("active", true)
        .order("submaterial_name", { ascending: true }),
    ]);
  if (vendorsErr || materialsErr || subErr) {
    return NextResponse.json(
      { error: "failed_to_load_setup_refs", message: vendorsErr?.message ?? materialsErr?.message ?? subErr?.message },
      { status: 500 }
    );
  }

  const optionsRaw = ((materialRows ?? []) as Record<string, unknown>[]).map((r) => ({
    material_type: "raw_material" as const,
    source_id: String(r.id ?? ""),
    material_name: String(r.material_name ?? ""),
    material_code: r.inventory_item_code != null ? String(r.inventory_item_code) : null,
  }));
  const optionsSub = ((subRows ?? []) as Record<string, unknown>[]).map((r) => ({
    material_type: "submaterial" as const,
    source_id: String(r.id ?? ""),
    material_name: String(r.submaterial_name ?? ""),
    material_code: r.inventory_item_code != null ? String(r.inventory_item_code) : null,
  }));

  let itemsQuery = admin
    .from("purchase_vendor_items")
    .select(
      "id,vendor_id,material_code,material_name_snapshot,material_type,order_spec_label,purchase_unit_weight_g,purchase_unit_name,lead_time_days,safety_stock_g,order_policy,is_primary_vendor,note,created_at,updated_at"
    )
    .order("material_type", { ascending: true })
    .order("material_name_snapshot", { ascending: true });
  if (vendorId) itemsQuery = itemsQuery.eq("vendor_id", vendorId);
  const { data: itemRows, error: itemsErr } = await itemsQuery;
  if (itemsErr) return NextResponse.json({ error: "failed_to_load_vendor_items", message: itemsErr.message }, { status: 500 });

  const existingKeySet = new Set(
    ((itemRows ?? []) as Record<string, unknown>[]).map(
      (r) =>
        `${String(r.material_type ?? "")}__${
          String(r.material_code ?? "").trim() || String(r.material_name_snapshot ?? "").trim()
        }`
    )
  );
  const baseOptions = [...optionsRaw, ...optionsSub].filter((opt) => opt.material_type === materialType);
  const filteredOptions = baseOptions.filter((opt) => {
    if (q && !opt.material_name.toLowerCase().includes(q) && !(opt.material_code ?? "").toLowerCase().includes(q)) return false;
    if (onlyUnregistered && vendorId) {
      const key = `${opt.material_type}__${(opt.material_code ?? "").trim() || opt.material_name.trim()}`;
      if (existingKeySet.has(key)) return false;
    }
    return true;
  });

  return NextResponse.json({
    ok: true,
    data: {
      vendors: vendors ?? [],
      options: filteredOptions.slice(0, 200),
      items: itemRows ?? [],
    },
  });
}

export async function POST(req: NextRequest) {
  const verified = await verifyPurchasingAccess({
    authorizationHeader: req.headers.get("authorization"),
    refreshTokenHeader: req.headers.get("x-refresh-token"),
  });
  if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: verified.status });
  let body: VendorItemBody;
  try {
    body = (await req.json()) as VendorItemBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const vendorId = String(body.vendor_id ?? "").trim();
  const materialName = String(body.material_name_snapshot ?? "").trim();
  const materialType = body.material_type === "submaterial" ? "submaterial" : "raw_material";
  if (!vendorId || !materialName) return NextResponse.json({ error: "vendor_and_material_required" }, { status: 400 });
  const admin = createAdminClient();
  const materialCode = body.material_code?.trim() || null;
  const { data: existingRows, error: existingErr } = await admin
    .from("purchase_vendor_items")
    .select("id")
    .eq("vendor_id", vendorId)
    .eq("material_type", materialType)
    .eq(materialCode ? "material_code" : "material_name_snapshot", materialCode ?? materialName)
    .limit(1);
  if (existingErr) return NextResponse.json({ error: "failed_to_check_duplicate", message: existingErr.message }, { status: 500 });
  const existingId = existingRows?.[0]?.id ? String(existingRows[0].id) : null;

  const payload = {
    vendor_id: vendorId,
    material_type: materialType,
    material_code: materialCode,
    material_name_snapshot: materialName,
    order_spec_label: String(body.order_spec_label ?? "").trim() || null,
    purchase_unit_weight_g: Number(body.purchase_unit_weight_g) || 0,
    purchase_unit_name: String(body.purchase_unit_name ?? "").trim() || null,
    lead_time_days: Number(body.lead_time_days) || 0,
    safety_stock_g: Number(body.safety_stock_g) || 0,
    order_policy: body.order_policy === "on_demand" ? "on_demand" : "normal",
    is_primary_vendor: body.is_primary_vendor === true,
    note: body.note?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  let mutate = admin.from("purchase_vendor_items");
  const { data, error } = existingId
    ? await mutate
        .update(payload)
        .eq("id", existingId)
        .select(
          "id,vendor_id,material_code,material_name_snapshot,material_type,order_spec_label,purchase_unit_weight_g,purchase_unit_name,lead_time_days,safety_stock_g,order_policy,is_primary_vendor,note,created_at,updated_at"
        )
        .single()
    : await mutate
        .insert(payload)
        .select(
          "id,vendor_id,material_code,material_name_snapshot,material_type,order_spec_label,purchase_unit_weight_g,purchase_unit_name,lead_time_days,safety_stock_g,order_policy,is_primary_vendor,note,created_at,updated_at"
        )
        .single();
  if (error) return NextResponse.json({ error: "failed_to_save_vendor_item", message: error.message }, { status: 500 });
  if (data?.is_primary_vendor) {
    await clearOtherPrimaryVendors({
      admin,
      materialType: data.material_type as MaterialType,
      materialCode: data.material_code ? String(data.material_code) : null,
      materialNameSnapshot: String(data.material_name_snapshot ?? ""),
      excludeId: String(data.id ?? ""),
    });
  }
  return NextResponse.json({ ok: true, data });
}

export async function PATCH(req: NextRequest) {
  const verified = await verifyPurchasingAccess({
    authorizationHeader: req.headers.get("authorization"),
    refreshTokenHeader: req.headers.get("x-refresh-token"),
  });
  if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: verified.status });
  let body: VendorItemBody;
  try {
    body = (await req.json()) as VendorItemBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.order_spec_label != null) patch.order_spec_label = String(body.order_spec_label).trim() || null;
  if (body.purchase_unit_weight_g != null) patch.purchase_unit_weight_g = Number(body.purchase_unit_weight_g) || 0;
  if (body.purchase_unit_name != null) patch.purchase_unit_name = String(body.purchase_unit_name).trim() || null;
  if (body.lead_time_days != null) patch.lead_time_days = Number(body.lead_time_days) || 0;
  if (body.safety_stock_g != null) patch.safety_stock_g = Number(body.safety_stock_g) || 0;
  if (body.order_policy != null) patch.order_policy = body.order_policy === "on_demand" ? "on_demand" : "normal";
  if (body.is_primary_vendor != null) patch.is_primary_vendor = body.is_primary_vendor;
  if (body.note != null) patch.note = String(body.note).trim() || null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("purchase_vendor_items")
    .update(patch)
    .eq("id", id)
    .select(
      "id,vendor_id,material_code,material_name_snapshot,material_type,order_spec_label,purchase_unit_weight_g,purchase_unit_name,lead_time_days,safety_stock_g,order_policy,is_primary_vendor,note,created_at,updated_at"
    )
    .single();
  if (error) return NextResponse.json({ error: "failed_to_update_vendor_item", message: error.message }, { status: 500 });
  if (data?.is_primary_vendor) {
    await clearOtherPrimaryVendors({
      admin,
      materialType: data.material_type as MaterialType,
      materialCode: data.material_code ? String(data.material_code) : null,
      materialNameSnapshot: String(data.material_name_snapshot ?? ""),
      excludeId: String(data.id ?? ""),
    });
  }
  return NextResponse.json({ ok: true, data });
}

export async function DELETE(req: NextRequest) {
  const verified = await verifyPurchasingAccess({
    authorizationHeader: req.headers.get("authorization"),
    refreshTokenHeader: req.headers.get("x-refresh-token"),
  });
  if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: verified.status });
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });
  const admin = createAdminClient();
  const { error } = await admin.from("purchase_vendor_items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "failed_to_delete_vendor_item", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

