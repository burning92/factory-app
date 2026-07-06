/** 읽기 전용: 간편 재고 마이그레이션·배포 상태 확인 */
import fs from "fs";
import path from "path";

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const url = env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
const projectRef = url.replace("https://", "").split(".")[0];
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  Accept: "application/json",
  Prefer: "count=exact",
};
const rest = `${url}/rest/v1`;

async function tableProbe(table) {
  const res = await fetch(`${rest}/${table}?select=id&limit=0`, { headers });
  const range = res.headers.get("content-range");
  const count = range?.includes("/") ? range.split("/")[1] : null;
  return { status: res.status, count, exists: res.status === 200 || res.status === 206 };
}

async function rpcProbe(name, body = {}) {
  const res = await fetch(`${rest}/rpc/${name}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    exists: res.status !== 404 && !text.includes("Could not find the function"),
    snippet: text.slice(0, 160),
  };
}

const tables = [
  "harang_inventory_surveys",
  "harang_inventory_survey_lines",
  "harang_inventory_lots",
  "harang_inventory_transactions",
];

const out = {
  project_ref: projectRef,
  at: new Date().toISOString(),
  tables: {},
  rpcs: {},
};

for (const t of tables) {
  out.tables[t] = await tableProbe(t);
}

for (const name of [
  "confirm_harang_inventory_survey",
  "harang_list_survey_consumption_report",
  "harang_list_survey_monthly_item_summary",
]) {
  const body =
    name === "confirm_harang_inventory_survey"
      ? { p_survey_id: "00000000-0000-0000-0000-000000000001" }
      : name === "harang_list_survey_consumption_report"
        ? { p_month: null, p_item_id: null }
        : { p_month: null };
  out.rpcs[name] = await rpcProbe(name, body);
}

console.log(JSON.stringify(out, null, 2));
