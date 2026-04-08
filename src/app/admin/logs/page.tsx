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

type AuditDisplayRow = AuditLogRow & {
  summary_count?: number;
  is_summary?: boolean;
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

function actionLabel(action: string): string {
  switch (action) {
    case "create":
      return "작성";
    case "update":
      return "수정";
    case "delete":
      return "삭제";
    default:
      return action;
  }
}

function targetTableLabel(targetTable: string): string {
  const map: Record<string, string> = {
    daily_hygiene_logs: "영업장 환경위생 일지",
    daily_hygiene_log_items: "영업장 환경위생 항목",
    daily_temp_humidity_logs: "온습도 일지",
    daily_temp_humidity_log_items: "온습도 항목",
    daily_sanitation_facility_logs: "위생시설 점검일지",
    daily_sanitation_facility_log_items: "위생시설 항목",
    daily_worker_hygiene_logs: "작업자 위생 점검일지",
    daily_worker_hygiene_log_items: "작업자 위생 항목",
    daily_cold_storage_hygiene_logs: "냉장냉동 위생 일지",
    daily_cold_storage_hygiene_log_items: "냉장냉동 위생 항목",
    daily_process_control_bread_logs: "공정관리(빵류) 일지",
    daily_process_control_bread_log_items: "공정관리(빵류) 항목",
    daily_illumination_logs: "조도 점검일지",
    daily_illumination_log_items: "조도 점검 항목",
    daily_material_storage_3f_logs: "원부자재 창고 점검일지",
    daily_material_storage_3f_log_items: "원부자재 창고 점검 항목",
    daily_manufacturing_equipment_logs: "제조설비 점검일지",
    daily_manufacturing_equipment_log_items: "제조설비 점검 항목",
    daily_air_conditioning_equipment_logs: "공조설비 점검일지",
    daily_air_conditioning_equipment_log_items: "공조설비 점검 항목",
    daily_hoist_inspection_logs: "호이스트 점검일지",
    daily_hoist_inspection_log_items: "호이스트 점검 항목",
    daily_material_receiving_inspection_logs: "원료 입고검수 일지",
    daily_material_receiving_inspection_log_items: "원료 입고검수 항목",
    daily_raw_thawing_logs: "원료 해동 일지",
    usage_calculations: "원료 사용량",
    dough_logs: "반죽 사용량",
    production_logs: "원부자재 출고 입력",
  };
  return map[targetTable] ?? targetTable;
}

function pathLabel(path: string): string {
  if (path === "/") return "홈";
  if (path === "/executive") return "대시보드";
  if (path.startsWith("/executive/")) return `대시보드 상세 (${path.replace("/executive/", "")})`;
  if (path === "/daily") return "데일리 허브";
  if (path.startsWith("/daily/")) return `데일리 (${path.replace("/daily/", "")})`;
  if (path === "/production") return "생산 허브";
  if (path.startsWith("/production/")) return `생산 (${path.replace("/production/", "")})`;
  if (path.startsWith("/materials/") || path === "/materials") return `원부자재 (${path.replace("/materials", "").replace(/^\//, "") || "허브"})`;
  return path;
}

function summarizeAuditRows(rows: AuditLogRow[]): AuditDisplayRow[] {
  const out: AuditDisplayRow[] = [];
  const itemTableSet = new Set([
    "daily_hygiene_log_items",
    "daily_temp_humidity_log_items",
    "daily_sanitation_facility_log_items",
    "daily_worker_hygiene_log_items",
    "daily_cold_storage_hygiene_log_items",
    "daily_process_control_bread_log_items",
    "daily_illumination_log_items",
    "daily_material_storage_3f_log_items",
    "daily_manufacturing_equipment_log_items",
    "daily_air_conditioning_equipment_log_items",
    "daily_hoist_inspection_log_items",
    "daily_material_receiving_inspection_log_items",
  ]);
  const grouped = new Map<string, AuditDisplayRow[]>();

  for (const r of rows) {
    if (!itemTableSet.has(r.target_table) || r.action !== "create") {
      out.push(r);
      continue;
    }
    const k = `${r.created_at}|${r.actor_login_id ?? ""}|${r.action}|${r.target_table}`;
    const arr = grouped.get(k) ?? [];
    arr.push(r);
    grouped.set(k, arr);
  }

  for (const arr of Array.from(grouped.values())) {
    const first = arr[0]!;
    if (arr.length <= 1) {
      out.push(first);
      continue;
    }
    out.push({
      ...first,
      id: `${first.id}-summary`,
      target_id: null,
      target_label: `항목 ${arr.length}건 일괄 생성`,
      summary_count: arr.length,
      is_summary: true,
    });
  }

  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
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
  const [showAuditDetails, setShowAuditDetails] = useState(false);

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

  const displayAuditRows = useMemo(() => {
    if (showAuditDetails) return filteredAuditRows.map((r) => ({ ...r }));
    return summarizeAuditRows(filteredAuditRows);
  }, [filteredAuditRows, showAuditDetails]);

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
          {activeTab === "audit" && (
            <label className="inline-flex items-center gap-2 rounded-md border border-slate-700/70 bg-slate-900/55 px-2.5 py-1.5 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={showAuditDetails}
                onChange={(e) => setShowAuditDetails(e.target.checked)}
                className="h-3.5 w-3.5 accent-cyan-500"
              />
              세부 행 보기
            </label>
          )}
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
                    <td className="px-3 py-2.5 text-slate-300">{pathLabel(r.page_path)}</td>
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
              ) : displayAuditRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                    데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                displayAuditRows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800/80 text-slate-300">
                    <td className="px-3 py-2.5 tabular-nums text-slate-400">{formatDateTime(r.created_at)}</td>
                    <td className="px-3 py-2.5 font-mono">{r.actor_login_id ?? "—"}</td>
                    <td className="px-3 py-2.5">{r.actor_display_name ?? "—"}</td>
                    <td className="px-3 py-2.5">{r.actor_role ?? "—"}</td>
                    <td className="px-3 py-2.5">{actionLabel(r.action)}</td>
                    <td className="px-3 py-2.5">{targetTableLabel(r.target_table)}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-400">{r.target_id ?? "—"}</td>
                    <td className={`px-3 py-2.5 ${"is_summary" in r && r.is_summary ? "font-semibold text-cyan-300/90" : ""}`}>
                      {r.target_label ?? "—"}
                    </td>
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
