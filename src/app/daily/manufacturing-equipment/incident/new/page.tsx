import { redirect } from "next/navigation";

/** 설비 이상 등록은 설비이력기록부로 통합됨 */
export default function EquipmentIncidentNewPage() {
  redirect("/daily/equipment-history/new");
}
