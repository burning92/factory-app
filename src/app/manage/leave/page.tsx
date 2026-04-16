"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import ManageAnnualLeaveSection, { type ManageLeaveProfileRow } from "../ManageAnnualLeaveSection";

type OrgRow = {
  id: string;
  organization_code: string;
  name: string;
};

type LeaveProfileWithActive = ManageLeaveProfileRow & {
  is_active?: boolean;
};

export default function ManageLeavePage() {
  const { profile } = useAuth();
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [profiles, setProfiles] = useState<ManageLeaveProfileRow[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [orgRes, profileRes] = await Promise.all([
      supabase.from("organizations").select("id,organization_code,name").order("organization_code"),
      supabase
        .from("profiles")
        .select("id,login_id,display_name,organization_id,is_active,hire_date,organizations(organization_code, name)")
        .order("login_id"),
    ]);
    if (orgRes.error) {
      setError(orgRes.error.message);
      setLoading(false);
      return;
    }
    if (profileRes.error) {
      setError(profileRes.error.message);
      setLoading(false);
      return;
    }
    const numericOnly = ((orgRes.data ?? []) as OrgRow[]).filter((o) => /^\d+$/.test(o.organization_code));
    setOrgs(numericOnly);
    const activeProfiles = ((profileRes.data ?? []) as LeaveProfileWithActive[]).filter((p) => {
      if (p.is_active === false) return false;
      const loginId = String(p.login_id ?? "").trim();
      const displayName = String(p.display_name ?? "").trim();
      if (!loginId) return false;
      // 연월차 관리 목록에서는 영문 로그인 아이디(관리/테스트 계정 등) 숨김
      if (/[A-Za-z]/.test(loginId)) return false;
      const keywordTarget = `${loginId} ${displayName}`.toLowerCase();
      if (keywordTarget.includes("test") || keywordTarget.includes("테스트")) return false;
      return true;
    });
    setProfiles(activeProfiles as ManageLeaveProfileRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    load();
  }, [profile?.role, load]);

  const filteredProfiles = useMemo(
    () => (selectedOrgId ? profiles.filter((p) => p.organization_id === selectedOrgId) : profiles),
    [profiles, selectedOrgId]
  );

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
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">관리 (연월차)</h1>
        <p className="text-sm text-slate-400 mt-1">
          <Link href="/manage" className="text-cyan-400 hover:text-cyan-300">
            사용자관리로 이동
          </Link>
        </p>
      </div>

      {error ? (
        <p className="text-red-400 text-sm" role="alert">
          {error}
        </p>
      ) : null}

      <section className="rounded-xl border border-slate-700 bg-space-800/80 p-4">
        <label className="block text-xs text-slate-400 mb-1">조직 필터</label>
        <select
          value={selectedOrgId}
          onChange={(e) => setSelectedOrgId(e.target.value)}
          className="px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100"
        >
          <option value="">전체</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.organization_code}
            </option>
          ))}
        </select>
      </section>

      <ManageAnnualLeaveSection profiles={filteredProfiles} />
    </div>
  );
}
