import type { DashboardGroup, EquipmentType, LifecycleStatus } from "./equipmentConstants";

export type EquipmentMasterRow = {
  id: string;
  organization_code: string;
  management_no: string;
  equipment_name: string;
  equipment_type?: EquipmentType | null;
  unit_no?: number | null;
  display_name?: string | null;
  floor_label?: string | null;
  install_location: string;
  purpose: string;
  purchased_at: string | null;
  supplier_name: string | null;
  supplier_contact: string | null;
  manufacturer_name: string | null;
  manufacturer_contact: string | null;
  specification: string | null;
  voltage: string | null;
  photo_url: string | null;
  notes: string | null;
  /** lifecycle_status와 동기화(레거시·쿼리 호환) */
  is_active: boolean;
  lifecycle_status?: LifecycleStatus | null;
  dashboard_group?: DashboardGroup | null;
  dashboard_visible?: boolean | null;
  installed_at: string | null;
  removed_at: string | null;
  replaced_from_equipment_id: string | null;
  replaced_by_equipment_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type EquipmentHistoryRecordRow = {
  id: string;
  organization_code: string;
  equipment_id: string;
  record_date: string;
  issue_detail: string;
  emergency_action: string | null;
  repair_detail: string | null;
  notes: string | null;
  closure_status: "ongoing" | "closed";
  incident_type?: EquipmentIncidentKind | null;
  has_production_impact?: boolean | null;
  resumed_at?: string | null;
  linked_inspection_id?: string | null;
  linked_inspection_item_id?: string | null;
  legacy_incident_id?: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  created_by_name: string | null;
  updated_by: string | null;
  equipment_master?: EquipmentMasterRow | null;
};

export const EQUIPMENT_INCIDENT_KINDS = ["이상", "고장", "가동중지"] as const;
export type EquipmentIncidentKind = (typeof EQUIPMENT_INCIDENT_KINDS)[number];

export type EquipmentHistoryUpdateRow = {
  id: string;
  history_record_id: string;
  result_date: string;
  result_detail: string;
  assignee: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  created_by_name: string | null;
  updated_by: string | null;
};
