import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeActualManpower } from "@/features/production/planning/calculations";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OTHER_NOTE_PREFIX = "[기타]";
type AdminClient = any;

type RangeEntryType = "annual" | "half" | "other";
type ApplyMode = "all_days" | "weekdays_only";
type ConflictStrategy = "overwrite" | "skip";

type RangePayload = {
  person_name: string;
  entry_type: RangeEntryType;
  reason?: string;
  start_date: string;
  end_date: string;
  apply_mode: ApplyMode;
  conflict_strategy?: ConflictStrategy;
};

type Body = {
  access_token?: string;
  refresh_token?: string;
  payload?: RangePayload;
};

function encodeOtherAsNote(detail: string, personName: string): string {
  return `${OTHER_NOTE_PREFIX}${detail.trim()} : ${personName.trim()}`;
}

function parseOtherNoteText(noteText: string): { detail: string; person_name: string } | null {
  const t = noteText.trim();
  if (!t.startsWith(OTHER_NOTE_PREFIX)) return null;
  const body = t.slice(OTHER_NOTE_PREFIX.length).trim();
  const idx = body.lastIndexOf(" : ");
  if (idx <= 0) return null;
  const detail = body.slice(0, idx).trim();
  const person_name = body.slice(idx + 3).trim();
  if (!detail || !person_name) return null;
  return { detail, person_name };
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function enumerateDates(startDate: string, endDate: string, applyMode: ApplyMode): string[] {
  const dates: string[] = [];
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (applyMode === "weekdays_only" && (day === 0 || day === 6)) continue;
    dates.push(ymd(d));
  }
  return dates;
}

async function assertAuthorized(accessToken: string, refreshToken: string) {
  const anon = createClient(url, anonKey);
  const {
    data: { user },
    error: sessionError,
  } = await anon.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (sessionError || !user) throw new Error("인증 실패");

  const admin = createClient(url, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: me, error: meErr } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (meErr || !me || (me.role !== "admin" && me.role !== "manager" && me.role !== "headquarters")) {
    throw new Error("권한 없음");
  }
  return { admin: admin as AdminClient, userId: user.id };
}

async function ensureMonthId(admin: AdminClient, year: number, month: number): Promise<string> {
  const { data: found, error: findErr } = await admin
    .from("production_plan_months")
    .select("id")
    .eq("plan_year", year)
    .eq("plan_month", month)
    .eq("version_type", "master")
    .maybeSingle();
  if (findErr) throw findErr;
  const foundId = (found as { id?: string } | null)?.id;
  if (foundId) return String(foundId);
  const { data: inserted, error: insErr } = await admin
    .from("production_plan_months")
    .insert({
      plan_year: year,
      plan_month: month,
      version_type: "master",
      status: "open",
      baseline_headcount: 25,
      title: `${year}년 ${month}월 계획`,
    })
    .select("id")
    .single();
  const insertedId = (inserted as { id?: string } | null)?.id;
  if (insErr || !insertedId) throw insErr ?? new Error("month 생성 실패");
  return String(insertedId);
}

