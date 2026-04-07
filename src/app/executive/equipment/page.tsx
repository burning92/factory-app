"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { loadEquipmentIssues } from "@/features/dashboard/climateAndEquipment";
import {
  loadLastInspectionNonconformDate,
  loadMajorEquipmentIncidentStats,
  loadRecentIncidentsForEquipment,
  type EquipmentIncidentRow,
  type MajorEquipmentIncidentStats,
} from "@/features/daily/equipmentIncidents";
import { DashboardBackLink } from "../DashboardBackLink";
import type { EquipmentIssueRow } from "@/features/dashboard/climateAndEquipment";

export default function ExecutiveEquipmentDetailPage() {
  const router = useRouter();
  const { profile, viewOrganizationCode, loading: authLoading } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const canView = profile?.role === "admin" || profile?.role === "manager";

  const [issues, setIssues] = useState<EquipmentIssueRow[]>([]);
  const [majorStats, setMajorStats] = useState<{
    화덕: MajorEquipmentIncidentStats;
    호이스트: MajorEquipmentIncidentStats;
  } | null>(null);
  const [lastInspection, setLastInspection] = useState<{ 화덕: string | null; 호이스트: string | null } | null>(
    null
  );
  const [recentIncidents, setRecentIncidents] = useState<{
    화덕: EquipmentIncidentRow[];
    호이스트: EquipmentIncidentRow[];
  } | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!canView) router.replace("/");
  }, [authLoading, canView, router]);

  useEffect(() => {
    if (!canView) return;
    let c = false;
    (async () => {
      const { issues: list } = await loadEquipmentIssues(supabase, orgCode, 7);
      const [stats, d1, d2, rHoist, rOven] = await Promise.all([
        loadMajorEquipmentIncidentStats(supabase, orgCode),
        loadLastInspectionNonconformDate(supabase, orgCode, "화덕"),
        loadLastInspectionNonconformDate(supabase, orgCode, "호이스트"),
        loadRecentIncidentsForEquipment(supabase, orgCode, "호이스트", 5),
        loadRecentIncidentsForEquipment(supabase, orgCode, "화덕", 5),
      ]);
      if (c) return;
      setIssues(list);
      setMajorStats(stats);
      setLastInspection({ 화덕: d1, 호이스트: d2 });
      setRecentIncidents({ 화덕: rOven, 호이스트: rHoist });
    })();
    return () => {
      c = true;
    };
  }, [canView, orgCode]);

  if (!canView) return null;

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-4 md:p-6 max-w-5xl mx-auto pb-24 md:pb-8">
      <DashboardBackLink />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100 mb-1">제조설비 점검 상세</h1>
          <p className="text-slate-500 text-sm">최근 7일 · 승인된 일지 중 부적합(X) 항목과 주요 설비 이상 이력</p>
        </div>
        <Link
          href="/daily/manufacturing-equipment/incident/new"
          className="shrink-0 rounded-lg border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-950/50"
        >
          설비 이상 등록
        </Link>
      </div>

      {majorStats && lastInspection && (
        <section className="mb-8 rounded-xl border border-slate-700/50 bg-slate-800/40 p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">주요 설비 최근 이력</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {(["화덕", "호이스트"] as const).map((name) => {
              const s = majorStats[name];
              const li = lastInspection[name];
              const recent = recentIncidents?.[name] ?? [];
              return (
                <div key={name} className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-base font-bold text-cyan-200/95">{name}</h3>
                    {s.recentHighImpact && (
                      <span className="rounded border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                        생산영향·고장/가동중지 주의
                      </span>
                    )}
                  </div>
                  <dl className="space-y-2 text-sm text-slate-400">
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-slate-500">정기점검 최근 부적합일</dt>
                      <dd className="font-medium text-slate-300 tabular-nums">{li ?? "—"}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-slate-500">마지막 이상일(등록)</dt>
                      <dd className="font-medium text-slate-300 tabular-nums">{s.lastIncidentAt ?? "등록 없음"}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="text-slate-500">무고장 경과</dt>
                      <dd className="font-medium text-slate-300 tabular-nums">
                        {s.daysWithoutFault != null ? `${s.daysWithoutFault}일` : "고장·가동중지 이력 없음"}
                      </dd>
                    </div>
                  </dl>
                  {recent.length > 0 && (
                    <ul className="mt-4 space-y-2 border-t border-slate-700/40 pt-3 text-xs text-slate-500">
                      {recent.map((r) => (
                        <li key={r.id} className="rounded bg-slate-800/50 px-2 py-1.5">
                          <span className="tabular-nums text-slate-400">{String(r.occurred_at).slice(0, 10)}</span>
                          <span className="mx-1.5 text-slate-600">·</span>
                          <span className="text-slate-300">{r.incident_type}</span>
                          <span className="mx-1.5 text-slate-600">·</span>
                          조치 {r.action_status}
                          <span className="mx-1.5 text-slate-600">·</span>
                          생산영향 {r.has_production_impact ? "있음" : "없음"}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <h2 className="text-sm font-semibold text-slate-300 mb-3">최근 7일 부적합 항목</h2>
      {issues.length === 0 ? (
        <p className="text-emerald-300/90 text-sm">부적합 항목이 없습니다.</p>
      ) : (
        <ul className="space-y-3">
          {issues.map((it, i) => (
            <li
              key={`${it.inspectionDate}-${i}`}
              className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-4 text-sm text-slate-300"
            >
              <div className="flex flex-wrap gap-2 text-xs text-slate-500 mb-2">
                <span className="font-mono">{it.inspectionDate}</span>
                {it.category && <span>· {it.category}</span>}
              </div>
              <p className="text-slate-200 font-medium mb-1">{it.questionText || "항목"}</p>
              <p className="text-slate-400 whitespace-pre-wrap">{it.note}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
