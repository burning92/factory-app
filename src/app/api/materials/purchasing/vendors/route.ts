import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, verifyPurchasingAccess } from "../_auth";

type VendorBody = {
  id?: string;
  vendor_name?: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  note?: string | null;
  is_active?: boolean;
};

export async function GET(req: NextRequest) {
  const verified = await verifyPurchasingAccess({
    authorizationHeader: req.headers.get("authorization"),
    refreshTokenHeader: req.headers.get("x-refresh-token"),
  });
  if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: verified.status });
  const admin = createAdminClient();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  let query = admin
    .from("purchase_vendors")
    .select("id,vendor_name,contact_name,phone,email,note,is_active,created_at,updated_at")
    .order("vendor_name", { ascending: true });
  if (q) query = query.ilike("vendor_name", `%${q}%`);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "failed_to_list_vendors", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const verified = await verifyPurchasingAccess({
    authorizationHeader: req.headers.get("authorization"),
    refreshTokenHeader: req.headers.get("x-refresh-token"),
  });
  if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: verified.status });
  let body: VendorBody;
  try {
    body = (await req.json()) as VendorBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const vendorName = String(body.vendor_name ?? "").trim();
  if (!vendorName) return NextResponse.json({ error: "vendor_name_required" }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("purchase_vendors")
    .insert({
      vendor_name: vendorName,
      contact_name: body.contact_name?.trim() || null,
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      note: body.note?.trim() || null,
      is_active: body.is_active !== false,
    })
    .select("id,vendor_name,contact_name,phone,email,note,is_active,created_at,updated_at")
    .single();
  if (error) return NextResponse.json({ error: "failed_to_create_vendor", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function PATCH(req: NextRequest) {
  const verified = await verifyPurchasingAccess({
    authorizationHeader: req.headers.get("authorization"),
    refreshTokenHeader: req.headers.get("x-refresh-token"),
  });
  if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: verified.status });
  let body: VendorBody;
  try {
    body = (await req.json()) as VendorBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (body.vendor_name != null) patch.vendor_name = String(body.vendor_name).trim();
  if (body.contact_name != null) patch.contact_name = String(body.contact_name).trim() || null;
  if (body.phone != null) patch.phone = String(body.phone).trim() || null;
  if (body.email != null) patch.email = String(body.email).trim() || null;
  if (body.note != null) patch.note = String(body.note).trim() || null;
  if (body.is_active != null) patch.is_active = body.is_active;
  patch.updated_at = new Date().toISOString();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("purchase_vendors")
    .update(patch)
    .eq("id", id)
    .select("id,vendor_name,contact_name,phone,email,note,is_active,created_at,updated_at")
    .single();
  if (error) return NextResponse.json({ error: "failed_to_update_vendor", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

