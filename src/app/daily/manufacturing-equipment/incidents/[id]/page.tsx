"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  getEquipmentIncidentById,
  productionImpactLabel,
  sourceTypeLabel,
  type EquipmentIncidentRow,
} from "@/features/daily/equipmentIncidents";
function formatDt(iso: string | null): string {
  if (!iso) return "미입력";
  try {
    return new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function notesDisplay(n: string | null): string {
  if (n == null || !n.trim()) return "없음";
  return n;
}

export default function EquipmentIncidentDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const { viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const showEditDisabledBanner = searchParams.get("edit") === "disabled";

  const [row, setRow] = useState<EquipmentIncidentRow | null>(null);
  const [authorLabel, setAuthorLabel] = useState<string>("—");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setError("ID가 없습니다.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { row: r, error: e } = await getEquipmentIncidentById(supabase, id, orgCode);
    if (e || !r) {
      setError(e?.message ?? "데이터를 찾을 수 없습니다.");
      setRow(null);
    } else {
      setRow(r);
      if (r.created_by) {
        const { data: p } = await supabase
          .from("profiles")
          .select("display_name, login_id")
          .eq("id", r.created_by)
          .maybeSingle();
        if (p) {
          const pr = p as { display_name: string | null; login_id: string | null };
          setAuthorLabel((pr.display_name ?? "").trim() || (pr.login_id ?? "").trim() || "—");
        } else {
          setAuthorLabel("—");
        }
      } else {
        setAuthorLabel("—");
      }
    }
    setLoading(false);
  }, [id, orgCode]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-slate-500 text-sm">불러오는 중…</p>
      </div>
    );
  }

  if (error || !row) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-red-400 text-sm mb-4">{error ?? "오류"}</p>
        <Link href="/daily/manufacturing-equipment/incidents" className="text-cyan-400 hover:text-cyan-300 text-sm">
          목록으로
        </Link>
      </div>
    );
  }

  const equipLabel =
    row.equipment_name === "기타" && row.equipment_custom_name
      ? `기타 (${row.equipment_custom_name})`
      : row.equipment_name;

  return (
    <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto pb-24 md:pb-8">
      <div className="flex items-center gap-2 mb-4 text-sm">
        <Link href="/daily" className="text-slate-400 hover:text-slate-200">
          데일리
        </Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/manufacturing-equipment" className="text-slate-400 hover:text-slate-200">
          제조설비 점검표
        </Link>
        <span className="text-slate-600">/</span>
        <Link href="/daily/manufacturing-equipment/incidents" className="text-slate-400 hover:text-slate-200">
          설비 이상 이력
        </Link>
        <span className="text-slate-600">/</span>
        <span className="text-slate-200 font-medium">상세</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <h1 className="text-lg font-semibold text-slate-100">설비 이상 상세</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <span
            className="px-4 py-2 rounded-lg border border-slate-700/80 bg-slate-800/50 text-slate-500 text-sm font-medium cursor-not-allowed"
            title="현재 수정 기능은 비활성화되어 있습니다."
          >
            수정
          </span>
          <Link
            href="/daily/manufacturing-equipment/incidents"
            className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/50 text-sm"
          >
            목록으로
          </Link>
        </div>
      </div>

      {showEditDisabledBanner && (
        <p className="mb-4 text-sm text-slate-400 rounded-lg border border-slate-700/60 bg-slate-900/40 px-3 py-2">
          현재 수정 기능은 비활성화되어 있습니다. 이력 수정은 추후 권한 정책 확정 후 제공 예정입니다.
        </p>
      )}

      <dl className="space-y-4 rounded-xl border border-slate-700/60 bg-slate-800/50 p-5 text-sm">
        <div>
          <dt className="text-slate-500 mb-1">설비명</dt>
          <dd className="text-slate-100">{equipLabel}</dd>
        </div>
        <div>
          <dt className="text-slate-500 mb-1">발생일시</dt>
          <dd className="text-slate-200">{formatDt(row.occurred_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-500 mb-1">구분</dt>
          <dd className="text-slate-200">{row.incident_type}</dd>
        </div>
        <div>
          <dt className="text-slate-500 mb-1">증상·유형</dt>
          <dd className="text-slate-200 whitespace-pre-wrap">
            {row.symptom_type === "기타" && row.symptom_other
              ? `${row.symptom_type} (${row.symptom_other})`
              : row.symptom_type}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500 mb-1">상세내용</dt>
          <dd className="text-slate-200 whitespace-pre-wrap">{row.detail}</dd>
        </div>
        <div>
          <dt className="text-slate-500 mb-1">생산영향 여부</dt>
          <dd className="text-slate-200">{productionImpactLabel(row.has_production_impact)}</dd>
        </div>
        <div>
          <dt className="text-slate-500 mb-1">조치상태</dt>
          <dd className="text-slate-200">{row.action_status}</dd>
        </div>
        <div>
          <dt className="text-slate-500 mb-1">재가동일시</dt>
          <dd className="text-slate-200">{formatDt(row.resumed_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-500 mb-1">비고</dt>
          <dd className="text-slate-200 whitespace-pre-wrap">{notesDisplay(row.notes)}</dd>
        </div>
        <div>
          <dt className="text-slate-500 mb-1">등록 경로</dt>
          <dd className="text-slate-200">{sourceTypeLabel(row.source_type)}</dd>
        </div>
        <div>
          <dt className="text-slate-500 mb-1">점검표 연동</dt>
          <dd className="text-slate-200">
            {row.source_type === "linked_from_inspection"
              ? row.linked_inspection_id
                ? `연동됨 (점검일지 ID: ${row.linked_inspection_id.slice(0, 8)}…)`
                : "연동"
              : "해당 없음"}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500 pt-2 border-t border-slate-700/50">
          <span>생성: {formatDt(row.created_at)}</span>
          <span>수정: {formatDt(row.updated_at)}</span>
          <span>작성자: {authorLabel}</span>
        </div>
      </dl>

    </div>
  );
}
