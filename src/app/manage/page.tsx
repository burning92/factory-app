"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

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
    setOrgs((data as OrgRow[]) ?? []);
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
  const [submitting, setSubmitting] = useState(false);

  async function handleAddOrg(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const code = newOrgCode.trim().toLowerCase();
    const name = newOrgName.trim() || code;
    const { data: inserted, error: e2 } = await supabase
      .from("organizations")
      .insert({ organization_code: code, name })
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
              placeholder="예: harang"
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
              placeholder="예: 하랑"
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
              placeholder="armored"
              className="w-28 px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
              required
            />
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
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="6자 이상"
              minLength={6}
              className="w-28 px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
              required
            />
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
          추가된 사용자는 첫 로그인 시 비밀번호 변경이 필요합니다.
        </p>
      </section>
    </div>
  );
}
