/**
 * 간편 재고 리포트 RPC category 모호성 수정만 적용 (CREATE OR REPLACE 2함수).
 * 사용: SUPABASE_DB_PASSWORD=... node scripts/apply-simple-inventory-rpc-fix.mjs
 * 또는 Supabase SQL Editor에 supabase/migrations/20260706120000_harang_simple_inventory_survey.sql
 * 의 두 CREATE OR REPLACE FUNCTION 블록(리포트 2개)만 실행.
 */
import fs from "fs";
import path from "path";
import pg from "pg";

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL || "";
const ref = url.replace("https://", "").split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD || env.SUPABASE_DB_PASSWORD || "";

if (!ref || !password) {
  console.error(
    JSON.stringify(
      {
        error: "SUPABASE_DB_PASSWORD required",
        hint: "Supabase Dashboard → Project Settings → Database → password",
        project_ref: ref || null,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260706120000_harang_simple_inventory_survey.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");
const fnBlocks = [];
const markers = [
  "CREATE OR REPLACE FUNCTION public.harang_list_survey_consumption_report",
  "CREATE OR REPLACE FUNCTION public.harang_list_survey_monthly_item_summary",
];
for (let i = 0; i < markers.length; i++) {
  const start = sql.indexOf(markers[i]);
  const next = i + 1 < markers.length ? sql.indexOf(markers[i + 1]) : sql.indexOf("NOTIFY pgrst");
  if (start < 0 || next < 0) {
    console.error("Could not extract function SQL from migration");
    process.exit(1);
  }
  fnBlocks.push(sql.slice(start, next).trim());
}
fnBlocks.push("NOTIFY pgrst, 'reload schema';");

const connectionString =
  process.env.SUPABASE_DB_URL ||
  `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`;

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  for (const block of fnBlocks) {
    await client.query(block);
  }
  console.log(JSON.stringify({ ok: true, applied: ["harang_list_survey_consumption_report", "harang_list_survey_monthly_item_summary"] }, null, 2));
} finally {
  await client.end();
}
