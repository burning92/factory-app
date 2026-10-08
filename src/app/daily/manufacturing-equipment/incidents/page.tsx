import { redirect } from "next/navigation";

/** 설비 이상 이력은 설비이력기록부로 통합됨 */
export default function EquipmentIncidentsPage() {
  redirect("/daily/equipment-history");
}
