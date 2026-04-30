import { getSupabaseAdmin } from "@/lib/supabaseServer";
import {
  organizationCodeFromProfileRow,
  profileCountsTowardFieldHeadcount,
} from "@/lib/profileFieldHeadcount";
import type {
  PlanningBomRow,
  PlanningEntryRow,
  PlanningInventoryRow,
  PlanningLeaveRow,
  PlanningManpowerRow,
  PlanningMaterialRow,
  PlanningMonthData,
  PlanningMonthRow,
  PlanningNoteRow,
  PlanningRangeEntryRow,
  PlanningSubmaterialRow,
  PlanningVersionType,
} from "./types";

function normalizeMonth(row: Record<string, unknown>): PlanningMonthRow {
  return {
    id: String(row.id),
    plan_year: Number(row.plan_year),
    plan_month: Number(row.plan_month),
    version_type: String(row.version_type) as PlanningVersionType,
    title: row.title != null ? String(row.title) : null,
    status: String(row.status ?? "open") as "open" | "closed",
    source_note: row.source_note != null ? String(row.source_note) : null,
    baseline_headcount: Number(row.baseline_headcount ?? 25) || 25,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

async function ensureMonth(year: number, month: number, version: PlanningVersionType): Promise<PlanningMonthRow> {
  const supabase = getSupabaseAdmin();
  const { data: found, error: findErr } = await supabase
    .from("production_plan_months")
    .select("*")
    .eq("plan_year", year)
    .eq("plan_month", month)
    .eq("version_type", version)
    .maybeSingle();
  if (findErr) throw findErr;
  if (found) return normalizeMonth(found as unknown as Record<string, unknown>);

  const { data: inserted, error: insErr } = await supabase
    .from("production_plan_months")
    .insert({
      plan_year: year,
      plan_month: month,
      version_type: version,
      status: "open",
      baseline_headcount: 25,
      title: `${year}년 ${month}월 계획`,
    })
    .select("*")
    .single();
  if (insErr) throw insErr;
  return normalizeMonth(inserted as unknown as Record<string, unknown>);
}

export async function getPlanningMonthData(year: number, month: number, version: PlanningVersionType): Promise<PlanningMonthData> {
  const supabase = getSupabaseAdmin();
  const monthRow = await ensureMonth(year, month, version);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;

  const [entriesRes, notesRes, manpowerRes, leavesRes, rangeEntriesRes, monthsRes, bomRes, submaterialsRes, materialsRes, submaterialItemsRes, inventoryRes, profilesRes] =
    await Promise.all([
    supabase
      .from("production_plan_entries")
      .select("id,month_id,plan_date,product_name_snapshot,qty,sort_order")
      .eq("month_id", monthRow.id)
      .order("plan_date", { ascending: true })
      .order("sort_order", { ascending: true }),
    supabase
      .from("production_plan_notes")
      .select("id,month_id,plan_date,note_text,note_order")
      .eq("month_id", monthRow.id)
      .order("plan_date", { ascending: true })
      .order("note_order", { ascending: true }),
    supabase
      .from("production_plan_manpower")
      .select("id,month_id,plan_date,annual_leave_count,half_day_count,other_count,actual_manpower")
      .eq("month_id", monthRow.id),
      supabase
      .from("production_plan_leaves")
      .select("id,month_id,plan_date,leave_type,person_name,profile_id")
      .eq("month_id", monthRow.id)
      .order("plan_date", { ascending: true })
      .order("id", { ascending: true }),
      supabase
        .from("planning_range_entries")
        .select("id,person_name,entry_type,reason,start_date,end_date,apply_mode,created_by,created_at,updated_at")
        .gte("end_date", monthStart)
        .lte("start_date", monthEnd)
        .order("created_at", { ascending: false }),
    supabase
      .from("production_plan_months")
      .select("version_type")
      .eq("plan_year", year)
      .eq("plan_month", month),
    supabase.from("bom").select("product_name,material_name,bom_g_per_ea"),
    supabase.from("planning_submaterials").select("id,product_name_snapshot,material_name,qty_g_per_ea,active").eq("active", true),
    supabase.from("materials").select("material_name,inventory_item_code"),
    supabase.from("planning_submaterial_items").select("submaterial_name,inventory_item_code").eq("active", true),
    supabase
      .from("ecount_inventory_current")
      .select("item_code,qty,box_weight_g,unit_weight_g")
      .not("item_code", "is", null),
    supabase
      .from("profiles")
      .select("id,display_name,login_id,role,is_active,organizations(organization_code)")
      .eq("is_active", true),
  ]);
  if (leavesRes.error) throw leavesRes.error;

  if (entriesRes.error) throw entriesRes.error;
  if (notesRes.error) throw notesRes.error;
  if (manpowerRes.error) throw manpowerRes.error;
  if (rangeEntriesRes.error) throw rangeEntriesRes.error;
  if (monthsRes.error) throw monthsRes.error;
  if (bomRes.error) throw bomRes.error;
  if (submaterialsRes.error) throw submaterialsRes.error;
  if (materialsRes.error) throw materialsRes.error;
  if (submaterialItemsRes.error) throw submaterialItemsRes.error;
  if (inventoryRes.error) throw inventoryRes.error;
  if (profilesRes.error) throw profilesRes.error;

  const entries = ((entriesRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    month_id: String(r.month_id),
    plan_date: String(r.plan_date).slice(0, 10),
    product_name_snapshot: String(r.product_name_snapshot ?? ""),
    qty: Number(r.qty) || 0,
    sort_order: Number(r.sort_order) || 0,
  })) as PlanningEntryRow[];

  const notes = ((notesRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    month_id: String(r.month_id),
    plan_date: String(r.plan_date).slice(0, 10),
    note_text: String(r.note_text ?? ""),
    note_order: Number(r.note_order) || 0,
  })) as PlanningNoteRow[];

  const manpower = ((manpowerRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    month_id: String(r.month_id),
    plan_date: String(r.plan_date).slice(0, 10),
    annual_leave_count: Number(r.annual_leave_count) || 0,
    half_day_count: Number(r.half_day_count) || 0,
    other_count: Number(r.other_count) || 0,
    actual_manpower: r.actual_manpower == null ? null : Number(r.actual_manpower),
  })) as PlanningManpowerRow[];
  const leaves = ((leavesRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    month_id: String(r.month_id),
    plan_date: String(r.plan_date).slice(0, 10),
    leave_type: String(r.leave_type) === "half" ? "half" : "annual",
    person_name: String(r.person_name ?? ""),
    profile_id: r.profile_id != null ? String(r.profile_id) : null,
  })) as PlanningLeaveRow[];
  const rangeEntries = ((rangeEntriesRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id ?? ""),
    person_name: String(r.person_name ?? ""),
    entry_type: String(r.entry_type) === "half" ? "half" : String(r.entry_type) === "other" ? "other" : "annual",
    reason: r.reason != null ? String(r.reason) : null,
    start_date: String(r.start_date).slice(0, 10),
    end_date: String(r.end_date).slice(0, 10),
    apply_mode: String(r.apply_mode) === "weekdays_only" ? "weekdays_only" : "all_days",
    created_by: r.created_by != null ? String(r.created_by) : null,
    created_at: String(r.created_at ?? ""),
    updated_at: String(r.updated_at ?? ""),
  })) as PlanningRangeEntryRow[];

  const bomRows = ((bomRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    product_name: String(r.product_name ?? ""),
    material_name: String(r.material_name ?? ""),
    bom_g_per_ea: Number(r.bom_g_per_ea) || 0,
  })) as PlanningBomRow[];

  const submaterialRows = ((submaterialsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id ?? ""),
    product_name_snapshot: String(r.product_name_snapshot ?? ""),
    material_name: String(r.material_name ?? ""),
    qty_g_per_ea: Number(r.qty_g_per_ea) || 0,
    active: r.active !== false,
  })) as PlanningSubmaterialRow[];

  const materialRows = ((materialsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    material_name: String(r.material_name ?? ""),
    inventory_item_code: r.inventory_item_code != null ? String(r.inventory_item_code) : null,
  })) as PlanningMaterialRow[];
  const submaterialMasterRows = ((submaterialItemsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    material_name: String(r.submaterial_name ?? ""),
    inventory_item_code: r.inventory_item_code != null ? String(r.inventory_item_code) : null,
  })) as PlanningMaterialRow[];

  const inventoryRows = ((inventoryRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    item_code: String(r.item_code ?? ""),
    qty: Number(r.qty) || 0,
    box_weight_g: Number(r.box_weight_g) || 0,
    unit_weight_g: Number(r.unit_weight_g) || 0,
  })) as PlanningInventoryRow[];

  const products = Array.from(new Set(bomRows.map((r) => r.product_name).filter((s) => s.trim().length > 0))).sort((a, b) =>
    a.localeCompare(b)
  );
  const versions = Array.from(
    new Set((monthsRes.data ?? []).map((r) => String((r as { version_type?: string }).version_type ?? "master")))
  ).filter((v): v is PlanningVersionType => v === "master" || v === "draft" || v === "end");

  const profileRows = (profilesRes.data ?? []) as Array<{
    id: string;
    display_name: string | null;
    login_id: string | null;
    role?: string | null;
    is_active?: boolean | null;
    organizations?: { organization_code?: string | null } | { organization_code?: string | null }[] | null;
  }>;

  const fieldHeadcountProfiles = profileRows.filter((p) =>
    profileCountsTowardFieldHeadcount({
      isActive: p.is_active !== false,
      role: p.role,
      organizationCode: organizationCodeFromProfileRow(p.organizations),
      loginId: p.login_id,
    })
  );

  const people = fieldHeadcountProfiles
    .map((p) => ({
      id: p.id,
      name: (p.display_name ?? "").trim() || (p.login_id ?? "").trim(),
    }))
    .filter((p) => p.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    month: monthRow,
    entries,
    notes,
    manpower,
    leaves,
    rangeEntries,
    products,
    people,
    versions: versions.length > 0 ? versions : [version],
    materialRows: [...materialRows, ...submaterialMasterRows],
    bomRows,
    submaterialRows,
    inventoryRows,
    totalMembers: fieldHeadcountProfiles.length,
  };
}
