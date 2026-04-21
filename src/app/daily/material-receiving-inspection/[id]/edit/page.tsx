"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { MaterialReceivingInspectionForm } from "../../MaterialReceivingInspectionForm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DailyMaterialReceivingInspectionEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === "string" ? params.id : "";

  useEffect(() => {
    if (id && id.toLowerCase() === "new") {
      router.replace("/materials/material-receiving-inspection/new");
    }
  }, [id, router]);

  if (!id) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-slate-500 text-sm">잘못된 접근입니다.</p>
      </div>
    );
  }
  if (id.toLowerCase() === "new") {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-slate-500 text-sm">이동 중…</p>
      </div>
    );
  }
  if (!UUID_RE.test(id)) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-slate-500 text-sm">잘못된 일지 ID입니다.</p>
      </div>
    );
  }
  return <MaterialReceivingInspectionForm mode="edit" editLogId={id} />;
}
