"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type AccessLogRow = {
  id: string;
  created_at: string;
  login_id: string | null;
  display_name: string | null;
  role: string | null;
  event: string;
  page_path: string;
  ip_address: string | null;
};

type AuditLogRow = {
  id: string;
  created_at: string;
  actor_login_id: string | null;
  actor_display_name: string | null;
  actor_role: string | null;
  action: string;
  target_table: string;
  target_id: string | null;
  target_label: string | null;
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function AdminLogsPage() {
  const { profile, loading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(false);
  const [accessRows, setAccessRows] = useState<AccessLogRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditLogRow[]>([]);
  const [activeTab, setActiveTab] = useState<"access" | "audit">("access");
  const [keyword, setKeyword] = useState("");
  const [days, setDays] = useState(7);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoadingRows(true);
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const [accessRes, auditRes] = await Promise.all([
      supabase
        .from("access_logs")
        .select("id, created_at, login_id, display_name, role, event, page_path, ip_address")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("audit_logs")
        .select("id, created_at, actor_login_id, actor_display_name, actor_role, action, target_table, target_id, target_label")
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    if (accessRes.error) {
      setError(accessRes.error.message);
      setLoadingRows(false);
      return;
    }
    if (auditRes.error) {
      setError(auditRes.error.message);
      setLoadingRows(false);
      return;
    }

    setAccessRows((accessRes.data ?? []) as AccessLogRow[]);
    setAuditRows((auditRes.data ?? []) as AuditLogRow[]);
    setLoadingRows(false);
  }, [days]);

  useEffect(() => {
    if (loading || profile?.role !== "admin") return;
    load();
  }, [loading, profile?.role, load]);

  const filteredAccessRows = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return accessRows;
    return accessRows.filter((r) =>
      [r.login_id, r.display_name, r.page_path, r.event, r.ip_address].some((v) =>
        (v ?? "").toLowerCase().includes(k)
      )
    );
  }, [accessRows, keyword]);

  const filteredAuditRows = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return auditRows;
    return auditRows.filter((r) =>
      [r.actor_login_id, r.actor_display_name, r.action, r.target_table, r.target_id, r.target_label].some((v) =>
        (v ?? "").toLowerCase().includes(k)
      )
    );
  }, [auditRows, keyword]);

  const handleSyncGoogleSheets = useCallback(async () => {
    setSyncMessage(null);
    setSyncing(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setSyncMessage("세션이 없어 동기화를 진행할 수 없습니다.");
      setSyncing(false);
      return;
    }
    const res = await fetch("/api/admin/logs/sync-google-sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        days,
      }),
    });
    const json = (await res.json()) as {
      error?: string;
      access_count?: number;
      audit_count?: number;
      webhook_result?: string;
    };
    if (!res.ok) {
      setSyncMessage(`동기화 실패: ${json.error ?? "알 수 없는 오류"}`);
      setSyncing(false);
      return;
    }
    setSyncMessage(
      `시트 동기화 완료 · 접속 ${json.access_count ?? 0}건 / 감사 ${json.audit_count ?? 0}건`
    );
    setSyncing(false);
  }, [days]);

  if (loading || profile?.role !== "admin") {
    return (
      <div className="p-6">
        <p className="text-slate-500 text-sm">확인 중…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">로그 조회</h1>
        <p className="mt-1 text-sm text-slate-400">
          관리자 전용 페이지입니다.
          <span className="mx-2 text-slate-600">·</span>
          <Link href="/manage" className="text-cyan-400 hover:text-cyan-300">
            사용자 관리로
          </Link>
        </p>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900/45 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800/65 p-1">
            <button
              type="button"
              onClick={() => setActiveTab("access")}
              className={`rounded-md px-3 py-1.5 text-sm ${activeTab === "access" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-200"}`}
            >
              접속 로그
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("audit")}
              className={`rounded-md px-3 py-1.5 text-sm ${activeTab === "audit" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-200"}`}
            >
              감사 로그
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-md border border-slate-600/60 bg-slate-900/70 px-2.5 py-2 text-sm text-slate-200"
            >
              <option value={1}>최근 1일</option>
              <option value={3}>최근 3일</option>
              <option value={7}>최근 7일</option>
              <option value={30}>최근 30일</option>
            </select>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="아이디, 경로, 액션 검색"
              className="w-56 rounded-md border border-slate-600/60 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="button"
              onClick={load}
              className="rounded-md border border-cyan-600/40 bg-cyan-950/20 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-950/35"
            >
              새로고침
            </button>
            <button
              type="button"
              onClick={handleSyncGoogleSheets}
              disabled={syncing}
              className="rounded-md border border-emerald-600/40 bg-emerald-950/20 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-950/35 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncing ? "시트 동기화 중…" : "구글시트 동기화"}
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {syncMessage && <p className="mt-2 text-sm text-emerald-300">{syncMessage}</p>}
      </div>

      {activeTab === "access" ? (
        <div className="overflow-x-auto rounded-xl border border-slate-700/60">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="bg-slate-800/65 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2.5">시간</th>
                <th className="px-3 py-2.5">아이디</th>
                <th className="px-3 py-2.5">이름</th>
                <th className="px-3 py-2.5">역할</th>
                <th className="px-3 py-2.5">이벤트</th>
                <th className="px-3 py-2.5">경로</th>
                <th className="px-3 py-2.5">IP</th>
              </tr>
            </thead>
            <tbody>
              {loadingRows ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                    불러오는 중…
                  </td>
                </tr>
              ) : filteredAccessRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                    데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                filteredAccessRows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800/80 text-slate-300">
                    <td className="px-3 py-2.5 tabular-nums text-slate-400">{formatDateTime(r.created_at)}</td>
                    <td className="px-3 py-2.5 font-mono">{r.login_id ?? "—"}</td>
                    <td className="px-3 py-2.5">{r.display_name ?? "—"}</td>
                    <td className="px-3 py-2.5">{r.role ?? "—"}</td>
                    <td className="px-3 py-2.5">{r.event}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-400">{r.page_path}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-500">{r.ip_address ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700/60">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="bg-slate-800/65 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2.5">시간</th>
                <th className="px-3 py-2.5">아이디</th>
                <th className="px-3 py-2.5">이름</th>
                <th className="px-3 py-2.5">역할</th>
                <th className="px-3 py-2.5">액션</th>
                <th className="px-3 py-2.5">대상</th>
                <th className="px-3 py-2.5">대상 ID</th>
                <th className="px-3 py-2.5">설명</th>
              </tr>
            </thead>
            <tbody>
              {loadingRows ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                    불러오는 중…
                  </td>
                </tr>
              ) : filteredAuditRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                    데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                filteredAuditRows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800/80 text-slate-300">
                    <td className="px-3 py-2.5 tabular-nums text-slate-400">{formatDateTime(r.created_at)}</td>
                    <td className="px-3 py-2.5 font-mono">{r.actor_login_id ?? "—"}</td>
                    <td className="px-3 py-2.5">{r.actor_display_name ?? "—"}</td>
                    <td className="px-3 py-2.5">{r.actor_role ?? "—"}</td>
                    <td className="px-3 py-2.5">{r.action}</td>
                    <td className="px-3 py-2.5 font-mono">{r.target_table}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-400">{r.target_id ?? "—"}</td>
                    <td className="px-3 py-2.5">{r.target_label ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
