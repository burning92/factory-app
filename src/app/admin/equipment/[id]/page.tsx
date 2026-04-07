"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatEquipmentMasterListLabel } from "@/features/equipment/equipmentDisplay";
import type { EquipmentMasterRow } from "@/features/equipment/equipmentTypes";

export default function AdminEquipmentDetailPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const [row, setRow] = useState<EquipmentMasterRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.from("equipment_master").select("*").eq("id", id).maybeSingle();
    setLoading(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setRow((data as EquipmentMasterRow) ?? null);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <p className="text-slate-500 text-sm">불러오는 중…</p>;
  }
  if (err || !row) {
    return (
      <div>
        <p className="text-red-400 text-sm">{err ?? "설비를 찾을 수 없습니다."}</p>
        <Link href="/admin/equipment" className="text-cyan-400 text-sm mt-2 inline-block">
          목록으로
        </Link>
      </div>
    );
  }

  const photo = row.photo_url?.trim();
  const isRemotePhoto = photo && /^https?:\/\//i.test(photo);

  return (
    <div>
      <Link href="/admin/equipment" className="text-sm text-slate-500 hover:text-slate-300">
        ← 목록
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mt-2 mb-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">{formatEquipmentMasterListLabel(row)}</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {row.lifecycle_status ?? (row.is_active ? "운영중" : "미사용")}
            {row.dashboard_group ? ` · 대시보드 ${row.dashboard_group}` : ""}
          </p>
        </div>
        <Link
          href={`/admin/equipment/${row.id}/edit`}
          className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
        >
          수정
        </Link>
      </div>

      <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4 md:p-6 space-y-4">
        {isRemotePhoto && (
          <div className="w-full max-w-md rounded-lg overflow-hidden border border-slate-600 bg-slate-900">
            {/* eslint-disable-next-line @next/next/no-img-element -- 임의 URL(저장소·외부 링크) */}
            <img src={photo!} alt="설비 사진" className="w-full h-auto max-h-64 object-contain" />
          </div>
        )}
        {!isRemotePhoto && photo && (
          <p className="text-xs text-slate-500">
            사진 URL이 로컬 경로입니다. 브라우저에서 열기:{" "}
            <a href={photo} className="text-cyan-400 break-all">
              {photo}
            </a>
          </p>
        )}
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-slate-500">관리번호</dt>
            <dd className="text-slate-100 font-mono">{row.management_no}</dd>
          </div>
          <div>
            <dt className="text-slate-500">설비유형</dt>
            <dd className="text-slate-100">{row.equipment_type ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">표시명</dt>
            <dd className="text-slate-100">{(row.display_name ?? row.equipment_name) || "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">호기</dt>
            <dd className="text-slate-100">{row.unit_no != null ? `${row.unit_no}호` : "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">층</dt>
            <dd className="text-slate-200">{row.floor_label ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">설치장소</dt>
            <dd className="text-slate-200">{row.install_location}</dd>
          </div>
          <div>
            <dt className="text-slate-500">운영 상태</dt>
            <dd className="text-slate-200">{row.lifecycle_status ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">대시보드</dt>
            <dd className="text-slate-200">
              {row.dashboard_group ?? "없음"} · 노출 {row.dashboard_visible !== false ? "예" : "아니오"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">설치일</dt>
            <dd className="text-slate-300 tabular-nums">{row.installed_at ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">철거일</dt>
            <dd className="text-slate-300 tabular-nums">{row.removed_at ?? "—"}</dd>
          </div>
          {row.replaced_from_equipment_id && (
            <div>
              <dt className="text-slate-500">이전 설비</dt>
              <dd>
                <Link href={`/admin/equipment/${row.replaced_from_equipment_id}`} className="text-cyan-400 text-sm">
                  연결된 설비 보기
                </Link>
              </dd>
            </div>
          )}
          {row.replaced_by_equipment_id && (
            <div>
              <dt className="text-slate-500">후속 설비</dt>
              <dd>
                <Link href={`/admin/equipment/${row.replaced_by_equipment_id}`} className="text-cyan-400 text-sm">
                  연결된 설비 보기
                </Link>
              </dd>
            </div>
          )}
          <div className="sm:col-span-2">
            <dt className="text-slate-500">용도</dt>
            <dd className="text-slate-200 whitespace-pre-wrap">{row.purpose}</dd>
          </div>
          <div>
            <dt className="text-slate-500">구입일</dt>
            <dd className="text-slate-300 tabular-nums">{row.purchased_at ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">규격</dt>
            <dd className="text-slate-300">{row.specification ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">사용전압</dt>
            <dd className="text-slate-300">{row.voltage ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">공급사명</dt>
            <dd className="text-slate-300">{row.supplier_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">공급사 연락처</dt>
            <dd className="text-slate-300">{row.supplier_contact ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">제조사명</dt>
            <dd className="text-slate-300">{row.manufacturer_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">제조사 연락처</dt>
            <dd className="text-slate-300">{row.manufacturer_contact ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">비고</dt>
            <dd className="text-slate-300 whitespace-pre-wrap">{row.notes ?? "—"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
