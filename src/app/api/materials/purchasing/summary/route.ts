import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPlanningMonthData } from "@/features/production/planning/getPlanningMonthData";
import { ymd } from "@/features/production/planning/calculations";
import type { PlanningVersionType } from "@/features/production/planning/types";
import type { PurchasingMaterialMasterRow, PurchasingSummaryData, PurchasingVendorItemRow } from "@/features/materials/purchasing/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type PeriodKey = "d7" | "d14" | "d30" | "month_end" | "month_next";

function toVersion(v: string | null): PlanningVersionType {
  if (v === "draft") return "draft";
  if (v === "end") return "end";
  return "master";
}

function resolvePeriod(raw: string | null): PeriodKey {
  if (raw === "d7" || raw === "d14" || raw === "d30" || raw === "month_end" || raw === "month_next") return raw;
  return "month_next";
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function periodRange(today: Date, period: PeriodKey): { start: string; end: string } {
  const start = ymd(today.getFullYear(), today.getMonth() + 1, today.getDate());
  if (period === "d7") return { start, end: ymd(addDays(today, 7).getFullYear(), addDays(today, 7).getMonth() + 1, addDays(today, 7).getDate()) };
  if (period === "d14") return { start, end: ymd(addDays(today, 14).getFullYear(), addDays(today, 14).getMonth() + 1, addDays(today, 14).getDate()) };
  if (period === "d30") return { start, end: ymd(addDays(today, 30).getFullYear(), addDays(today, 30).getMonth() + 1, addDays(today, 30).getDate()) };
  if (period === "month_end") {
    return { start, end: ymd(today.getFullYear(), today.getMonth() + 1, new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()) };
  }
  return { start, end: ymd(today.getFullYear(), today.getMonth() + 2, new Date(today.getFullYear(), today.getMonth() + 2, 0).getDate()) };
}

function uniqueBy<T>(arr: T[], keyFn: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of arr) map.set(keyFn(item), item);
  return Array.from(map.values());
}

