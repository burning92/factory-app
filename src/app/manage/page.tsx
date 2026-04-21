"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Eye, EyeOff, Copy, KeyRound, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

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

const ROLE_OPTIONS = [
  { value: "worker", label: "워커" },
  { value: "assistant_manager", label: "준매니저" },
  { value: "manager", label: "매니저" },
  { value: "headquarters", label: "본사" },
] as const;

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

function orgCodeForProfile(p: ProfileRow): string {
  const o = p.organizations;
  if (Array.isArray(o)) return o[0]?.organization_code ?? "";
  return o?.organization_code ?? "";
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
  const [newUserRole, setNewUserRole] = useState<"worker" | "assistant_manager" | "manager" | "headquarters">("worker");
  const [submitting, setSubmitting] = useState(false);
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");

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
    if (v === "assistant_manager" || v === "manager" || v === "headquarters") {
      setNewUserRole(v);
      return;
    }
    setNewUserRole("worker");
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

  async function handleDeleteUser(pro: ProfileRow) {
    if (pro.role === "admin") return;
    if (profile?.id === pro.id) {
      setError("본인 계정은 삭제할 수 없습니다.");
      return;
    }
    const typed = window.prompt(
      `이 계정을 시스템에서 완전히 삭제합니다. 되돌릴 수 없습니다.\n` +
        `삭제하려면 아이디를 그대로 입력하세요: ${pro.login_id}`
    );
    if (typed == null) return;
    if (typed.trim() !== pro.login_id.trim()) {
      setError("아이디가 일치하지 않아 삭제를 취소했습니다.");
      return;
    }
    setError(null);
    setDeletingUserId(pro.id);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setError("로그인 세션이 없습니다.");
      setDeletingUserId(null);
      return;
    }
    const res = await fetch("/api/admin/delete-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        target_user_id: pro.id,
      }),
    });
    const json = (await res.json()) as { error?: string };
    setDeletingUserId(null);
    if (!res.ok) {
      setError(json.error || "계정 삭제 실패");
      return;
    }
    loadProfiles();
  }

  async function handleSaveRole(
    pro: ProfileRow,
    newRole: "worker" | "assistant_manager" | "manager" | "headquarters"
  ) {
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

  const orgFilteredProfiles = useMemo(
    () => (selectedOrgId ? profiles.filter((p) => p.organization_id === selectedOrgId) : profiles),
    [profiles, selectedOrgId]
  );

  const displayedProfiles = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    let list = orgFilteredProfiles;
    if (q) {
      list = list.filter((p) => {
        const login = (p.login_id ?? "").toLowerCase();
        const name = (p.display_name ?? "").toLowerCase();
        const code = orgCodeForProfile(p).toLowerCase();
        return login.includes(q) || name.includes(q) || code.includes(q);
      });
    }
    if (roleFilter) {
      list = list.filter((p) => p.role === roleFilter);
    }
    return [...list].sort((a, b) => a.login_id.localeCompare(b.login_id, "ko"));
  }, [orgFilteredProfiles, userSearch, roleFilter]);

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
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-slate-100">관리 (사업장 / 사용자)</h1>
      <p className="text-sm text-slate-400 -mt-4">
        <Link href="/manage/leave" className="text-cyan-400 hover:text-cyan-300 font-medium">
          연월차관리
        </Link>
        <span className="text-slate-600 mx-2">·</span>
        <Link href="/admin/equipment" className="text-cyan-400 hover:text-cyan-300 font-medium">
          제조설비등록
        </Link>
        <span className="text-slate-600 mx-2">·</span>
        <Link href="/production/admin" className="text-slate-400 hover:text-slate-300">
          기준정보(원료·BOM) 관리
        </Link>
        <span className="text-slate-600 mx-2">·</span>
        <Link href="/production/outbound-standards" className="text-slate-400 hover:text-slate-300">
          제품 출고 기준 관리
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

      <section className="rounded-xl border border-slate-700 bg-space-800/80 p-4 sm:p-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100">사용자</h2>
          <p className="text-xs text-slate-500 tabular-nums">
            표시 {displayedProfiles.length}명
            {(userSearch.trim() || roleFilter) && ` · 전체(필터 전) ${orgFilteredProfiles.length}명`}
          </p>
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 flex-1 sm:max-w-md">
            <label className="block text-xs text-slate-400 mb-1">검색 (아이디·이름·회사코드)</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden />
              <input
                type="search"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="예: 홍길동, 01, 100"
                className="w-full pl-9 pr-3 py-2.5 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder:text-slate-600"
                autoComplete="off"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">조직</label>
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="w-full min-w-[8rem] px-3 py-2.5 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 sm:w-auto"
            >
              <option value="">전체</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.organization_code} — {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">권한 필터</label>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-full min-w-[9rem] px-3 py-2.5 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 sm:w-auto"
            >
              <option value="">전체 역할</option>
              <option value="admin">관리자</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-6 overflow-x-auto rounded-lg border border-slate-700/80 -mx-1 sm:mx-0">
          <table className="w-full min-w-[640px] text-left text-sm text-slate-300">
            <thead>
              <tr className="border-b border-slate-600 bg-space-900/90 text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2.5 whitespace-nowrap">아이디</th>
                <th className="px-3 py-2.5 whitespace-nowrap">이름</th>
                <th className="px-3 py-2.5 whitespace-nowrap w-20">회사</th>
                <th className="px-3 py-2.5 whitespace-nowrap min-w-[8rem]">권한</th>
                <th className="px-3 py-2.5 whitespace-nowrap">상태</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap min-w-[12rem]">작업</th>
              </tr>
            </thead>
            <tbody>
              {displayedProfiles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    조건에 맞는 사용자가 없습니다. 검색어나 필터를 바꿔 보세요.
                  </td>
                </tr>
              ) : (
                displayedProfiles.map((p) => (
                  <tr key={p.id} className="border-b border-slate-700/60 hover:bg-space-900/40">
                    <td className="px-3 py-2.5 font-mono text-slate-200">{p.login_id}</td>
                    <td className="px-3 py-2.5">{p.display_name ?? "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-500">{orgCodeForProfile(p)}</td>
                    <td className="px-3 py-2.5">
                      {p.role === "admin" ? (
                        <span className="text-amber-400 text-xs font-medium">관리자 (변경 불가)</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <select
                            value={p.role}
                            onChange={(e) => {
                              const v = e.target.value as "worker" | "assistant_manager" | "manager" | "headquarters";
                              handleSaveRole(p, v);
                            }}
                            disabled={savingRoleId === p.id}
                            className="max-w-full min-w-[7.5rem] rounded-md border border-slate-600 bg-space-900 px-2 py-1.5 text-xs text-slate-100 disabled:opacity-50"
                            aria-label={`${p.login_id} 권한`}
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                          {savingRoleId === p.id ? (
                            <span className="text-slate-500 text-xs shrink-0">저장…</span>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {!p.is_active ? (
                          <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-300">
                            비활성
                          </span>
                        ) : (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300/90">
                            활성
                          </span>
                        )}
                        {p.must_change_password ? (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-200">
                            비번 변경
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                        <button
                          type="button"
                          onClick={() => handleResetPassword(p.id)}
                          disabled={submitting}
                          className="text-cyan-400 hover:text-cyan-300 text-xs font-medium disabled:opacity-50"
                        >
                          비밀번호
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(p)}
                          disabled={submitting}
                          className="text-slate-400 hover:text-slate-200 text-xs font-medium disabled:opacity-50"
                        >
                          {p.is_active ? "비활성" : "활성"}
                        </button>
                        {p.role !== "admin" ? (
                          <button
                            type="button"
                            onClick={() => void handleDeleteUser(p)}
                            disabled={submitting || deletingUserId === p.id || profile?.id === p.id}
                            className="text-rose-400 hover:text-rose-300 text-xs font-medium disabled:opacity-50"
                          >
                            {deletingUserId === p.id ? "삭제…" : "삭제"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <h3 className="text-sm font-semibold text-slate-200 mb-3 border-t border-slate-700 pt-6">사용자 추가</h3>
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
              className="min-w-[8.5rem] px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
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
          추가된 사용자는 설정한 초기 비밀번호로 로그인합니다. 필요 시 비밀번호 재설정 버튼으로 변경하세요. 계정 삭제는 로그인
          자격을 영구 제거합니다(비활성과 다름). 다른 업무 데이터에 연결된 계정은 DB 제약으로 삭제가 막힐 수 있습니다.
        </p>
      </section>
    </div>
  );
}
