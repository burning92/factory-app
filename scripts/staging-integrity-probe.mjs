import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env.local");
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const url = env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const host = url.replace("https://", "").split(".")[0];

const results = { project_ref: host || "(missing)", at: new Date().toISOString() };

if (!url || !key) {
  console.log(JSON.stringify({ ...results, error: "missing env" }, null, 2));
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};
const rest = `${url}/rest/v1`;

async function rpc(name, body = {}) {
  const res = await fetch(`${rest}/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, text };
}

async function get(table, query) {
  const res = await fetch(`${rest}/${table}?${query}`, {
    headers: { ...headers, Accept: "application/json" },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, text };
}

const colProbe = await get("harang_production_line_lots", "select=inventory_transaction_id&limit=1");
results.migrations = {
  column_inventory_transaction_id:
    colProbe.status === 200 ? "applied" : `not_applied (${colProbe.text?.slice?.(0, 120) ?? colProbe.text})`,
};

const rpcChecks = {};
const lotRes = await get("harang_inventory_lots", "select=id&limit=1");
const lotId = lotRes.data?.[0]?.id;
if (lotId) {
  const r = await rpc("harang_lot_ledger_sum", { p_lot_id: lotId });
  rpcChecks.harang_lot_ledger_sum = r.status === 200 ? "ok" : `fail ${r.status}`;
} else {
  rpcChecks.harang_lot_ledger_sum = "no_lot";
}

for (const name of [
  "harang_assert_production_inventory_integrity",
  "harang_reject_legacy_unlinked_production",
]) {
  const r = await rpc(name, { p_header_id: "00000000-0000-0000-0000-000000000000" });
  if (String(r.text).includes("Could not find the function")) {
    rpcChecks[name] = "not_deployed";
  } else {
    rpcChecks[name] = r.status >= 400 ? "exists" : "ok";
  }
}

const mm = await rpc("harang_list_lot_current_vs_ledger_mismatches", {});
rpcChecks.harang_list_lot_current_vs_ledger_mismatches =
  mm.status === 200 ? `ok (${Array.isArray(mm.data) ? mm.data.length : 0} rows)` : `fail ${mm.status}`;

results.rpcs = rpcChecks;

const legacyLots = await get(
  "harang_production_line_lots",
  "select=line_id,quantity_used,inventory_transaction_id&inventory_transaction_id=is.null&quantity_used=gt.0.0005&limit=5",
);
results.legacy_unlinked_line_lots_count = legacyLots.data?.length ?? 0;

let legacyHeaderId = null;
if (legacyLots.data?.length) {
  const lineId = legacyLots.data[0].line_id;
  const lineRes = await get("harang_production_lines", `select=header_id&id=eq.${lineId}`);
  legacyHeaderId = lineRes.data?.[0]?.header_id ?? null;
}
results.legacy_header_id = legacyHeaderId;

const linked = await get(
  "harang_production_line_lots",
  "select=line_id,inventory_transaction_id&inventory_transaction_id=not.is.null&limit=1",
);
let newHeaderId = null;
if (linked.data?.length) {
  const lineRes = await get("harang_production_lines", `select=header_id&id=eq.${linked.data[0].line_id}`);
  newHeaderId = lineRes.data?.[0]?.header_id ?? null;
}
results.new_structure_header_id = newHeaderId;

if (legacyHeaderId) {
  const headBefore = await get("harang_production_headers", `select=id&id=eq.${legacyHeaderId}`);
  const del = await rpc("delete_harang_production_with_usage", { p_header_id: legacyHeaderId });
  const headAfter = await get("harang_production_headers", `select=id&id=eq.${legacyHeaderId}`);
  results.legacy_delete_guard = {
    http_status: del.status,
    blocked: del.status >= 400 && String(del.text).includes("레거시"),
    header_preserved: headBefore.data?.length === headAfter.data?.length,
    snippet: String(del.text).slice(0, 180),
  };

  const upd = await rpc("update_harang_production_from_request_line", {
    p_header_id: legacyHeaderId,
    p_production_date: "2025-01-01",
    p_request_line_id: "00000000-0000-0000-0000-000000000000",
    p_finished_qty: 1,
    p_note: null,
    p_lines: [],
    p_finished_product_lot_date: "2025-01-01",
  });
  results.legacy_update_guard = {
    http_status: upd.status,
    blocked: upd.status >= 400 && String(upd.text).includes("레거시"),
    snippet: String(upd.text).slice(0, 180),
  };
}

// G03 search
const g03 = await get("harang_production_headers", "select=id,production_no&production_no=ilike.*G03*&limit=5");
results.g03_sample = g03.data;

// Negative ledger lot sample (read-only)
const negItem = "2a733ca3-3fe6-419b-aebb-1cf111aa979e";
const lots = await get(
  "harang_inventory_lots",
  `select=id,lot_date,current_quantity&category=eq.raw_material&item_id=eq.${negItem}&order=lot_date.asc&limit=20`,
);
if (lots.data?.length && lotId) {
  const samples = [];
  for (const lot of lots.data.slice(0, 5)) {
    const sum = await rpc("harang_lot_ledger_sum", { p_lot_id: lot.id });
    samples.push({
      lot_date: lot.lot_date,
      current_quantity: lot.current_quantity,
      ledger_sum: sum.data,
    });
  }
  results.pepperoni_lot_samples = samples;
}

const pepper = await get(
  "harang_production_headers",
  "select=id,production_no,product_name&product_name=ilike.*%ED%8E%90%ED%8D%BC%EB%A1%9C%EB%8B%88*&limit=5",
);
results.pepperoni_headers = pepper.data;

const linkedCount = await get(
  "harang_production_line_lots",
  "select=id&inventory_transaction_id=not.is.null&limit=1",
);
results.has_new_structure_production = linkedCount.data?.length > 0;

const testLotId = "8fe439fa-4dfa-463a-b534-e75c54ce062f";
const lotDetail = await get("harang_inventory_lots", `select=id,item_id,item_name,lot_date,initial_quantity,current_quantity&id=eq.${testLotId}`);
const txs = await get("harang_inventory_transactions", `select=id,tx_type,quantity_delta&lot_id=eq.${testLotId}`);
const ledgerSum = await rpc("harang_lot_ledger_sum", { p_lot_id: testLotId });
const usageSum = Array.isArray(txs)
  ? txs.filter((t) => t.tx_type === "usage").reduce((s, t) => s + Math.abs(Number(t.quantity_delta)), 0)
  : null;
results.recommended_test_lot_snapshot = {
  lot: lotDetail?.[0] ?? lotDetail,
  ledger_sum: ledgerSum,
  usage_sum: usageSum,
  transaction_count: Array.isArray(txs) ? txs.length : null,
};

console.log(JSON.stringify(results, null, 2));
