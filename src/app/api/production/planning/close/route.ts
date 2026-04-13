import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type Body = {
  access_token?: string;
  refresh_token?: string;
  year?: number;
  month?: number;
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
  const year = Number(body.year);
  const month = Number(body.month);
  if (!accessToken || !refreshToken || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "access_token, refresh_token, year, month 필요" }, { status: 400 });
  }

  const anon = createClient(url, anonKey);
  const {
    data: { user },
    error: sessionError,
  } = await anon.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (sessionError || !user) return NextResponse.json({ error: "인증 실패" }, { status: 401 });

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: me, error: meErr } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (meErr || !me || (me.role !== "admin" && me.role !== "manager")) {
    return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  }

  try {
    const { data: master, error: masterErr } = await admin
      .from("production_plan_months")
      .select("*")
      .eq("plan_year", year)
      .eq("plan_month", month)
      .eq("version_type", "master")
      .maybeSingle();
    if (masterErr) throw masterErr;
    if (!master) return NextResponse.json({ error: "master_month_not_found" }, { status: 404 });

    const { data: existingEnd } = await admin
      .from("production_plan_months")
      .select("id")
      .eq("plan_year", year)
      .eq("plan_month", month)
      .eq("version_type", "end")
      .maybeSingle();

    let endMonthId = existingEnd?.id ? String(existingEnd.id) : null;
    if (!endMonthId) {
      const { data: createdEnd, error: createEndErr } = await admin
        .from("production_plan_months")
        .insert({
          plan_year: year,
          plan_month: month,
          version_type: "end",
          title: `${year}년 ${month}월 마감본`,
          status: "closed",
          source_note: "master에서 마감 생성",
          baseline_headcount: Number(master.baseline_headcount ?? 25),
          created_by: user.id,
          closed_by: user.id,
          closed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (createEndErr) throw createEndErr;
      endMonthId = String(createdEnd.id);
    } else {
      const { error: cleanEntriesErr } = await admin.from("production_plan_entries").delete().eq("month_id", endMonthId);
      if (cleanEntriesErr) throw cleanEntriesErr;
      const { error: cleanNotesErr } = await admin.from("production_plan_notes").delete().eq("month_id", endMonthId);
      if (cleanNotesErr) throw cleanNotesErr;
      const { error: cleanManpowerErr } = await admin.from("production_plan_manpower").delete().eq("month_id", endMonthId);
      if (cleanManpowerErr) throw cleanManpowerErr;
      const { error: updateEndErr } = await admin
        .from("production_plan_months")
        .update({ status: "closed", closed_by: user.id, closed_at: new Date().toISOString() })
        .eq("id", endMonthId);
      if (updateEndErr) throw updateEndErr;
    }

    const masterId = String(master.id);
    const [entriesRes, notesRes, manpowerRes] = await Promise.all([
      admin
        .from("production_plan_entries")
        .select("plan_date,product_name_snapshot,qty,sort_order")
        .eq("month_id", masterId),
      admin.from("production_plan_notes").select("plan_date,note_text,note_order").eq("month_id", masterId),
      admin
        .from("production_plan_manpower")
        .select("plan_date,annual_leave_count,half_day_count,other_count,actual_manpower")
        .eq("month_id", masterId),
    ]);
    if (entriesRes.error) throw entriesRes.error;
    if (notesRes.error) throw notesRes.error;
    if (manpowerRes.error) throw manpowerRes.error;

    if ((entriesRes.data ?? []).length > 0) {
      const payload = (entriesRes.data ?? []).map((r) => ({ ...r, month_id: endMonthId }));
      const { error: insertEntriesErr } = await admin.from("production_plan_entries").insert(payload);
      if (insertEntriesErr) throw insertEntriesErr;
    }
    if ((notesRes.data ?? []).length > 0) {
      const payload = (notesRes.data ?? []).map((r) => ({ ...r, month_id: endMonthId }));
      const { error: insertNotesErr } = await admin.from("production_plan_notes").insert(payload);
      if (insertNotesErr) throw insertNotesErr;
    }
    if ((manpowerRes.data ?? []).length > 0) {
      const payload = (manpowerRes.data ?? []).map((r) => ({ ...r, month_id: endMonthId }));
      const { error: insertManpowerErr } = await admin.from("production_plan_manpower").insert(payload);
      if (insertManpowerErr) throw insertManpowerErr;
    }

    await admin.from("production_plan_month_closings").insert({
      source_month_id: masterId,
      closed_month_id: endMonthId,
      plan_year: year,
      plan_month: month,
      note: "master -> end snapshot",
      created_by: user.id,
    });

    return NextResponse.json({
      ok: true,
      sourceMonthId: masterId,
      endMonthId,
      copiedEntries: (entriesRes.data ?? []).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "close_failed", message }, { status: 500 });
  }
}
