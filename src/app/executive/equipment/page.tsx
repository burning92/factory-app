"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { loadEquipmentIssues } from "@/features/dashboard/climateAndEquipment";
import { DashboardBackLink } from "../DashboardBackLink";
import type { EquipmentIssueRow } from "@/features/dashboard/climateAndEquipment";

export default function ExecutiveEquipmentDetailPage() {
  const router = useRouter();
  const { profile, viewOrganizationCode, loading: authLoading } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const canView = profile?.role === "admin" || profile?.role === "manager";

  const [issues, setIssues] = useState<EquipmentIssueRow[]>([]);

  useEffect(() => {
    if (authLoading) return;
    if (!canView) router.replace("/");
  }, [authLoading, canView, router]);

  useEffect(() => {
    if (!canView) return;
    let c = false;
    (async () => {
      const { issues: list } = await loadEquipmentIssues(supabase, orgCode, 7);
      if (!c) setIssues(list);
    })();
    return () => {
      c = true;
    };
  }, [canView, orgCode]);

  if (!canView) return null;

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-4 md:p-6 max-w-5xl mx-auto pb-24 md:pb-8">
      <DashboardBackLink />
      <h1 className="text-lg font-semibold text-slate-100 mb-1">제조설비 점검 상세</h1>
      <p className="text-slate-500 text-sm mb-6">최근 7일 · 승인된 일지 중 부적합(X) 항목만</p>

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
