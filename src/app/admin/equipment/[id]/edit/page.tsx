"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { EquipmentMasterRow } from "@/features/equipment/equipmentTypes";
import {
  EquipmentMasterForm,
  equipmentMasterToFormValues,
  formValuesToEquipmentPayload,
  type EquipmentMasterFormValues,
} from "../../EquipmentMasterForm";

export default function AdminEquipmentEditPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params.id ?? "");
  const [values, setValues] = useState<EquipmentMasterFormValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
    if (!data) {
      setErr("설비를 찾을 수 없습니다.");
      return;
    }
    setValues(equipmentMasterToFormValues(data as EquipmentMasterRow));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!values) return;
    setErr(null);
    const mn = values.management_no.trim();
    const en = values.equipment_name.trim();
    const il = values.install_location.trim();
    const pu = values.purpose.trim();
    if (!mn || !en || !il || !pu) {
      setErr("관리번호, 기본 설비명, 설치장소, 용도는 필수입니다.");
      return;
    }
    setSaving(true);
    const payload = {
      ...formValuesToEquipmentPayload(values, { syncIsActive: true }),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("equipment_master").update(payload).eq("id", id);
    setSaving(false);
    if (error) {
      setErr(error.message.includes("unique") ? "같은 조직에 동일 관리번호가 이미 있습니다." : error.message);
      return;
    }
    router.replace(`/admin/equipment/${id}`);
  }

  if (loading || !values) {
    return <p className="text-slate-500 text-sm">{loading ? "불러오는 중…" : err ?? "오류"}</p>;
  }

  return (
    <div>
      <div className="mb-6">
        <Link href={`/admin/equipment/${id}`} className="text-sm text-slate-500 hover:text-slate-300">
          ← 상세
        </Link>
        <h1 className="text-lg font-semibold text-slate-100 mt-2">설비 수정</h1>
      </div>
      {err && (
        <p className="mb-4 text-sm text-red-400" role="alert">
          {err}
        </p>
      )}
      <form onSubmit={handleSubmit} className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4 md:p-6 space-y-6">
        <EquipmentMasterForm values={values} onChange={setValues} excludeEquipmentId={id} />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400 disabled:opacity-50"
          >
            저장
          </button>
          <Link
            href={`/admin/equipment/${id}`}
            className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-800"
          >
            취소
          </Link>
        </div>
      </form>
    </div>
  );
}
