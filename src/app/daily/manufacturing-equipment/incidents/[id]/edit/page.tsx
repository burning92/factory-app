"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { getEquipmentIncidentById, type EquipmentIncidentRow } from "@/features/daily/equipmentIncidents";
import { EquipmentIncidentEditForm } from "../../../EquipmentIncidentEditForm";

export default function EquipmentIncidentEditPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const { viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";

  const [row, setRow] = useState<EquipmentIncidentRow | null>(null);
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

  return <EquipmentIncidentEditForm row={row} organizationCode={orgCode} />;
}