export async function GET(req: NextRequest) {
  if (!serviceRoleKey) return NextResponse.json({ error: "server_config_error" }, { status: 500 });
  const authHeader = req.headers.get("authorization") ?? "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const refreshToken = (req.headers.get("x-refresh-token") ?? "").trim();
  if (!accessToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const anon = createClient(url, anonKey);
  const {
    data: { user: userFromAccess },
    error: userErr,
  } = await anon.auth.getUser(accessToken);
  let user = userFromAccess ?? null;
  if (!user && refreshToken) {
    const {
      data: { user: userFromSession },
      error: sessionError,
    } = await anon.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (!sessionError) user = userFromSession ?? null;
  }
  if (userErr || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: me, error: meErr } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (meErr || !me || (me.role !== "admin" && me.role !== "manager" && me.role !== "headquarters")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const period = resolvePeriod(sp.get("period"));
  const version = toVersion(sp.get("version"));
  const today = new Date();
  const todayIso = ymd(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const { start, end } = periodRange(today, period);

  try {
    const monthTargets: Array<{ year: number; month: number }> = [];
    const cursor = new Date(`${start}T00:00:00`);
    const endDate = new Date(`${end}T00:00:00`);
    while (cursor <= endDate) {
      const target = { year: cursor.getFullYear(), month: cursor.getMonth() + 1 };
      if (!monthTargets.some((m) => m.year === target.year && m.month === target.month)) monthTargets.push(target);
      cursor.setMonth(cursor.getMonth() + 1, 1);
    }
    if (monthTargets.length === 0) {
      monthTargets.push({ year: today.getFullYear(), month: today.getMonth() + 1 });
    }

    const planningMonths = await Promise.all(monthTargets.map((m) => getPlanningMonthData(m.year, m.month, version)));
    const mergedEntries = planningMonths.flatMap((m) => m.entries);
    const mergedBom = uniqueBy(
      planningMonths.flatMap((m) => m.bomRows),
      (r) => `${r.product_name}__${r.material_name}`
    );
    const mergedSub = uniqueBy(
      planningMonths.flatMap((m) => m.submaterialRows),
      (r) => `${r.id}__${r.product_name_snapshot}__${r.material_name}`
    );
    const mergedInventory = uniqueBy(
      planningMonths.flatMap((m) => m.inventoryRows),
      (r) => r.item_code
    );

    const { data: materials, error: materialsErr } = await admin
      .from("materials")
      .select("material_name,inventory_item_code");
    if (materialsErr) throw materialsErr;
    const { data: submaterialItems, error: submaterialItemsErr } = await admin
      .from("planning_submaterial_items")
      .select("submaterial_name,inventory_item_code")
      .eq("active", true);
    if (submaterialItemsErr) throw submaterialItemsErr;
    const { data: vendorItems, error: vendorItemsErr } = await admin
      .from("purchase_vendor_items")
      .select(
        "id,vendor_id,material_code,material_name_snapshot,material_type,order_spec_label,purchase_unit_weight_g,purchase_unit_name,lead_time_days,safety_stock_g,order_policy,is_primary_vendor,note,purchase_vendors(vendor_name,is_active)"
      );
    if (vendorItemsErr) throw vendorItemsErr;

    const materialMasterRows = ((materials ?? []) as Record<string, unknown>[]).map((r) => ({
      material_name: String(r.material_name ?? ""),
      inventory_item_code: r.inventory_item_code != null ? String(r.inventory_item_code) : null,
      material_type: "raw_material",
    })) as PurchasingMaterialMasterRow[];
    const submaterialMapRows = ((submaterialItems ?? []) as Record<string, unknown>[]).map((r) => ({
      material_name: String(r.submaterial_name ?? ""),
      inventory_item_code: r.inventory_item_code != null ? String(r.inventory_item_code) : null,
      material_type: "submaterial",
    })) as PurchasingMaterialMasterRow[];
    const vendorItemRows = ((vendorItems ?? []) as Record<string, unknown>[]).map((r) => {
      const vendorRel = r.purchase_vendors as { vendor_name?: unknown; is_active?: unknown } | Array<{ vendor_name?: unknown; is_active?: unknown }> | null;
      const vendorObj = Array.isArray(vendorRel) ? vendorRel[0] : vendorRel;
      return {
        id: String(r.id ?? ""),
        vendor_id: String(r.vendor_id ?? ""),
        vendor_name: String(vendorObj?.vendor_name ?? "미지정"),
        material_code: r.material_code != null ? String(r.material_code) : null,
        material_name_snapshot: String(r.material_name_snapshot ?? ""),
        material_type: String(r.material_type) === "submaterial" ? "submaterial" : "raw_material",
        order_spec_label: r.order_spec_label != null ? String(r.order_spec_label) : null,
        purchase_unit_weight_g: Number(r.purchase_unit_weight_g) || 0,
        purchase_unit_name: r.purchase_unit_name != null ? String(r.purchase_unit_name) : null,
        lead_time_days: Number(r.lead_time_days) || 0,
        safety_stock_g: Number(r.safety_stock_g) || 0,
        order_policy: String(r.order_policy) === "on_demand" ? "on_demand" : "normal",
        is_primary_vendor: r.is_primary_vendor === true,
        note: r.note != null ? String(r.note) : null,
      } as PurchasingVendorItemRow;
    });

    const data: PurchasingSummaryData = {
      today_iso: todayIso,
      range_start: start,
      range_end: end,
      entries: mergedEntries,
      bomRows: mergedBom,
      submaterialRows: mergedSub,
      inventoryRows: mergedInventory,
      materialRows: [...materialMasterRows, ...submaterialMapRows],
      vendorItemRows: vendorItemRows.filter((r) => r.vendor_name.trim().length > 0),
    };

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "failed_to_load_purchasing_summary", message }, { status: 500 });
  }
}

