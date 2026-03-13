import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import type { SyncPayload } from "@/features/ecount/sync/types";
import {
  normalizeMasterRows,
  normalizeInventoryRows,
} from "@/features/ecount/sync/normalizeInventory";

const SYNC_NAME = "ecount_inventory";

function getSyncToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return req.headers.get("x-sync-token");
}

function isAuthorized(req: NextRequest): boolean {
  const token = getSyncToken(req);
  const secret = process.env.ECCOUNT_SYNC_SECRET;
  return !!token && !!secret && token === secret;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: SyncPayload;
  try {
    body = (await req.json()) as SyncPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const masterRows = Array.isArray(body.masterRows) ? body.masterRows : [];
  const inventoryRows = Array.isArray(body.inventoryRows) ? body.inventoryRows : [];
  const sourceRefreshedAt =
    typeof body.sourceRefreshedAt === "string" && body.sourceRefreshedAt.trim()
      ? body.sourceRefreshedAt.trim()
      : null;

  const { rows: normalizedMaster, filtered: masterFiltered } =
    normalizeMasterRows(masterRows);
  const masterMap = new Map(
    normalizedMaster.map((m) => [m.item_code, m])
  );
  const { rows: normalizedInventory, filtered: inventoryFiltered } =
    normalizeInventoryRows(inventoryRows, masterMap);

  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  try {
    for (const row of normalizedMaster) {
      const { error } = await supabase.from("ecount_item_master").upsert(
        {
          item_code: row.item_code,
          item_name: row.item_name,
          inventory_type: row.inventory_type,
          category: row.category,
          box_weight_g: row.box_weight_g,
          unit_weight_g: row.unit_weight_g,
          is_active: row.is_active,
          note: row.note,
          updated_at: now,
        },
        { onConflict: "item_code" }
      );
      if (error) throw error;
    }

    const { error: deleteErr } = await supabase
      .from("ecount_inventory_current")
      .delete()
      .neq("id", 0);
    if (deleteErr) throw deleteErr;

    const inventoryToInsert = normalizedInventory.map((row) => ({
      item_code: row.item_code,
      lot_no: row.lot_no,
      qty: row.qty,
      raw_item_name: row.raw_item_name,
      display_item_name: row.display_item_name,
      inventory_type: row.inventory_type,
      category: row.category,
      box_weight_g: row.box_weight_g,
      unit_weight_g: row.unit_weight_g,
      synced_at: now,
      updated_at: now,
    }));

    let inventoryInserted = 0;
    if (inventoryToInsert.length > 0) {
      const { data: inserted, error: insertErr } = await supabase
        .from("ecount_inventory_current")
        .insert(inventoryToInsert)
        .select("id");
      if (insertErr) throw insertErr;
      inventoryInserted = inserted?.length ?? 0;
    }

    await supabase.from("ecount_sync_status").upsert(
      {
        sync_name: SYNC_NAME,
        last_synced_at: now,
        last_status: "success",
        row_count: inventoryInserted,
        message: null,
        source_refreshed_at: sourceRefreshedAt,
        updated_at: now,
      },
      { onConflict: "sync_name" }
    );

    return NextResponse.json({
      ok: true,
      master: { upserted: normalizedMaster.length, filtered: masterFiltered },
      inventory: {
        inserted: inventoryInserted,
        replaced: normalizedInventory.length,
        filtered: inventoryFiltered,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("ecount_sync_status").upsert(
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
    ).then(() => {});

    return NextResponse.json(
      { error: "Sync failed", message },
      { status: 500 }
    );
  }
}

/** 빠른 확인용: GET 요청 시 라우트 존재 여부 응답 */
export async function GET() {
  return NextResponse.json({ ok: true, route: "ecount-inventory-sync" });
}
