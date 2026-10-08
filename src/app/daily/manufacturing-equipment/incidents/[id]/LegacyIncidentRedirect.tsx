"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/** 예전 설비 이상 이력 링크 → 이관된 설비이력기록부 항목으로 이동 */
export function LegacyIncidentRedirect({ incidentId }: { incidentId: string }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("equipment_history_records")
        .select("id")
        .eq("legacy_incident_id", incidentId)
        .maybeSingle();
      if (cancelled) return;
      const recordId = (data as { id: string } | null)?.id;
      router.replace(recordId ? `/daily/equipment-history/${recordId}` : "/daily/equipment-history");
    })();
    return () => {
      cancelled = true;
    };
  }, [incidentId, router]);

  return <p className="p-6 text-slate-500 text-sm">설비이력기록부로 이동 중…</p>;
}
