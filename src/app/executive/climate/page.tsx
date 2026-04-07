"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { loadClimateSummary } from "@/features/dashboard/climateAndEquipment";
import { DashboardBackLink } from "../DashboardBackLink";
import type { ClimateSummary } from "@/features/dashboard/climateAndEquipment";

export default function ExecutiveClimateDetailPage() {
  const router = useRouter();
  const { profile, viewOrganizationCode, loading: authLoading } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const canView = !!profile;

  const [data, setData] = useState<ClimateSummary | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!canView) router.replace("/");
  }, [authLoading, canView, router]);

  useEffect(() => {
    if (!canView) return;
    let c = false;
    (async () => {
      const s = await loadClimateSummary(supabase, orgCode, 7);
      if (!c) setData(s);
    })();
    return () => {
      c = true;
    };
  }, [canView, orgCode]);

  if (!canView) return null;

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] p-4 md:p-6 max-w-5xl mx-auto pb-24 md:pb-8">
      <DashboardBackLink />
      <h1 className="text-lg font-semibold text-slate-100 mb-1">온·습도 상세</h1>
      <p className="text-slate-500 text-sm mb-6">최근 7일 · 승인된 영업장 온습도 점검일지</p>

      {data && data.dayCount === 0 && (
        <p className="text-slate-500 text-sm">해당 기간 승인 일지가 없습니다.</p>
      )}

      {data && data.dayCount > 0 && (
        <>
          <section className="rounded-lg border border-slate-700/60 bg-slate-800/40 p-4 mb-6 text-sm text-slate-300">
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <dt className="text-slate-500 text-xs">전체 평균 온도</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {data.overallAvgTemp != null ? `${data.overallAvgTemp.toFixed(1)}°C` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs">전체 평균 습도</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {data.overallAvgHumidity != null ? `${data.overallAvgHumidity.toFixed(1)}%` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs">구역 평균 온도 최고</dt>
                <dd>{data.hottestZone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs">구역 평균 온도 최저</dt>
                <dd>{data.coolestZone ?? "—"}</dd>
              </div>
            </dl>
            <p className="text-xs text-slate-600 mt-3">점검일 수 (중복일 제외): {data.dayCount}일</p>
          </section>

          <div className="overflow-x-auto rounded-lg border border-slate-700/60">
            <table className="w-full text-sm text-left text-slate-300">
              <thead className="bg-slate-800/80 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-3 py-2">구역</th>
                  <th className="px-3 py-2 text-right">평균 온도</th>
                  <th className="px-3 py-2 text-right">최고</th>
                  <th className="px-3 py-2 text-right">최저</th>
                  <th className="px-3 py-2 text-right">평균 습도</th>
                  <th className="px-3 py-2 text-right">샘플 수</th>
                </tr>
              </thead>
              <tbody>
                {data.zones.map((z) => (
                  <tr key={z.zoneName} className="border-t border-slate-700/50">
                    <td className="px-3 py-2">{z.zoneName}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {z.avgTemp != null ? `${z.avgTemp.toFixed(1)}°C` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {z.maxTemp != null ? `${z.maxTemp.toFixed(1)}°C` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {z.minTemp != null ? `${z.minTemp.toFixed(1)}°C` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {z.avgHumidity != null ? `${z.avgHumidity.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{z.sampleCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