async function rebuildDayDerived(admin: AdminClient, planDate: string, monthId: string) {
  const { data: monthRow, error: monthErr } = await admin.from("production_plan_months").select("baseline_headcount").eq("id", monthId).single();
  if (monthErr) throw monthErr;
  const baseline = Number(monthRow.baseline_headcount ?? 25) || 25;

  const [{ data: leaves }, { data: notes }, { data: entries }, { data: profiles }] = await Promise.all([
    admin.from("production_plan_leaves").select("leave_type,person_name").eq("month_id", monthId).eq("plan_date", planDate),
    admin.from("production_plan_notes").select("note_text,note_order").eq("month_id", monthId).eq("plan_date", planDate).order("note_order", { ascending: true }),
    admin
      .from("production_plan_entries")
      .select("product_name_snapshot,qty,sort_order")
      .eq("month_id", monthId)
      .eq("plan_date", planDate)
      .order("sort_order", { ascending: true }),
    admin.from("profiles").select("id,display_name,login_id"),
  ]);

  const leaveRows = (leaves ?? []) as Array<{ leave_type: string; person_name: string }>;
  const noteRows = (notes ?? []) as Array<{ note_text: string }>;
  const entryRows = (entries ?? []) as Array<{ product_name_snapshot: string; qty: number }>;
  const profileRows = (profiles ?? []) as Array<{ id: string; display_name?: string | null; login_id?: string | null }>;
  const annualCount = leaveRows.filter((l: { leave_type: string }) => l.leave_type !== "half").length;
  const halfCount = leaveRows.filter((l: { leave_type: string }) => l.leave_type === "half").length;
  const otherCount = noteRows.filter((n: { note_text: string }) => parseOtherNoteText(String(n.note_text ?? ""))).length;
  const actualManpower = computeActualManpower(baseline, annualCount, halfCount, otherCount);

  const { error: upsertManpowerErr } = await admin.from("production_plan_manpower").upsert(
    {
      month_id: monthId,
      plan_date: planDate,
      annual_leave_count: annualCount,
      half_day_count: halfCount,
      other_count: otherCount,
      actual_manpower: actualManpower,
    },
    { onConflict: "month_id,plan_date" }
  );
  if (upsertManpowerErr) throw upsertManpowerErr;

  const nameToProfileId = new Map<string, string>();
  for (const p of profileRows) {
    const dn = String(p.display_name ?? "").trim();
    const lid = String(p.login_id ?? "").trim();
    const id = String(p.id);
    if (dn && !nameToProfileId.has(dn)) nameToProfileId.set(dn, id);
    if (lid && !nameToProfileId.has(lid)) nameToProfileId.set(lid, id);
  }

  const { error: delDeductionErr } = await admin.from("leave_deductions").delete().eq("usage_date", planDate).eq("source", "planning_board");
  if (delDeductionErr) throw delDeductionErr;
  const deductionRows = leaveRows
    .map((l) => ({
      profile_id: nameToProfileId.get(String(l.person_name ?? "")) ?? null,
      year: Number(planDate.slice(0, 4)),
      usage_date: planDate,
      days: l.leave_type === "half" ? 0.5 : 1,
      memo: `생산계획 보드 자동 (${l.leave_type === "half" ? "반차" : "연차"})`,
      created_by: null as string | null,
      source: "planning_board" as const,
    }))
    .filter((r) => Boolean(r.profile_id));
  if (deductionRows.length > 0) {
    const { error: insDeductionErr } = await admin.from("leave_deductions").insert(deductionRows);
    if (insDeductionErr) throw insDeductionErr;
  }

  const { error: delMirrorErr } = await admin
    .from("production_plan_rows")
    .delete()
    .eq("plan_date", planDate)
    .eq("plan_version", "master")
    .eq("source_sheet_name", "planning_board");
  if (delMirrorErr) throw delMirrorErr;

  const planYear = Number(planDate.slice(0, 4));
  const planMonth = Number(planDate.slice(5, 7));
  const mirrorRows: Array<Record<string, unknown>> = [];
  let sort = 0;
  for (const e of entryRows) {
    mirrorRows.push({
      plan_date: planDate,
      product_name: String(e.product_name_snapshot ?? ""),
      qty: Number(e.qty) || 0,
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
  for (const n of noteRows) {
    const text = String(n.note_text ?? "").trim();
    if (!text) continue;
    mirrorRows.push({
      plan_date: planDate,
      product_name: "메모",
      qty: null,
      category: "메모",
      note: text,
      plan_year: planYear,
      plan_month: planMonth,
      plan_version: "master",
      source_sheet_name: "planning_board",
      sort_order: sort++,
      updated_at: new Date().toISOString(),
    });
  }
  for (const l of leaveRows) {
    mirrorRows.push({
      plan_date: planDate,
      product_name: String(l.person_name ?? ""),
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
}

export async function POST(request: Request) {
  if (!serviceRoleKey) return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  const accessToken = String(body.access_token ?? "").trim();
  const refreshToken = String(body.refresh_token ?? "").trim();
  const payload = body.payload;
  if (!accessToken || !refreshToken || !payload) {
    return NextResponse.json({ error: "access_token, refresh_token, payload 필요" }, { status: 400 });
  }

  const personName = String(payload.person_name ?? "").trim();
  const entryType: RangeEntryType = payload.entry_type === "half" ? "half" : payload.entry_type === "other" ? "other" : "annual";
  const reason = String(payload.reason ?? "").trim();
  const startDate = String(payload.start_date ?? "").trim();
  const endDate = String(payload.end_date ?? "").trim();
  const applyMode: ApplyMode = payload.apply_mode === "weekdays_only" ? "weekdays_only" : "all_days";
  const conflictStrategy = payload.conflict_strategy;

  if (!personName || !startDate || !endDate) {
    return NextResponse.json({ error: "이름/시작일/종료일은 필수입니다." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (endDate < startDate) {
    return NextResponse.json({ error: "종료일이 시작일보다 빠를 수 없습니다." }, { status: 400 });
  }
  if (entryType === "other" && !reason) {
    return NextResponse.json({ error: "기타 유형은 사유를 입력해 주세요." }, { status: 400 });
  }

  try {
    const { admin, userId } = await assertAuthorized(accessToken, refreshToken);
    const targetDates = enumerateDates(startDate, endDate, applyMode);
    if (targetDates.length === 0) {
      return NextResponse.json({ error: "적용 대상 날짜가 없습니다." }, { status: 400 });
    }

    const monthIdByYm = new Map<string, string>();
    for (const d of targetDates) {
      const ym = d.slice(0, 7);
      if (!monthIdByYm.has(ym)) {
        const id = await ensureMonthId(admin, Number(d.slice(0, 4)), Number(d.slice(5, 7)));
        monthIdByYm.set(ym, id);
      }
    }

    const conflicts: string[] = [];
    const noteLike = `% : ${personName}`;
    for (const d of targetDates) {
      const monthId = monthIdByYm.get(d.slice(0, 7))!;
      if (entryType === "annual" || entryType === "half") {
        const { data: existingLeaves, error: leaveErr } = await admin
          .from("production_plan_leaves")
          .select("id")
          .eq("month_id", monthId)
          .eq("plan_date", d)
          .eq("person_name", personName)
          .limit(1);
        if (leaveErr) throw leaveErr;
        if ((existingLeaves ?? []).length > 0) conflicts.push(d);
      } else {
        const { data: existingNotes, error: noteErr } = await admin
          .from("production_plan_notes")
          .select("id,note_text")
          .eq("month_id", monthId)
          .eq("plan_date", d)
          .ilike("note_text", `[기타]${noteLike}`);
        if (noteErr) throw noteErr;
        if ((existingNotes ?? []).length > 0) conflicts.push(d);
      }
    }

    if (conflicts.length > 0 && !conflictStrategy) {
      return NextResponse.json(
        {
          ok: false,
          needs_confirmation: true,
          conflict_count: conflicts.length,
          conflict_dates: conflicts,
          candidate_count: targetDates.length,
        },
        { status: 409 }
      );
    }

    const conflictSet = new Set(conflicts);
    const applyDates = conflictStrategy === "skip" ? targetDates.filter((d) => !conflictSet.has(d)) : targetDates;
    if (applyDates.length === 0) {
      return NextResponse.json({ ok: true, applied_count: 0, skipped_count: targetDates.length, conflict_count: conflicts.length });
    }

    if (conflictStrategy === "overwrite") {
      for (const d of applyDates) {
        if (!conflictSet.has(d)) continue;
        const monthId = monthIdByYm.get(d.slice(0, 7))!;
        if (entryType === "annual" || entryType === "half") {
          const { error: delLeaveErr } = await admin
            .from("production_plan_leaves")
            .delete()
            .eq("month_id", monthId)
            .eq("plan_date", d)
            .eq("person_name", personName);
          if (delLeaveErr) throw delLeaveErr;
        } else {
          const { data: rows, error: readErr } = await admin
            .from("production_plan_notes")
            .select("id,note_text")
            .eq("month_id", monthId)
            .eq("plan_date", d);
          if (readErr) throw readErr;
          const ids = ((rows ?? []) as Array<{ id: number; note_text: string }>)
            .filter((r: { note_text: string }) => parseOtherNoteText(String(r.note_text ?? ""))?.person_name === personName)
            .map((r: { id: number }) => Number(r.id));
          if (ids.length > 0) {
            const { error: delNoteErr } = await admin.from("production_plan_notes").delete().in("id", ids);
            if (delNoteErr) throw delNoteErr;
          }
        }
      }
    }

    if (entryType === "annual" || entryType === "half") {
      const { data: profiles } = await admin.from("profiles").select("id,display_name,login_id");
      const profileRows = (profiles ?? []) as Array<{ id: string; display_name?: string | null; login_id?: string | null }>;
      const profileId =
        profileRows.find((p: { display_name?: string | null }) => String(p.display_name ?? "").trim() === personName)?.id ??
        profileRows.find((p: { login_id?: string | null }) => String(p.login_id ?? "").trim() === personName)?.id ??
        null;
      const leaveRows = applyDates.map((d) => ({
        month_id: monthIdByYm.get(d.slice(0, 7))!,
        plan_date: d,
        leave_type: entryType,
        person_name: personName,
        profile_id: profileId,
      }));
      const { error: insLeaveErr } = await admin.from("production_plan_leaves").insert(leaveRows);
      if (insLeaveErr) throw insLeaveErr;
    } else {
      for (const d of applyDates) {
        const monthId = monthIdByYm.get(d.slice(0, 7))!;
        const { data: lastNote, error: orderErr } = await admin
          .from("production_plan_notes")
          .select("note_order")
          .eq("month_id", monthId)
          .eq("plan_date", d)
          .order("note_order", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (orderErr) throw orderErr;
        const nextOrder = Number(lastNote?.note_order ?? -1) + 1;
        const { error: insNoteErr } = await admin.from("production_plan_notes").insert({
          month_id: monthId,
          plan_date: d,
          note_text: encodeOtherAsNote(reason, personName),
          note_order: nextOrder,
        });
        if (insNoteErr) throw insNoteErr;
      }
    }

    const { data: rangeInserted, error: rangeErr } = await admin
      .from("planning_range_entries")
      .insert({
        person_name: personName,
        entry_type: entryType,
        reason: reason || null,
        start_date: startDate,
        end_date: endDate,
        apply_mode: applyMode,
        created_by: userId,
      })
      .select("id")
      .single();
    if (rangeErr) throw rangeErr;

    for (const d of Array.from(new Set(applyDates))) {
      const monthId = monthIdByYm.get(d.slice(0, 7))!;
      await rebuildDayDerived(admin, d, monthId);
    }

    return NextResponse.json({
      ok: true,
      range_entry_id: rangeInserted?.id ?? null,
      applied_count: applyDates.length,
      skipped_count: targetDates.length - applyDates.length,
      conflict_count: conflicts.length,
      conflict_dates: conflicts,
      target_count: targetDates.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "range_save_failed", message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!serviceRoleKey) return NextResponse.json({ error: "서버 설정 오류" }, { status: 500 });
  const u = new URL(request.url);
  const id = String(u.searchParams.get("id") ?? "").trim();
  const accessToken = String(u.searchParams.get("access_token") ?? "").trim();
  const refreshToken = String(u.searchParams.get("refresh_token") ?? "").trim();
  if (!id || !accessToken || !refreshToken) {
    return NextResponse.json({ error: "id/access_token/refresh_token 필요" }, { status: 400 });
  }
  try {
    const { admin } = await assertAuthorized(accessToken, refreshToken);
    const { error } = await admin.from("planning_range_entries").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "range_delete_failed", message }, { status: 500 });
  }
}
