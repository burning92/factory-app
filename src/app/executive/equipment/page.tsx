"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { loadEquipmentIssues } from "@/features/dashboard/climateAndEquipment";
import { loadLastInspectionNonconformDate } from "@/features/daily/equipmentIncidents";
import {
  loadExecutiveEquipmentGroupDetail,
  type ExecutiveEquipmentGroupDetail,
  type ExecutiveEquipmentHistoryDetail,
} from "@/features/equipment/executiveEquipmentHistory";
import { canRegisterEquipmentIncident } from "@/features/daily/equipmentIncidentPermissions";
import { DashboardBackLink } from "../DashboardBackLink";
import type { EquipmentIssueRow } from "@/features/dashboard/climateAndEquipment";

function DetailBlock({ d, lastInspection }: { d: ExecutiveEquipmentHistoryDetail; lastInspection: string | null }) {
  return (
    <div className="rounded-lg border border-slate-700/40 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-cyan-200/95 leading-snug line-clamp-2" title={d.displayTitle}>
            {d.displayTitle}
          </h3>
          <p className="mt-1 text-[11px] text-slate-500">
            {d.lifecycleStatus}
            {d.floorLabel ? ` · ${d.floorLabel}` : ""}
          </p>
        </div>
        {d.recentHighImpact && (
          <span className="shrink-0 rounded border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
            최근 고장·진행 주의
          </span>
        )}
      </div>

      <dl className="space-y-2 text-sm text-slate-400">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-slate-500">정기점검 최근 부적합일</dt>
          <dd className="font-medium text-slate-300 tabular-nums">{lastInspection ?? "—"}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-slate-500">마지막 고장/중지 일자</dt>
          <dd className="font-medium text-slate-300 tabular-nums">{d.lastFaultOrStopAt ?? "—"}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-slate-500">무고장 경과</dt>
          <dd className="font-medium text-slate-300 tabular-nums">
            {d.daysWithoutFault != null ? `${d.daysWithoutFault}일` : "—"}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2 items-baseline">
          <dt className="text-slate-500">현재 처리상태</dt>
          <dd
            className={`font-semibold ${
              d.statusLabel === "진행 중"
                ? "text-amber-200"
                : d.statusLabel === "조치 완료"
                  ? "text-emerald-300"
                  : "text-slate-500"
            }`}
          >
            {d.statusLabel}
          </dd>
        </div>
        {d.latestIssueLine && (
          <div className="pt-1">
            <dt className="text-slate-500 mb-0.5">최근 고장내용</dt>
            <dd className="text-slate-200 text-sm leading-snug line-clamp-2">{d.latestIssueLine}</dd>
          </div>
        )}
      </dl>

      {d.recentUpdateLines.length > 0 && (
        <div className="mt-3 border-t border-slate-700/40 pt-3">
          <p className="text-[11px] font-semibold text-slate-500 mb-1.5">최근 결과 추가</p>
          <ul className="space-y-2 text-xs text-slate-400">
            {d.recentUpdateLines.map((u, i) => (
              <li key={`${u.result_date}-${i}`} className="rounded bg-slate-800/50 px-2 py-1.5">
                <span className="tabular-nums text-slate-500">{u.result_date}</span>
                <span className="mx-1.5 text-slate-600">·</span>
                <span className="text-slate-300">{u.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d.recentRecords.length > 0 && (
        <div className="mt-3 border-t border-slate-700/40 pt-3">
          <p className="text-[11px] font-semibold text-slate-500 mb-1.5">최근 이력 (최대 5건)</p>
          <ul className="space-y-2 text-xs">
            {d.recentRecords.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/daily/equipment-history/${r.id}`}
                  className="block rounded bg-slate-800/40 px-2 py-1.5 hover:bg-slate-800/70 transition-colors"
                >
                  <span className="tabular-nums text-slate-500">{r.record_date}</span>
                  <span className="mx-1.5 text-slate-600">·</span>
                  <span className="text-slate-300">{r.issue_summary}</span>
                  <span className="mx-1.5 text-slate-600">·</span>
                  <span className="text-slate-500">{r.closure_status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function GroupSection({
  title,
  detail,
  lastInspection,
}: {
  title: "화덕" | "호이스트";
  detail: ExecutiveEquipmentGroupDetail;
  lastInspection: string | null;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-slate-200 border-b border-slate-700/50 pb-1">{title}</h3>
      {detail.operating.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 mb-2">현재 운영·예비 설비</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {detail.operating.map((d) => (
              <DetailBlock key={d.masterId ?? d.displayTitle} d={d} lastInspection={lastInspection} />
            ))}
          </div>
        </div>
      )}
      {detail.past.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 mb-2">과거 설비 (사용중지·철거 등)</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {detail.past.map((d) => (
              <DetailBlock key={d.masterId ?? d.displayTitle} d={d} lastInspection={lastInspection} />
            ))}
          </div>
        </div>
      )}
      {detail.operating.length === 0 && detail.past.length === 0 && (
        <p className="text-sm text-slate-500">이 그룹에 등록된 설비가 없습니다. 제조설비 마스터의 대시보드 그룹을 확인하세요.</p>
      )}
    </div>
  );
}

export default function ExecutiveEquipmentDetailPage() {
  const router = useRouter();
  const { profile, viewOrganizationCode, loading: authLoading } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const canView = !!profile;
  const canRegisterIncident = canRegisterEquipmentIncident(profile?.role);

  const [issues, setIssues] = useState<EquipmentIssueRow[]>([]);
  const [historyDetail, setHistoryDetail] = useState<{
    화덕: ExecutiveEquipmentGroupDetail;
    호이스트: ExecutiveEquipmentGroupDetail;
  } | null>(null);
  const [lastInspection, setLastInspection] = useState<{ 화덕: string | null; 호이스트: string | null } | null>(
    null
  );

  useEffect(() => {
    if (authLoading) return;
    if (!canView) router.replace("/");
  }, [authLoading, canView, router]);

  useEffect(() => {
    if (!canView) return;
    let c = false;
    (async () => {
      const { issues: list } = await loadEquipmentIssues(supabase, orgCode, 7);
      const [d1, d2, oven, hoist] = await Promise.all([
        loadLastInspectionNonconformDate(supabase, orgCode, "화덕"),
        loadLastInspectionNonconformDate(supabase, orgCode, "호이스트"),
        loadExecutiveEquipmentGroupDetail(supabase, orgCode, "화덕"),
        loadExecutiveEquipmentGroupDetail(supabase, orgCode, "호이스트"),
      ]);
      if (c) return;
      setIssues(list);
      setLastInspection({ 화덕: d1, 호이스트: d2 });
      setHistoryDetail({ 화덕: oven, 호이스트: hoist });
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
          <p className="text-slate-500 text-sm">
            최근 7일 · 승인 일지 부적합(X)과, 설비이력기록부(마스터 대시보드 그룹·개별 설비 ID 기준)
          </p>
        </div>
        <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:justify-end sm:overflow-visible sm:px-0 sm:pb-0">
          <Link
            href="/daily/equipment-history"
            className="shrink-0 whitespace-nowrap rounded-lg border border-cyan-500/40 bg-cyan-950/25 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-950/40"
          >
            설비이력기록부
          </Link>
          {canRegisterIncident && (
            <Link
              href="/daily/manufacturing-equipment/incident/new"
              className="shrink-0 whitespace-nowrap rounded-lg border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-950/50"
            >
              설비 이상 등록
            </Link>
          )}
          <Link
            href="/daily/manufacturing-equipment/incidents"
            className="shrink-0 whitespace-nowrap rounded-lg border border-slate-600/70 bg-slate-900/50 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800/80"
          >
            설비 이상 이력
          </Link>
        </div>
      </div>

      {historyDetail && lastInspection && (
        <section className="mb-8 rounded-xl border border-slate-700/50 bg-slate-800/40 p-5 space-y-8">
          <div>
            <h2 className="text-sm font-semibold text-slate-200 mb-1">주요 설비 (설비이력기록부)</h2>
            <p className="text-xs text-slate-500">
              마스터의 대시보드 그룹으로 화덕·호이스트를 나누고, 개별 설비(호기)별로 이력을 집계합니다. 정기점검 부적합일은
              일지(화덕/호이스트 항목) 기준입니다.
            </p>
          </div>
          <GroupSection title="화덕" detail={historyDetail.화덕} lastInspection={lastInspection.화덕} />
          <GroupSection title="호이스트" detail={historyDetail.호이스트} lastInspection={lastInspection.호이스트} />
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
