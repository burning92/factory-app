export type DateKind = "date" | "timestamptz";

export type HaccpLogSpec = {
  key: string;
  label: string;
  short: string;
  headerTable: string;
  itemTable: string | null;
  dateColumn: string;
  dateKind: DateKind;
  authorNameColumn: string;
  authorUserColumn: string;
  /** 입고 표시사진 컬럼. 없는 일지는 null */
  photoColumn: string | null;
};

export const HACCP_LOGS: HaccpLogSpec[] = [
  {
    key: "hygiene",
    label: "영업장 환경 위생 점검일지",
    short: "환경위생",
    headerTable: "daily_hygiene_logs",
    itemTable: "daily_hygiene_log_items",
    dateColumn: "inspection_date",
    dateKind: "date",
    authorNameColumn: "author_name",
    authorUserColumn: "author_user_id",
    photoColumn: null,
  },
  {
    key: "temp",
    label: "영업장 온·습도 점검일지",
    short: "온습도",
    headerTable: "daily_temp_humidity_logs",
    itemTable: "daily_temp_humidity_log_items",
    dateColumn: "inspection_date",
    dateKind: "date",
    authorNameColumn: "author_name",
    authorUserColumn: "author_user_id",
    photoColumn: null,
  },
  {
    key: "sanitation",
    label: "위생시설 관리 점검일지",
    short: "위생시설",
    headerTable: "daily_sanitation_facility_logs",
    itemTable: "daily_sanitation_facility_log_items",
    dateColumn: "inspection_date",
    dateKind: "date",
    authorNameColumn: "author_name",
    authorUserColumn: "author_user_id",
    photoColumn: null,
  },
  {
    key: "worker",
    label: "작업자 위생 점검일지",
    short: "작업자위생",
    headerTable: "daily_worker_hygiene_logs",
    itemTable: "daily_worker_hygiene_log_items",
    dateColumn: "inspection_date",
    dateKind: "date",
    authorNameColumn: "author_name",
    authorUserColumn: "author_user_id",
    photoColumn: null,
  },
  {
    key: "cold",
    label: "냉장·냉동 온도 및 위생 점검일지",
    short: "냉장냉동",
    headerTable: "daily_cold_storage_hygiene_logs",
    itemTable: "daily_cold_storage_hygiene_log_items",
    dateColumn: "inspection_date",
    dateKind: "date",
    authorNameColumn: "author_name",
    authorUserColumn: "author_user_id",
    photoColumn: null,
  },
  {
    key: "process",
    label: "공정관리 점검일지(빵류)",
    short: "공정빵",
    headerTable: "daily_process_control_bread_logs",
    itemTable: "daily_process_control_bread_log_items",
    dateColumn: "inspection_date",
    dateKind: "date",
    authorNameColumn: "author_name",
    authorUserColumn: "author_user_id",
    photoColumn: null,
  },
  {
    key: "storage3f",
    label: "부자재 창고 점검표(3F)",
    short: "부자재3F",
    headerTable: "daily_material_storage_3f_logs",
    itemTable: "daily_material_storage_3f_log_items",
    dateColumn: "inspection_date",
    dateKind: "date",
    authorNameColumn: "author_name",
    authorUserColumn: "author_user_id",
    photoColumn: null,
  },
  {
    key: "mfg",
    label: "제조설비 점검일지",
    short: "제조설비",
    headerTable: "daily_manufacturing_equipment_logs",
    itemTable: "daily_manufacturing_equipment_log_items",
    dateColumn: "inspection_date",
    dateKind: "date",
    authorNameColumn: "author_name",
    authorUserColumn: "author_user_id",
    photoColumn: null,
  },
  {
    key: "air",
    label: "공조설비 점검일지",
    short: "공조설비",
    headerTable: "daily_air_conditioning_equipment_logs",
    itemTable: "daily_air_conditioning_equipment_log_items",
    dateColumn: "inspection_date",
    dateKind: "date",
    authorNameColumn: "author_name",
    authorUserColumn: "author_user_id",
    photoColumn: null,
  },
  {
    key: "hoist",
    label: "호이스트 점검기록",
    short: "호이스트",
    headerTable: "daily_hoist_inspection_logs",
    itemTable: "daily_hoist_inspection_log_items",
    dateColumn: "inspection_date",
    dateKind: "date",
    authorNameColumn: "author_name",
    authorUserColumn: "author_user_id",
    photoColumn: null,
  },
  {
    key: "illum",
    label: "영업장 조도 점검일지",
    short: "조도",
    headerTable: "daily_illumination_logs",
    itemTable: "daily_illumination_log_items",
    dateColumn: "inspection_date",
    dateKind: "date",
    authorNameColumn: "inspector_name",
    authorUserColumn: "inspector_user_id",
    photoColumn: null,
  },
  {
    key: "receiving",
    label: "원료 입고 검수일지",
    short: "입고검수",
    headerTable: "daily_material_receiving_inspection_logs",
    itemTable: "daily_material_receiving_inspection_log_items",
    dateColumn: "received_at",
    dateKind: "timestamptz",
    authorNameColumn: "author_name",
    authorUserColumn: "author_user_id",
    photoColumn: "label_photo_url",
  },
  {
    key: "thaw",
    label: "원료 해동 일지",
    short: "원해동",
    headerTable: "daily_raw_thawing_logs",
    itemTable: null,
    dateColumn: "thawing_date",
    dateKind: "date",
    authorNameColumn: "author_name",
    authorUserColumn: "author_user_id",
    photoColumn: null,
  },
];

export function findHaccpLog(key: string): HaccpLogSpec | undefined {
  return HACCP_LOGS.find((log) => log.key === key);
}

export const HEADER_COLUMN_ORDER = [
  "id",
  "organization_code",
  "inspection_date",
  "thawing_date",
  "received_at",
  "inspected_at",
  "planned_use_date",
  "status",
  "author_name",
  "inspector_name",
  "author_user_id",
  "inspector_user_id",
  "created_at",
  "updated_at",
  "submitted_at",
  "submitted_by",
  "approved_at",
  "approved_by",
  "approved_by_name",
  "rejected_at",
  "rejected_by",
  "reject_reason",
];

export const AUDIT_NOTE =
  "이력 추적자료 미보유는 수정이 없었다는 뜻이 아니다. audit_logs는 2026-10-07 이후 로그인 세션이 있는 변경만 남는다. 그 이전 변경, 로그인 없이 반영된 변경, 삭제된 행은 이 표시로 알 수 없다.";
