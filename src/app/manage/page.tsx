"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Eye, EyeOff, Copy, KeyRound } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import ManageAnnualLeaveSection from "./ManageAnnualLeaveSection";

function generateTempPassword(length = 12): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const arr = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

interface OrgRow {
  id: string;
  organization_code: string;
  name: string;
  is_active: boolean;
}

interface ProfileRow {
  id: string;
  organization_id: string;
  login_id: string;
  display_name: string | null;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  /** Supabase relation: 단일 객체 또는 배열로 올 수 있음 */
  organizations?: { organization_code: string; name: string } | { organization_code: string; name: string }[] | null;
}

export default function ManagePage() {
  const { profile } = useAuth();
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrgs = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("organizations")
      .select("id, organization_code, name, is_active")
      .order("organization_code");
    if (e) {
      setError(e.message);
      return;
    }
    // 숫자 코드만 표시: 000, 100, 200 등 (문자열 코드 armored, master 제외)
    const rows = (data as OrgRow[]) ?? [];
    const numericOnly = rows.filter((o) => /^\d+$/.test(o.organization_code));
    setOrgs(numericOnly);
  }, []);

  const loadProfiles = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("profiles")
      .select("id, organization_id, login_id, display_name, role, is_active, must_change_password, organizations(organization_code, name)");
    if (e) {
      setError(e.message);
      return;
    }
    setProfiles(((data ?? []) as unknown) as ProfileRow[]);
  }, []);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    Promise.all([loadOrgs(), loadProfiles()]).finally(() => setLoading(false));
  }, [profile?.role, loadOrgs, loadProfiles]);

  const [newOrgCode, setNewOrgCode] = useState("");
  const [newOrgName, setNewOrgName] = useState("");
  const [newLoginId, setNewLoginId] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newUserOrgCode, setNewUserOrgCode] = useState("");
  const [newUserRole, setNewUserRole] = useState<"worker" | "manager">("worker");
  const [submitting, setSubmitting] = useState(false);
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);

  function handleGenerateTempPassword() {
    const pwd = generateTempPassword(12);
    setNewPassword(pwd);
    copyToClipboard(pwd);
  }

  function copyToClipboard(text: string) {
    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  async function handleAddOrg(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const code = newOrgCode.trim();
    const name = newOrgName.trim() || code;
    const { data: inserted, error: e2 } = await supabase
      .from("organizations")
      .insert({ organization_code: code, name: name || code })
      .select("id")
      .single();
    if (e2) {
      setSubmitting(false);
      setError(e2.message);
      return;
    }
    if (inserted) {
      await supabase.from("organization_ui_settings").insert({
        organization_id: inserted.id,
        brand_name: name,
        default_landing_path: "/",
      });
    }
    setSubmitting(false);
    setNewOrgCode("");
    setNewOrgName("");
    loadOrgs();
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newUserOrgCode.trim() || !newLoginId.trim() || !newPassword || newPassword.length < 6) {
      setError("회사코드, 아이디, 비밀번호(6자 이상)를 입력하세요.");
      return;
    }
    setSubmitting(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError("로그인 세션이 없습니다.");
      setSubmitting(false);
      return;
    }
    const res = await fetch("/api/admin/create-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        organization_code: newUserOrgCode.trim(),
        login_id: newLoginId.trim(),
        display_name: newDisplayName.trim() || undefined,
        password: newPassword,
        role: newUserRole,
      }),
    });
    const json = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(json.error || "사용자 생성 실패");
      return;
    }
    setNewLoginId("");
    setNewDisplayName("");
    setNewPassword("");
    loadProfiles();
  }

  const handleRoleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    setNewUserRole(v === "manager" ? "manager" : "worker");
  };

  async function handleResetPassword(userId: string) {
    const p = window.prompt("새 비밀번호 (6자 이상)");
    if (!p || p.length < 6) return;
    setSubmitting(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setError("로그인 세션이 없습니다.");
      setSubmitting(false);
      return;
    }
    const res = await fetch("/api/admin/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        target_user_id: userId,
        new_password: p,
      }),
    });
    const json = await res.json();
    setSubmitting(false);
    if (!res.ok) setError(json.error || "비밀번호 재설정 실패");
    else loadProfiles();
  }

  async function toggleActive(pro: ProfileRow) {
    const { error: e } = await supabase
      .from("profiles")
      .update({ is_active: !pro.is_active })
      .eq("id", pro.id);
    if (e) setError(e.message);
    else loadProfiles();
  }

  async function handleSaveRole(pro: ProfileRow, newRole: "worker" | "manager") {
    if (pro.role === "admin") return;
    setError(null);
    setSavingRoleId(pro.id);
    const { error: e } = await supabase
      .from("profiles")
      .update({ role: newRole })
      .eq("id", pro.id);
    setSavingRoleId(null);
    if (e) setError(e.message);
    else loadProfiles();
  }

  const filteredProfiles = selectedOrgId
    ? profiles.filter((p) => p.organization_id === selectedOrgId)
    : profiles;

  if (profile?.role !== "admin") {
    return (
      <div className="p-6">
        <p className="text-slate-500">권한이 없습니다.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-slate-500">로딩 중…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">관리 (사업장 / 사용자)</h1>
      <p className="text-sm text-slate-400 -mt-4">
        <Link href="/admin/equipment" className="text-cyan-400 hover:text-cyan-300 font-medium">
          제조설비등록
        </Link>
        <span className="text-slate-600 mx-2">·</span>
        <Link href="/production/admin" className="text-slate-400 hover:text-slate-300">
          기준정보(원료·BOM) 관리
        </Link>
        <span className="text-slate-600 mx-2">·</span>
        <Link href="/admin/logs" className="text-slate-400 hover:text-slate-300">
          로그 조회
        </Link>
      </p>
      {error && (
        <p className="text-red-400 text-sm" role="alert">
          {error}
        </p>
      )}

      <section className="rounded-xl border border-slate-700 bg-space-800/80 p-6">
        <h2 className="text-lg font-semibold text-slate-100 mb-4">사업장(organization)</h2>
        <ul className="mb-4 space-y-2 text-sm text-slate-300">
          {orgs.map((o) => (
            <li key={o.id}>
              <span className="font-mono">{o.organization_code}</span> — {o.name}
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddOrg} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">회사코드</label>
            <input
              type="text"
              value={newOrgCode}
              onChange={(e) => setNewOrgCode(e.target.value)}
              placeholder="예: 300"
              className="w-32 px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">표시명</label>
            <input
              type="text"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="예: 새 사업장명"
              className="w-32 px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium disabled:opacity-50"
          >
            사업장 추가
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-700 bg-space-800/80 p-6">
        <h2 className="text-lg font-semibold text-slate-100 mb-4">사용자</h2>
        <div className="mb-4">
          <label className="block text-xs text-slate-400 mb-1">조직 필터</label>
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
          >
            <option value="">전체</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.organization_code}</option>
            ))}
          </select>
        </div>
        <ul className="mb-6 space-y-2 text-sm">
          {filteredProfiles.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 text-slate-300">
              <span className="font-mono">{p.login_id}</span>
              <span>{p.display_name ?? "—"}</span>
              <span className="text-slate-500">
                {Array.isArray(p.organizations) ? p.organizations[0]?.organization_code : p.organizations?.organization_code ?? ""}
              </span>
              {p.role === "admin" ? (
                <span className="text-amber-400 text-xs font-medium">admin (변경 불가)</span>
              ) : (
                <>
                  <select
                    defaultValue={p.role}
                    onChange={(e) => {
                      const v = e.target.value as "worker" | "manager";
                      handleSaveRole(p, v);
                    }}
                    disabled={savingRoleId === p.id}
                    className="px-2 py-1 text-xs bg-space-900 border border-slate-600 rounded text-slate-100 disabled:opacity-50"
                    aria-label={`${p.login_id} 권한 변경`}
                  >
                    <option value="worker">worker</option>
                    <option value="manager">manager</option>
                  </select>
                  {savingRoleId === p.id && <span className="text-slate-500 text-xs">저장 중…</span>}
                </>
              )}
              {p.must_change_password && <span className="text-amber-400 text-xs">비밀번호 변경 필요</span>}
              {!p.is_active && <span className="text-red-400 text-xs">비활성</span>}
              <button
                type="button"
                onClick={() => handleResetPassword(p.id)}
                disabled={submitting}
                className="text-cyan-400 hover:text-cyan-300 text-xs disabled:opacity-50"
              >
                비밀번호 재설정
              </button>
              <button
                type="button"
                onClick={() => toggleActive(p)}
                disabled={submitting}
                className="text-slate-400 hover:text-slate-300 text-xs disabled:opacity-50"
              >
                {p.is_active ? "비활성화" : "활성화"}
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddUser} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">회사코드</label>
            <input
              type="text"
              value={newUserOrgCode}
              onChange={(e) => setNewUserOrgCode(e.target.value)}
              placeholder="100 또는 200"
              className="w-28 px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">권한</label>
            <select
              value={newUserRole}
              onChange={handleRoleChange}
              className="w-24 px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
            >
              <option value="worker">worker</option>
              <option value="manager">manager</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">아이디</label>
            <input
              type="text"
              value={newLoginId}
              onChange={(e) => setNewLoginId(e.target.value)}
              placeholder="홍길동01"
              className="w-28 px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">표시 이름</label>
            <input
              type="text"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="홍길동"
              className="w-24 px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">초기 비밀번호</label>
            <div className="flex items-center gap-1">
              <input
                type={showInitialPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="6자 이상"
                minLength={6}
                className="w-28 px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-l-lg rounded-r-none text-slate-100"
                required
              />
              <button
                type="button"
                onClick={() => setShowInitialPassword((v) => !v)}
                className="p-2 border border-slate-600 border-l-0 bg-space-900 text-slate-400 hover:text-slate-200 rounded-r-lg"
                title={showInitialPassword ? "숨기기" : "보기"}
                aria-label={showInitialPassword ? "숨기기" : "보기"}
              >
                {showInitialPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => copyToClipboard(newPassword)}
                disabled={!newPassword}
                className="p-2 border border-slate-600 bg-space-900 text-slate-400 hover:text-slate-200 rounded-lg disabled:opacity-50"
                title="복사"
                aria-label="복사"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleGenerateTempPassword}
                className="px-2 py-2 text-xs font-medium rounded-lg border border-slate-600 bg-space-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100 whitespace-nowrap"
                title="12자 임시 비밀번호 생성 후 복사"
              >
                <KeyRound className="w-4 h-4 inline mr-1 align-middle" />
                임시 생성
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium disabled:opacity-50"
          >
            사용자 추가
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          추가된 사용자는 설정한 초기 비밀번호로 로그인합니다. 필요 시 비밀번호 재설정 버튼으로 변경하세요.
        </p>
      </section>

      <ManageAnnualLeaveSection profiles={filteredProfiles} />
    </div>
  );
}
