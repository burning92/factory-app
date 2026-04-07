import { Suspense } from "react";
import { EquipmentIncidentForm } from "../../EquipmentIncidentForm";

export default function EquipmentIncidentNewPage() {
  return (
    <Suspense fallback={<p className="p-6 text-slate-500 text-sm">불러오는 중…</p>}>
      <EquipmentIncidentForm />
    </Suspense>
  );
}
