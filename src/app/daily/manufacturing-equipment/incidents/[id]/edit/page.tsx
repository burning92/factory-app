import { LegacyIncidentRedirect } from "../LegacyIncidentRedirect";

export default async function EquipmentIncidentEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LegacyIncidentRedirect incidentId={id} />;
}
