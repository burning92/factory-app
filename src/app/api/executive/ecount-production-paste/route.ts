import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import {
  parseEcountSpreadsheetPaste,
  filterRawRowsForEcountDatabase,
} from "@/features/dashboard/parseEcountTsvPaste";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const SYNC_NAME = "ecount_production_import";

export async function POST(request: Request) {
  let body: {
    access_token?: string;
    refresh_token?: string;
    paste?: string;
    dateFrom?: string | null;
    dateTo?: string | null;
    sourceRefreshedAt?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const { access_token, refresh_token, paste, dateFrom, dateTo, sourceRefreshedAt } = body;
  if (!access_token || !refresh_token || typeof paste !== "string" || !paste.trim()) {
    return NextResponse.json(
      { error: "access_token, refresh_token, paste(붙여넣기 텍스트)가 필요합니다." },
      { status: 400 }
    );
  }

  if (!url || !anonKey) {
    return NextResponse.json({ error: "서버 환경 변수 오류" }, { status: 500 });
  }

  const anon = createClient(url, anonKey);
  const {
    data: { user },
    error: sessionError,
  } = await anon.auth.setSession({ access_token, refresh_token });
  if (sessionError || !user) {
    return NextResponse.json({ error: "인증 실패" }, { status: 401 });
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: "서버 Supabase 설정 오류" }, { status: 500 });
  }

  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || (profile.role !== "admin" && profile.role !== "manager" && profile.role !== "headquarters")) {
    return NextResponse.json({ error: "관리자·매니저만 업로드할 수 있습니다." }, { status: 403 });
  }

  const { rows: parsed, stats: parseStats } = parseEcountSpreadsheetPaste(paste, {
    dateFrom: dateFrom ?? undefined,
    dateTo: dateTo ?? undefined,
  });
  if (parsed.length === 0) {
    return NextResponse.json(
      {
        error:
          "파싱된 행이 없습니다. 엑셀에서 영역 복사(탭 구분)·첫 열 일자(2024/01/08 형식)를 확인하세요.",
        parseStats,
      },
      { status: 400 }
    );
  }

  const filtered = filterRawRowsForEcountDatabase(parsed);
  if (filtered.payload.length === 0) {
    return NextResponse.json(
      {
        error:
          "저장할 생산입고 행이 없습니다. 생산소모·불량만 있거나 볼도우 등 제외 품목만 있을 수 있습니다.",
        parseStats,
        skippedNotReceipt: filtered.skippedNotReceipt,
        skippedByItemRule: filtered.skippedByItemRule,
        skippedInvalid: filtered.skippedInvalid,
      },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const srcAt =
    typeof sourceRefreshedAt === "string" && sourceRefreshedAt.trim()
      ? sourceRefreshedAt.trim()
      : null;

  try {
    const { error: deleteErr } = await admin.from("ecount_production_import_lines").delete().neq("id", 0);
    if (deleteErr) throw deleteErr;

    let inserted = 0;
    if (filtered.payload.length > 0) {
      const { data: ins, error: insertErr } = await admin
        .from("ecount_production_import_lines")
        .insert(filtered.payload)
        .select("id");
      if (insertErr) throw insertErr;
      inserted = ins?.length ?? 0;
    }

    await admin.from("production_plan_sync_status").upsert(
      {
        sync_name: SYNC_NAME,
        last_synced_at: now,
        last_status: "success",
        row_count: inserted,
        message: null,
        source_refreshed_at: srcAt,
        updated_at: now,
      },
      { onConflict: "sync_name" }
    );

    return NextResponse.json({
      ok: true,
      inserted,
      replaced: filtered.payload.length,
      parseStats,
      skippedNotReceipt: filtered.skippedNotReceipt,
      skippedByItemRule: filtered.skippedByItemRule,
      skippedInvalid: filtered.skippedInvalid,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("production_plan_sync_status")
      .upsert(
        {
          sync_name: SYNC_NAME,
          last_synced_at: now,
          last_status: "failure",
          row_count: 0,
          message,
          source_refreshed_at: srcAt,
          updated_at: now,
        },
        { onConflict: "sync_name" }
      )
      .then(() => {});

    return NextResponse.json({ error: "저장 실패", message }, { status: 500 });
  }
}
