import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeActualManpower } from "@/features/production/planning/calculations";
import type { PlanningDayPayload } from "@/features/production/planning/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type Body = {
  access_token?: string;
  refresh_token?: string;
  payload?: PlanningDayPayload;
};

export async function POST(request: Request) {
  if (!serviceRoleKey) return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const accessToken = body.access_token;
  const refreshToken = body.refresh_token;
  const payload = body.payload;
  if (!accessToken || !refreshToken || !payload) {
    return NextResponse.json({ error: "access_token, refresh_token, payload 필요" }, { status: 400 });
  }

  const anon = createClient(url, anonKey);
  const {
    data: { user },
    error: sessionError,
  } = await anon.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (sessionError || !user) {
    return NextResponse.json({ error: "인증 실패" }, { status: 401 });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: me, error: meErr } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (meErr || !me || (me.role !== "admin" && me.role !== "manager")) {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  const annualFromLeaves = (payload.leaves ?? []).filter((l) => l.leave_type !== "half" && l.person_name.trim().length > 0).length;
  const halfFromLeaves = (payload.leaves ?? []).filter((l) => l.leave_type === "half" && l.person_name.trim().length > 0).length;

  const actualManpower = computeActualManpower(
    Number(payload.baseline_headcount) || 0,
    annualFromLeaves,
    halfFromLeaves,
    Number(payload.other_count) || 0
  );

  try {
    const monthId = payload.month_id;
    const planDate = payload.plan_date;
    const planYear = Number(planDate.slice(0, 4));
    const planMonth = Number(planDate.slice(5, 7));

    const { error: delEntriesErr } = await admin
      .from("production_plan_entries")
      .delete()
      .eq("month_id", monthId)
      .eq("plan_date", planDate);
    if (delEntriesErr) throw delEntriesErr;

    const { error: delNotesErr } = await admin
      .from("production_plan_notes")
      .delete()
      .eq("month_id", monthId)
      .eq("plan_date", planDate);
    if (delNotesErr) throw delNotesErr;
    const { error: delLeavesErr } = await admin
      .from("production_plan_leaves")
      .delete()
      .eq("month_id", monthId)
      .eq("plan_date", planDate);
    if (delLeavesErr) throw delLeavesErr;

    if (payload.entries.length > 0) {
      const insEntries = payload.entries
        .filter((e) => e.product_name_snapshot.trim() && Number(e.qty) > 0)
        .map((e) => ({
          month_id: monthId,
          plan_date: planDate,
          product_name_snapshot: e.product_name_snapshot.trim(),
          qty: Number(e.qty) || 0,
          sort_order: Number(e.sort_order) || 0,
        }));
      if (insEntries.length > 0) {
        const { error: insEntriesErr } = await admin.from("production_plan_entries").insert(insEntries);
        if (insEntriesErr) throw insEntriesErr;
      }
    }

    const notes = payload.notes.map((n) => n.trim()).filter(Boolean);
    if (notes.length > 0) {
      const notePayload = notes.map((note, idx) => ({
        month_id: monthId,
        plan_date: planDate,
        note_text: note,
        note_order: idx,
      }));
      const { error: insNotesErr } = await admin.from("production_plan_notes").insert(notePayload);
      if (insNotesErr) throw insNotesErr;
    }

    const leaves = (payload.leaves ?? [])
      .map((l) => ({
        leave_type: l.leave_type === "half" ? "half" : "annual",
        person_name: l.person_name.trim(),
      }))
      .filter((l) => l.person_name.length > 0);
    if (leaves.length > 0) {
      const { data: profiles } = await admin.from("profiles").select("id,display_name,login_id");
      const nameToProfileId = new Map<string, string>();
      for (const p of profiles ?? []) {
        const dn = String((p as { display_name?: string | null }).display_name ?? "").trim();
        if (dn && !nameToProfileId.has(dn)) nameToProfileId.set(dn, String((p as { id: string }).id));
        const lid = String((p as { login_id?: string | null }).login_id ?? "").trim();
        if (lid && !nameToProfileId.has(lid)) nameToProfileId.set(lid, String((p as { id: string }).id));
      }
      const leavePayload = leaves.map((l) => ({
        month_id: monthId,
        plan_date: planDate,
        leave_type: l.leave_type,
        person_name: l.person_name,
        profile_id: nameToProfileId.get(l.person_name) ?? null,
      }));
      const { error: insLeavesErr } = await admin.from("production_plan_leaves").insert(leavePayload);
      if (insLeavesErr) throw insLeavesErr;

      const { error: delLeaveDeductionErr } = await admin
        .from("leave_deductions")
        .delete()
        .eq("usage_date", planDate)
        .eq("source", "planning_board");
      if (delLeaveDeductionErr) throw delLeaveDeductionErr;
      const leaveDeductionRows = leavePayload
        .filter((l) => l.profile_id)
        .map((l) => ({
          profile_id: l.profile_id,
          year: Number(planDate.slice(0, 4)),
          usage_date: planDate,
          days: l.leave_type === "half" ? 0.5 : 1,
          memo: `생산계획 보드 자동 (${l.leave_type === "half" ? "반차" : "연차"})`,
          created_by: null as string | null,
          source: "planning_board" as const,
        }));
      if (leaveDeductionRows.length > 0) {
        const { error: insDeductionErr } = await admin.from("leave_deductions").insert(leaveDeductionRows);
        if (insDeductionErr) throw insDeductionErr;
      }
    } else {
      const { error: delLeaveDeductionErr } = await admin
        .from("leave_deductions")
        .delete()
        .eq("usage_date", planDate)
        .eq("source", "planning_board");
      if (delLeaveDeductionErr) throw delLeaveDeductionErr;
    }

    const { error: manpowerErr } = await admin.from("production_plan_manpower").upsert(
      {
        month_id: monthId,
        plan_date: planDate,
        annual_leave_count: annualFromLeaves,
        half_day_count: halfFromLeaves,
        other_count: Number(payload.other_count) || 0,
        actual_manpower: actualManpower,
      },
      { onConflict: "month_id,plan_date" }
    );
    if (manpowerErr) throw manpowerErr;

    // planning 입력값을 기존 조회용 production_plan_rows에도 반영 (뷰 전용 화면 유지)
    const { error: delMirrorErr } = await admin
      .from("production_plan_rows")
      .delete()
      .eq("plan_date", planDate)
      .eq("plan_version", "master")
      .eq("source_sheet_name", "planning_board");
    if (delMirrorErr) throw delMirrorErr;

    const mirrorRows: Array<{
      plan_date: string;
      product_name: string;
      qty: number | null;
      category: string | null;
      note: string | null;
      plan_year: number;
      plan_month: number;
      plan_version: "master";
      source_sheet_name: string;
      sort_order: number;
      updated_at: string;
    }> = [];
    let sort = 0;

    for (const e of payload.entries ?? []) {
      const productName = String(e.product_name_snapshot ?? "").trim();
      const qty = Number(e.qty) || 0;
      if (!productName || qty <= 0) continue;
      mirrorRows.push({
        plan_date: planDate,
        product_name: productName,
        qty,
        category: "생산",
        note: null,
        plan_year: planYear,
        plan_month: planMonth,
        plan_version: "master",
        source_sheet_name: "planning_board",
        sort_order: sort++,
        updated_at: new Date().toISOString(),
      });
    }

    for (const n of payload.notes ?? []) {
      const note = String(n ?? "").trim();
      if (!note) continue;
      mirrorRows.push({
        plan_date: planDate,
        product_name: "메모",
        qty: null,
        category: "메모",
        note,
        plan_year: planYear,
        plan_month: planMonth,
        plan_version: "master",
        source_sheet_name: "planning_board",
        sort_order: sort++,
        updated_at: new Date().toISOString(),
      });
    }

    for (const l of leaves) {
      mirrorRows.push({
        plan_date: planDate,
        product_name: l.person_name,
        qty: null,
        category: l.leave_type === "half" ? "반차" : "연차",
        note: null,
        plan_year: planYear,
        plan_month: planMonth,
        plan_version: "master",
        source_sheet_name: "planning_board",
        sort_order: sort++,
        updated_at: new Date().toISOString(),
      });
    }

    if (mirrorRows.length > 0) {
      const { error: insMirrorErr } = await admin.from("production_plan_rows").insert(mirrorRows);
      if (insMirrorErr) throw insMirrorErr;
    }

    return NextResponse.json({ ok: true, actualManpower });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "save_failed", message }, { status: 500 });
  }
}
