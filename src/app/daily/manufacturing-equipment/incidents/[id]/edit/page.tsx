"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** 수정 기능 비활성화 — 상세로 이동 (AppShell에서도 동일 처리) */
export default function EquipmentIncidentEditDisabledPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === "string" ? params.id : "";

  useEffect(() => {
    if (id) {
      router.replace(`/daily/manufacturing-equipment/incidents/${id}?edit=disabled`);
    } else {
      router.replace("/daily/manufacturing-equipment/incidents");
    }
  }, [id, router]);

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-6">
      <p className="text-slate-500 text-sm">이동 중…</p>
    </div>
  );
}
