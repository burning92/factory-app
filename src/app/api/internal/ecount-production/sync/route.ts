import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import type { EcountProductionSyncPayload } from "@/features/dashboard/ecountProductionTypes";
import type { RawEcountProductionRow } from "@/features/dashboard/ecountProductionTypes";
import {
  parseEcountSpreadsheetPaste,
  filterRawRowsForEcountDatabase,
} from "@/features/dashboard/parseEcountTsvPaste";

const SYNC_NAME = "ecount_production_import";

function getSyncToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return req.headers.get("x-sync-token");
}

function isAuthorized(req: NextRequest): boolean {
  const token = getSyncToken(req);
  const secret = process.env.ECOUNT_SYNC_SECRET;
  return !!token && !!secret && token === secret;
}

function parseMovementDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, "0");
    const d = m[3].padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  const iso = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return null;
}

function toQty(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

/** JSON rows만 올 때: 날짜·수량 정규화해 paste 파서와 동일한 필터로 통과 */
function normalizeJsonRowsToRaw(rows: RawEcountProductionRow[]): RawEcountProductionRow[] {
  const out: RawEcountProductionRow[] = [];
  for (const raw of rows) {
    const movement_date = parseMovementDate(raw.movement_date);
    const item_name = (raw.item_name != null ? String(raw.item_name) : "").trim();
    const qty = toQty(raw.quantity);
    if (!movement_date || !item_name || qty == null) continue;
    const movement_type = (raw.movement_type != null ? String(raw.movement_type).trim() : "") || "생산입고";
    const external_ref =
      raw.external_ref != null && String(raw.external_ref).trim()
        ? String(raw.external_ref).trim()
        : null;
    out.push({ movement_date, item_name, quantity: qty, movement_type, external_ref });
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: EcountProductionSyncPayload;
  try {
    body = (await req.json()) as EcountProductionSyncPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sourceRefreshedAt =
    typeof body.sourceRefreshedAt === "string" && body.sourceRefreshedAt.trim()
      ? body.sourceRefreshedAt.trim()
      : null;

  const hasPaste = typeof body.paste === "string" && body.paste.trim().length > 0;
  const jsonRows = Array.isArray(body.rows) ? body.rows : [];
  const hasRows = jsonRows.length > 0;
  if (!hasPaste && !hasRows) {
    return NextResponse.json({ error: "paste 또는 rows가 필요합니다." }, { status: 400 });
  }

  const combined: RawEcountProductionRow[] = [];

  if (hasPaste) {
    const { rows } = parseEcountSpreadsheetPaste(body.paste!, {
      dateFrom: body.dateFrom ?? undefined,
      dateTo: body.dateTo ?? undefined,
    });
    combined.push(...rows);
  }

  if (hasRows) {
    combined.push(...normalizeJsonRowsToRaw(jsonRows));
  }

  if (combined.length === 0) {
    return NextResponse.json(
      { error: "날짜·형식이 맞는 행이 없습니다. 탭 구분·일자(YYYY/MM/DD)를 확인하세요." },
      { status: 400 }
    );
  }

  const { payload, skippedNotReceipt, skippedByItemRule, skippedInvalid } =
    filterRawRowsForEcountDatabase(combined);

  if (payload.length === 0) {
    return NextResponse.json(
      {
        error:
          "DB에 넣을 생산입고 행이 없습니다. 생산소모·불량-폐기만 있거나, 볼도우 등 제외 품목뿐일 수 있습니다.",
        skippedNotReceipt,
        skippedByItemRule,
        skippedInvalid,
        inputCombinedRows: combined.length,
      },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  try {
    const { error: deleteErr } = await supabase
      .from("ecount_production_import_lines")
      .delete()
      .neq("id", 0);
    if (deleteErr) throw deleteErr;

    let inserted = 0;
    if (payload.length > 0) {
      const { data: ins, error: insertErr } = await supabase
        .from("ecount_production_import_lines")
        .insert(payload)
        .select("id");
      if (insertErr) throw insertErr;
      inserted = ins?.length ?? 0;
    }

    await supabase.from("production_plan_sync_status").upsert(
      {
        sync_name: SYNC_NAME,
        last_synced_at: now,
        last_status: "success",
        row_count: inserted,
        message: null,
        source_refreshed_at: sourceRefreshedAt,
        updated_at: now,
      },
      { onConflict: "sync_name" }
    );

    return NextResponse.json({
      ok: true,
      inserted,
      replaced: payload.length,
      skippedNotReceipt,
      skippedByItemRule,
      skippedInvalid,
      inputCombinedRows: combined.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("production_plan_sync_status")
      .upsert(
        {
          sync_name: SYNC_NAME,
          last_synced_at: now,
          last_status: "failure",
          row_count: 0,
          message,
          source_refreshed_at: sourceRefreshedAt,
          updated_at: now,
        },
        { onConflict: "sync_name" }
      )
      .then(() => {});

    return NextResponse.json({ error: "Sync failed", message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "ecount-production-sync" });
}
