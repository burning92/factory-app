import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const envText = readFileSync(".env.local", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i < 0) continue;
  env[line.slice(0, i)] = line.slice(i + 1).trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const dateArg = process.argv[2] ?? "";
const sb = createClient(url, key);

let q = sb
  .from("material_stock_movements")
  .select(
    "inventory_item_code, movement_type, qty_g, effective_at, memo, voided_at, source_id, created_at"
  )
  .eq("movement_type", "return_unused")
  .eq("source_table", "production_history_date_state")
  .order("created_at", { ascending: false })
  .limit(20);

if (dateArg) q = q.eq("source_id", dateArg.slice(0, 10));

const { data, error } = await q;
if (error) {
  console.error(error);
  process.exit(1);
}

console.log(`return_unused (마감 연동) ${data?.length ?? 0}건${dateArg ? ` · date=${dateArg.slice(0, 10)}` : ""}`);
for (const row of data ?? []) {
  console.log(
    [
      row.source_id,
      row.inventory_item_code,
      row.qty_g,
      row.voided_at ? "VOID" : "active",
      row.memo,
      row.created_at,
    ].join(" | ")
  );
}
