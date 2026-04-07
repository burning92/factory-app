"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { formatEquipmentMasterListLabel } from "@/features/equipment/equipmentDisplay";
import type { EquipmentMasterRow } from "@/features/equipment/equipmentTypes";

const inputClass =
  "w-full px-3 py-2 text-sm bg-space-900 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500";

export default function AdminEquipmentListPage() {
  const { viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const [rows, setRows] = useState<EquipmentMasterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loc, setLoc] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("equipment_master")
      .select("*")
      .eq("organization_code", orgCode)
      .order("management_no", { ascending: true });
    setLoading(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setRows((data ?? []) as EquipmentMasterRow[]);
  }, [orgCode]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const l = loc.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showInactive && !r.is_active) return false;
      if (l && !r.install_location.toLowerCase().includes(l)) return false;
      if (!t) return true;
      const label = `${r.management_no} ${r.equipment_name} ${r.display_name ?? ""} ${r.equipment_type ?? ""}`.toLowerCase();
      return label.includes(t);
    });
  }, [rows, q, loc, showInactive]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">제조설비등록</h1>
          <p className="text-slate-500 text-sm mt-0.5">유형·호기·위치·운영상태 · 조직 {orgCode}</p>
        </div>
        <Link
          href="/admin/equipment/new"
          className="inline-flex items-center rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-space-900 hover:bg-cyan-400"
        >
          새 설비 등록
        </Link>
      </div>

      {err && (
        <p className="mb-4 text-sm text-red-400" role="alert">
          {err}
        </p>
      )}

      <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4 mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">관리번호·설비명 검색</label>
          <input className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="예: FP-812 또는 오븐" />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">설치장소</label>
          <input className={inputClass} value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="부분 일치" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-2 lg:col-span-2 self-end pb-2">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded border-slate-600 bg-space-900"
          />
          미사용(inactive) 설비 포함
        </label>
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      ) : filtered.length === 0 ? (
        <p className="text-slate-500 text-sm">등록된 설비가 없습니다. 새 설비 등록을 이용하세요.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700/60 bg-slate-800/30">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-slate-400">
                <th className="px-3 py-2.5 font-medium">관리번호</th>
                <th className="px-3 py-2.5 font-medium">표시명</th>
                <th className="px-3 py-2.5 font-medium">유형</th>
                <th className="px-3 py-2.5 font-medium">층·장소</th>
                <th className="px-3 py-2.5 font-medium">용도</th>
                <th className="px-3 py-2.5 font-medium">구입일</th>
                <th className="px-3 py-2.5 font-medium">운영</th>
                <th className="px-3 py-2.5 font-medium w-24">관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-slate-700/50 hover:bg-slate-800/50">
                  <td className="px-3 py-2.5 font-mono text-slate-200">{r.management_no}</td>
                  <td className="px-3 py-2.5 text-slate-200 max-w-[180px] truncate" title={(r.display_name ?? r.equipment_name) || ""}>
                    {(r.display_name ?? r.equipment_name) || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">{r.equipment_type ?? "—"}</td>
                  <td className="px-3 py-2.5 text-slate-300 max-w-[140px]">
                    {[r.floor_label, r.install_location].filter(Boolean).join(" · ") || r.install_location}
                  </td>
                  <td className="px-3 py-2.5 text-slate-400 max-w-[200px] truncate" title={r.purpose}>
                    {r.purpose}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-400">{r.purchased_at ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className={r.is_active ? "text-emerald-400" : "text-slate-500"}>
                      {r.lifecycle_status ?? (r.is_active ? "운영중" : "미사용")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-1">
                      <Link href={`/admin/equipment/${r.id}`} className="text-cyan-400 hover:text-cyan-300 text-xs">
                        상세보기
                      </Link>
                      <Link href={`/admin/equipment/${r.id}/edit`} className="text-slate-400 hover:text-slate-200 text-xs">
                        수정
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">
        목록 라벨 예:{" "}
        {formatEquipmentMasterListLabel({
          management_no: "FP-812-1-12",
          display_name: "에어컴프레셔 1호기",
          equipment_name: "에어컴프레셔",
          floor_label: "2층",
          install_location: "기계실",
        })}
      </p>
    </div>
  );
}
