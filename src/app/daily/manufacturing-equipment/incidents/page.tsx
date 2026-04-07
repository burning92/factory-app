"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  listEquipmentIncidents,
  productionImpactLabel,
  sourceTypeLabel,
  type EquipmentIncidentListFilters,
  type EquipmentIncidentRow,
  type EquipmentIncidentType,
  type EquipmentActionStatus,
  type EquipmentIncidentEquipment,
} from "@/features/daily/equipmentIncidents";

function formatOccurred(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

const EQUIP_FILTER: Array<{ v: EquipmentIncidentListFilters["equipment"]; label: string }> = [
  { v: "all", label: "전체" },
  { v: "화덕", label: "화덕" },
  { v: "호이스트", label: "호이스트" },
  { v: "기타", label: "기타" },
];

const TYPE_FILTER: Array<{ v: EquipmentIncidentListFilters["incidentType"]; label: string }> = [
  { v: "all", label: "전체" },
  { v: "이상", label: "이상" },
  { v: "고장", label: "고장" },
  { v: "가동중지", label: "가동중지" },
];

const ACTION_FILTER: Array<{ v: EquipmentIncidentListFilters["actionStatus"]; label: string }> = [
  { v: "all", label: "전체" },
  { v: "확인중", label: "확인중" },
  { v: "수리요청", label: "수리요청" },
  { v: "수리중", label: "수리중" },
  { v: "조치완료", label: "조치완료" },
];

const IMPACT_FILTER: Array<{ v: EquipmentIncidentListFilters["productionImpact"]; label: string }> = [
  { v: "all", label: "전체" },
  { v: "yes", label: "있음" },
  { v: "no", label: "없음" },
];

export default function EquipmentIncidentsListPage() {
  const { viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";

  const [filters, setFilters] = useState<EquipmentIncidentListFilters>({
    equipment: "all",
    incidentType: "all",
    actionStatus: "all",
    productionImpact: "all",
  });
  const [rows, setRows] = useState<EquipmentIncidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorMap, setAuthorMap] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const list = await listEquipmentIncidents(supabase, orgCode, filters);
    setRows(list);
    const ids = Array.from(new Set(list.map((r) => r.created_by).filter((x): x is string => !!x)));
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name, login_id")
        .in("id", ids);
      const m: Record<string, string> = {};
      for (const p of profs ?? []) {
        const row = p as { id: string; display_name: string | null; login_id: string | null };
        const name = (row.display_name ?? "").trim() || (row.login_id ?? "").trim() || "—";
        m[row.id] = name;
      }
      setAuthorMap(m);
    } else {
      setAuthorMap({});
    }
    setLoading(false);
  }, [orgCode, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const filterBar = useMemo(
    () => (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <label className="block text-xs text-slate-500">
          설비명
          <select
            value={filters.equipment}
            onChange={(e) =>
              setFilters((f) => ({ ...f, equipment: e.target.value as EquipmentIncidentEquipment | "all" }))
            }
            className="mt-1 w-full px-2 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
          >
            {EQUIP_FILTER.map((o) => (
              <option key={o.label} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-500">
          구분
          <select
            value={filters.incidentType}
            onChange={(e) =>
              setFilters((f) => ({ ...f, incidentType: e.target.value as EquipmentIncidentType | "all" }))
            }
            className="mt-1 w-full px-2 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
          >
            {TYPE_FILTER.map((o) => (
              <option key={o.label} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-500">
          조치상태
          <select
            value={filters.actionStatus}
            onChange={(e) =>
              setFilters((f) => ({ ...f, actionStatus: e.target.value as EquipmentActionStatus | "all" }))
            }
            className="mt-1 w-full px-2 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
          >
            {ACTION_FILTER.map((o) => (
              <option key={o.label} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-500">
          생산영향
          <select
            value={filters.productionImpact}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                productionImpact: e.target.value as EquipmentIncidentListFilters["productionImpact"],
              }))
            }
            className="mt-1 w-full px-2 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-100 text-sm"
          >
            {IMPACT_FILTER.map((o) => (
              <option key={o.label} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    ),
    [filters]
  );

  return (
    <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-6xl mx-auto pb-24 md:pb-8">
      <div className="flex items-center gap-2 mb-4 text-sm">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200">
          데일리
        </Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/manufacturing-equipment" className="text-slate-400 hover:text-slate-200">
          제조설비 점검표
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">설비 이상 이력</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">설비 이상 이력</h1>
          <p className="text-slate-500 text-sm mt-0.5">등록된 이상·고장·가동중지 기록을 최신순으로 표시합니다.</p>
        </div>
        <Link
          href="/daily/manufacturing-equipment/incident/new"
          className="shrink-0 rounded-lg border border-amber-600/40 bg-amber-950/25 px-3 py-2 text-center text-sm font-medium text-amber-200 hover:bg-amber-950/40"
        >
          설비 이상 등록
        </Link>
      </div>

      {filterBar}

      {loading ? (
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 border border-dashed border-slate-600 rounded-xl text-center">
          등록된 설비 이상 이력이 없습니다.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700/60 bg-slate-800/40">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/60 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">
                <th className="px-3 py-2.5 whitespace-nowrap">발생일시</th>
                <th className="px-3 py-2.5 whitespace-nowrap">설비명</th>
                <th className="px-3 py-2.5 whitespace-nowrap">구분</th>
                <th className="px-3 py-2.5 whitespace-nowrap hidden md:table-cell">증상유형</th>
                <th className="px-3 py-2.5 whitespace-nowrap">생산영향</th>
                <th className="px-3 py-2.5 whitespace-nowrap">조치상태</th>
                <th className="px-3 py-2.5 whitespace-nowrap hidden lg:table-cell">등록</th>
                <th className="px-3 py-2.5 whitespace-nowrap hidden sm:table-cell">작성자</th>
                <th className="px-3 py-2.5 whitespace-nowrap text-right">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {rows.map((r) => {
                const equipLabel =
                  r.equipment_name === "기타" && r.equipment_custom_name
                    ? `기타 (${r.equipment_custom_name})`
                    : r.equipment_name;
                return (
                  <tr key={r.id} className="hover:bg-slate-800/60">
                    <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap align-top">
                      {formatOccurred(r.occurred_at)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-200 align-top">{equipLabel}</td>
                    <td className="px-3 py-2.5 text-slate-300 align-top">{r.incident_type}</td>
                    <td className="px-3 py-2.5 text-slate-400 align-top hidden md:table-cell">
                      {r.symptom_type === "기타" && r.symptom_other ? `${r.symptom_type}(${r.symptom_other})` : r.symptom_type}
                    </td>
                    <td className="px-3 py-2.5 text-slate-300 align-top">{productionImpactLabel(r.has_production_impact)}</td>
                    <td className="px-3 py-2.5 text-slate-300 align-top">{r.action_status}</td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs align-top hidden lg:table-cell">
                      {sourceTypeLabel(r.source_type)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400 align-top hidden sm:table-cell">
                      {r.created_by ? authorMap[r.created_by] ?? "—" : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top whitespace-nowrap">
                      <Link
                        href={`/daily/manufacturing-equipment/incidents/${r.id}`}
                        className="text-cyan-400 hover:text-cyan-300 text-xs font-medium mr-2"
                      >
                        상세
                      </Link>
                      <Link
                        href={`/daily/manufacturing-equipment/incidents/${r.id}/edit`}
                        className="text-amber-400/90 hover:text-amber-300 text-xs font-medium"
                      >
                        수정
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
