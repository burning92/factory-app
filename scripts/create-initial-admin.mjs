/**
 * 최초 admin 계정 1회 생성 (Auth + profiles).
 * 사용: INITIAL_ADMIN_PASSWORD=비밀번호 node scripts/create-initial-admin.mjs
 * .env.local 에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 필요.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.INITIAL_ADMIN_PASSWORD;

if (!url || !serviceRoleKey) {
  console.error("설정: .env.local에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 필요");
  process.exit(1);
}
if (!password) {
  console.error("설정: 환경변수 INITIAL_ADMIN_PASSWORD 필요. 예: set INITIAL_ADMIN_PASSWORD=비밀번호 && node scripts/create-initial-admin.mjs");
  process.exit(1);
}

const ADMIN_EMAIL = "YWRtaW4@000.local"; // base64url("admin")@000.local
const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .select("id")
    .eq("organization_code", "000")
    .single();
  if (orgErr || !org) {
    console.error("organizations에서 organization_code='000' 조회 실패:", orgErr?.message || "no row");
    process.exit(1);
  }

  const { data: existing } = await supabase.from("profiles").select("id").eq("role", "admin").limit(1);
  if (existing?.length) {
    console.log("이미 role=admin 계정이 있습니다. 스크립트를 건너뜁니다.");
    process.exit(0);
  }

  const { data: authUser, error: createErr } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password,
    email_confirm: true,
  });
  if (createErr) {
    console.error("Auth 사용자 생성 실패:", createErr.message);
    process.exit(1);
  }
  if (!authUser?.user) {
    console.error("Auth 사용자 생성 후 user 없음");
    process.exit(1);
  }

  const { error: insertErr } = await supabase.from("profiles").insert({
    id: authUser.user.id,
    organization_id: org.id,
    login_id: "admin",
    display_name: "관리자",
    role: "admin",
    is_active: true,
    must_change_password: false,
  });
  if (insertErr) {
    console.error("profiles INSERT 실패:", insertErr.message);
    process.exit(1);
  }

  const { data: check } = await supabase.from("profiles").select("id, login_id, display_name, role").eq("role", "admin");
  console.log("완료. profiles WHERE role='admin' 건수:", check?.length ?? 0);
  if (check?.length) console.log("생성된 행:", JSON.stringify(check, null, 2));
}

main();
