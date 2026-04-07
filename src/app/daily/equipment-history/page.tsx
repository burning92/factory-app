"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { formatEquipmentMasterListLabel, summarizeText } from "@/features/equipment/equipmentDisplay";
import { canWriteEquipmentHistory } from "@/features/equipment/equipmentHistoryPermissions";
import type { EquipmentHistoryRecordRow, EquipmentHistoryUpdateRow } from "@/features/equipment/equipmentTypes";

const inputClass =
  "w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500";

export default function EquipmentHistoryListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile, viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const canWrite = canWriteEquipmentHistory(profile?.role);

  const [records, setRecords] = useState<EquipmentHistoryRecordRow[]>([]);
  const [updates, setUpdates] = useState<EquipmentHistoryUpdateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  const [filterEquip, setFilterEquip] = useState("");
  const [filterLoc, setFilterLoc] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [closure, setClosure] = useState<"all" | "ongoing" | "closed">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data: recData, error: recErr } = await supabase
      .from("equipment_history_records")
      .select("*, equipment_master(*)")
      .eq("organization_code", orgCode)
      .order("record_date", { ascending: false })
      .limit(500);
    if (recErr) {
      setLoading(false);
      setErr(recErr.message);
      return;
    }
    const list = (recData ?? []) as EquipmentHistoryRecordRow[];
    setRecords(list);
    const ids = list.map((r) => r.id);
    if (ids.length === 0) {
      setUpdates([]);
      setLoading(false);
      return;
    }
    const { data: upData, error: upErr } = await supabase
      .from("equipment_history_updates")
      .select("*")
      .in("history_record_id", ids);
    setLoading(false);
    if (upErr) {
      setErr(upErr.message);
      return;
    }
    setUpdates((upData ?? []) as EquipmentHistoryUpdateRow[]);
  }, [orgCode]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get("deleted") !== "1") return;
    setToast({ message: "삭제되었습니다." });
    router.replace("/daily/equipment-history", { scroll: false });
  }, [searchParams, router]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const updateMeta = useMemo(() => {
    const count = new Map<string, number>();
    const latest = new Map<string, EquipmentHistoryUpdateRow>();
    for (const u of updates) {
      count.set(u.history_record_id, (count.get(u.history_record_id) ?? 0) + 1);
      const cur = latest.get(u.history_record_id);
      if (!cur || u.result_date > cur.result_date || (u.result_date === cur.result_date && u.created_at > cur.created_at)) {
        latest.set(u.history_record_id, u);
      }
    }
    return { count, latest };
  }, [updates]);

  const filtered = useMemo(() => {
    return records.filter((r) => {
      const m = r.equipment_master;
      if (closure !== "all" && r.closure_status !== closure) return false;
      if (filterEquip.trim()) {
        const t = filterEquip.trim().toLowerCase();
        const label = m ? formatEquipmentMasterListLabel(m).toLowerCase() : "";
        if (!label.includes(t)) return false;
      }
      if (filterLoc.trim() && m && !m.install_location.toLowerCase().includes(filterLoc.trim().toLowerCase())) {
        return false;
      }
      if (dateFrom && r.record_date < dateFrom) return false;
      if (dateTo && r.record_date > dateTo) return false;
      return true;
    });
  }, [records, filterEquip, filterLoc, dateFrom, dateTo, closure]);

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-4 md:p-6 max-w-5xl mx-auto pb-24 md:pb-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">설비이력기록부</h1>
          <p className="text-slate-500 text-sm mt-0.5">설비별 고장·조치 정식 이력 · 조직 {orgCode}</p>
        </div>
        {canWrite && (
          <Link
            href="/daily/equipment-history/new"
            className="inline-flex rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-space-900 hover:bg-cyan-400"
          >
            새 이력 작성
          </Link>
        )}
      </div>

      {toast && (
        <div
          className={`mb-3 px-4 py-2 rounded-lg text-sm border ${
            toast.error ? "bg-red-900/30 text-red-200 border-red-500/30" : "bg-emerald-950/40 text-emerald-100 border-emerald-500/25"
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}

      {err && (
        <p className="mb-3 text-sm text-red-400" role="alert">
          {err}
        </p>
      )}

      <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4 mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">설비(관리번호·설비명)</label>
          <input className={inputClass} value={filterEquip} onChange={(e) => setFilterEquip(e.target.value)} placeholder="부분 검색" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">설치장소</label>
          <input className={inputClass} value={filterLoc} onChange={(e) => setFilterLoc(e.target.value)} placeholder="부분 일치" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">처리 상태</label>
          <select
            className={inputClass}
            value={closure}
            onChange={(e) => setClosure(e.target.value as typeof closure)}
          >
            <option value="all">전체</option>
            <option value="ongoing">진행 중</option>
            <option value="closed">완료</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">기간 시작</label>
          <input type="date" className={inputClass} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">기간 끝</label>
          <input type="date" className={inputClass} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      ) : filtered.length === 0 ? (
        <p className="text-slate-500 text-sm">이력이 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => {
            const m = r.equipment_master;
            const label = m ? formatEquipmentMasterListLabel(m) : r.equipment_id;
            const n = updateMeta.count.get(r.id) ?? 0;
            const last = updateMeta.latest.get(r.id);
            return (
              <li key={r.id}>
                <Link
                  href={`/daily/equipment-history/${r.id}`}
                  className="block rounded-xl border border-slate-700/60 bg-slate-800/30 p-4 hover:bg-slate-800/50 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200 tabular-nums">{r.record_date}</p>
                      <p className="text-slate-100 font-medium mt-0.5 truncate" title={label}>
                        {label}
                      </p>
                      <p className="text-slate-400 text-sm mt-1 line-clamp-2">{summarizeText(r.issue_detail, 80)}</p>
                    </div>
                    <div className="text-right text-xs shrink-0">
                      <p className="text-slate-500">
                        결과 <span className="text-slate-300 font-medium">{n}</span>건
                      </p>
                      {last && (
                        <p className="text-slate-500 mt-1 max-w-[200px] ml-auto line-clamp-2" title={last.result_detail}>
                          최근: {summarizeText(last.result_detail, 40)}
                        </p>
                      )}
                      <p className={`mt-1 font-medium ${r.closure_status === "closed" ? "text-emerald-400" : "text-amber-400"}`}>
                        {r.closure_status === "closed" ? "완료" : "진행 중"}
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
