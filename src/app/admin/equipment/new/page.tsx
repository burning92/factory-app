"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  EquipmentMasterForm,
  emptyEquipmentMasterFormValues,
  formValuesToEquipmentPayload,
  type EquipmentMasterFormValues,
} from "../EquipmentMasterForm";

export default function AdminEquipmentNewPage() {
  const router = useRouter();
  const { user, viewOrganizationCode } = useAuth();
  const orgCode = viewOrganizationCode ?? "100";
  const [values, setValues] = useState<EquipmentMasterFormValues>(emptyEquipmentMasterFormValues);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const en = values.equipment_name.trim();
    const il = values.install_location.trim();
    const pu = values.purpose.trim();
    if (!values.management_no_suffix.trim() || !en || !il || !pu) {
      setErr("관리번호 뒤 번호, 기본 설비명, 설치장소, 용도는 필수입니다.");
      return;
    }
    setSaving(true);
    const payload = {
      organization_code: orgCode,
      ...formValuesToEquipmentPayload(values, { syncIsActive: true }),
      created_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("equipment_master").insert(payload).select("id").single();
    setSaving(false);
    if (error) {
      setErr(error.message.includes("unique") ? "같은 조직에 동일 관리번호가 이미 있습니다." : error.message);
      return;
    }
    router.replace(`/admin/equipment/${data.id}`);
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/equipment" className="text-sm text-slate-500 hover:text-slate-300">
          ← 목록
        </Link>
        <h1 className="text-lg font-semibold text-slate-100 mt-2">새 설비 등록</h1>
      </div>
      {err && (
        <p className="mb-4 text-sm text-red-400" role="alert">
          {err}
        </p>
      )}
      <form onSubmit={handleSubmit} className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4 md:p-6 space-y-6">
        <EquipmentMasterForm values={values} onChange={setValues} />
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-cyan-500 text-space-900 text-sm font-medium hover:bg-cyan-400 disabled:opacity-50"
          >
            저장
          </button>
          <Link
            href="/admin/equipment"
            className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-800"
          >
            취소
          </Link>
        </div>
      </form>
    </div>
  );
}
