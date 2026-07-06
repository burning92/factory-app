/** 읽기 전용: 재고조사 대상 LOT 규모 확인 */
import fs from "fs";
import path from "path";

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}
const headers = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  Accept: "application/json",
};
const rest = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;

async function getAll(table, select, query = "") {
  const rows = [];
  let offset = 0;
  const step = 1000;
  while (true) {
    const res = await fetch(
      `${rest}/${table}?select=${select}${query}&limit=${step}&offset=${offset}`,
      { headers },
    );
    const batch = await res.json();
    if (!Array.isArray(batch)) return { error: batch, rows };
    rows.push(...batch);
    if (batch.length < step) break;
    offset += step;
  }
  return { rows };
}

const lotsRes = await getAll(
  "harang_inventory_lots",
  "id,category,item_name,lot_date,current_quantity",
);
if (lotsRes.error) {
  console.log(JSON.stringify({ error: lotsRes.error }, null, 2));
  process.exit(1);
}
const lots = lotsRes.rows;

const txRes = await getAll("harang_inventory_transactions", "lot_id,quantity_delta,tx_type");
const ledgerByLot = new Map();
for (const tx of txRes.rows ?? []) {
  if (!tx.lot_id) continue;
  ledgerByLot.set(tx.lot_id, (ledgerByLot.get(tx.lot_id) ?? 0) + Number(tx.quantity_delta));
}

const inboundByLot = new Map();
for (const tx of txRes.rows ?? []) {
  if (!tx.lot_id || tx.tx_type !== "inbound") continue;
  inboundByLot.set(tx.lot_id, (inboundByLot.get(tx.lot_id) ?? 0) + Number(tx.quantity_delta));
}

const zeroCurrent = lots.filter((l) => Number(l.current_quantity) <= 0.0005);
const zeroLedger = lots.filter((l) => (ledgerByLot.get(l.id) ?? 0) <= 0.0005);
const posCurrent = lots.filter((l) => Number(l.current_quantity) > 0.0005);
const posLedger = lots.filter((l) => (ledgerByLot.get(l.id) ?? 0) > 0.0005);
const posInboundOnly = lots.filter((l) => (inboundByLot.get(l.id) ?? 0) > 0.0005);
const noInboundTx = lots.filter((l) => !inboundByLot.has(l.id));

const byCategory = { raw_material: 0, packaging_material: 0, other: 0 };
for (const l of lots) {
  const c = l.category;
  if (c in byCategory) byCategory[c]++;
  else byCategory.other++;
}

const lotDates = lots.map((l) => l.lot_date).sort();
const yearCounts = new Map();
for (const d of lotDates) {
  const y = String(d).slice(0, 4);
  yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
}

console.log(
  JSON.stringify(
    {
      total_lots: lots.length,
      by_category: byCategory,
      zero_current_quantity: zeroCurrent.length,
      zero_ledger_sum: zeroLedger.length,
      positive_current_quantity: posCurrent.length,
      positive_ledger_sum: posLedger.length,
      positive_inbound_only_first_baseline_ref: posInboundOnly.length,
      lots_without_inbound_tx: noInboundTx.length,
      lot_date_year_distribution: Object.fromEntries([...yearCounts.entries()].sort()),
      oldest_lot_date: lotDates[0] ?? null,
      newest_lot_date: lotDates[lotDates.length - 1] ?? null,
      sample_zero_current_items: zeroCurrent.slice(0, 8).map((l) => ({
        item: l.item_name,
        lot_date: l.lot_date,
        current_quantity: l.current_quantity,
      })),
    },
    null,
    2,
  ),
);
