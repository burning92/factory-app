"use client";

import { useParams } from "next/navigation";
import { HoistInspectionForm } from "../../HoistInspectionForm";

export default function DailyHoistInspectionEditPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  if (!id) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] p-4 md:p-6 max-w-2xl mx-auto">
        <p className="text-slate-500 text-sm">잘못된 접근입니다.</p>
      </div>
    );
  }

  return <HoistInspectionForm mode="edit" editLogId={id} />;
}

