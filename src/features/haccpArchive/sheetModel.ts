import type { HaccpLogSpec } from "@/features/haccpExport/catalog";
import { isColdTempColumn } from "@/features/haccpExport/floor";
import {
  resolveColumnFloor,
  resolveItemFloor,
  type EquipmentFloorIndex,
  type FloorResult,
} from "@/features/haccpArchive/floors";
import { PROVENANCE_UNKNOWN, provenanceLabel, STORAGE_LABEL, type CreateAudit } from "@/features/haccpArchive/provenance";

export type Row = Record<string, unknown>;
export type LogBundle = { spec: HaccpLogSpec; headers: Row[]; items: Row[] };
export type ProfileLite = { display_name: string | null; login_id: string | null };
export type PhotoRecord = {
  itemId: string;
  logId: string;
  fileId: string;
  name: string;
  webViewLink: string;
  sha256: string;
  md5: string;
  size: number;
  uploadedAt: string;
};
export type CorrectionRow = {
  id: string;
  created_at: string;
  kind: string | null;
  target_table: string;
  target_ids: string[];
  reason: string | null;
  requested_by_name: string | null;
  approved_by_name: string | null;
};
export type DeleteEvent = {
  auditId: string;
  created_at: string;
  target_table: string;
  target_id: string;
  actor_display_name: string | null;
  target_label: string | null;
  recordDate: string | null;
};

export type Cell =
  | string
  | number
  | null
  | { url: string; label: string }
  | { tabLink: string; label: string };

export type Tab = { title: string; columns: string[]; widths: number[]; rows: Cell[][] };

export const SHEET_CELL_MAX = 50000;
const CORRECTION_PREFIX = "[정정 요청]";

export function formatKst(value: unknown, withSeconds = false): string {
  if (typeof value !== "string" || value === "") return "";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  const text = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hourCycle: "h23",
  }).format(dt);
  return text;
}

export function recordDateOf(spec: HaccpLogSpec, header: Row): string {
  const value = header[spec.dateColumn];
  if (value == null || value === "") return "";
  if (spec.dateKind === "timestamptz") return formatKst(value).slice(0, 10);
  return String(value).slice(0, 10);
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function clip(value: string): string {
  if (value.length <= SHEET_CELL_MAX) return value;
  return `${value.slice(0, SHEET_CELL_MAX - 40)} …(이하 생략, 원본백업 참조)`;
}

function joinParts(parts: [string, unknown][]): string {
  return parts
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([label, value]) => `${label}: ${text(value)}`)
    .join(" / ");
}

export function statusLabel(header: Row, reopened: boolean): string {
  const status = text(header.status);
  const reason = text(header.reject_reason);
  if (status === "approved") return reopened ? "승인(정정 후 재승인)" : "승인";
  if (status === "submitted") return reopened ? "제출(정정 후 재제출, 승인 대기)" : "제출(승인 대기)";
  if (status === "rejected") return reason.startsWith(CORRECTION_PREFIX) ? "정정 재검토 중(승인 취소)" : "반려";
  if (status === "draft") return header.submitted_at ? "작성 중(제출 회수)" : "작성 중(미제출)";
  return status ? `알 수 없는 상태(${status})` : "상태 없음";
}

function correctiveText(header: Row): string {
  return joinParts([
    ["이탈", header.corrective_deviation],
    ["조치", header.corrective_detail ?? header.corrective_content],
    ["조치자", header.corrective_actor],
    ["조치시각", formatKst(header.corrective_datetime)],
    ["확인자", header.corrective_approver],
    ["비고", header.corrective_remarks],
  ]);
}

const STORAGE_CATEGORY_LABEL: Record<string, string> = { cold: "냉장", frozen: "냉동", room: "상온" };

const COLD_UNIT_LABEL: Record<string, string> = {
  blast_freezer_1: "급속냉동고 1",
  blast_freezer_2: "급속냉동고 2",
  dough_aging: "도우숙성고",
  floor1_freezer: "1층 냉동고",
  floor1_refrigerator: "1층 냉장고",
  floor3_aging: "3층 숙성고",
  floor3_blast_freezer: "3층 급속냉동고",
  topping_refrigerator: "토핑 냉장고",
};

type ItemView = {
  zone: string;
  item: string;
  measured: string;
  standard: string;
  result: string;
  note: string;
  equipmentText: string | null;
  order: number;
};

function num(value: unknown, unit: string): string {
  if (value === null || value === undefined || value === "") return "-";
  return `${text(value)}${unit}`;
}

export function describeItem(spec: HaccpLogSpec, item: Row): ItemView {
  const base: ItemView = {
    zone: text(item.category),
    item: text(item.question_text),
    measured: "",
    standard: "",
    result: text(item.result ?? item.conformity),
    note: text(item.nonconformity_note ?? item.remarks),
    equipmentText: null,
    order: Number(item.question_index ?? item.zone_index ?? item.stage_index ?? item.item_index ?? item.line_index ?? 0),
  };
  switch (spec.key) {
    case "temp":
      return {
        ...base,
        zone: text(item.zone_name),
        item: "온도·습도",
        measured: `${num(item.actual_temp_c, "℃")} / ${num(item.actual_humidity_pct, "%")}`,
        standard: `${num(item.max_temp_c, "℃")} 이하 / ${num(item.max_humidity_pct, "%")} 이하`,
        result: "",
      };
    case "process":
      return { ...base, zone: "", item: text(item.stage_name) };
    case "storage3f":
      return { ...base, zone: text(item.room_name) };
    case "mfg":
    case "air":
      return { ...base, equipmentText: text(item.question_text) || null };
    case "illum":
      return {
        ...base,
        zone: text(item.item_label),
        item: "조도",
        measured: num(item.measured_lux, " lux"),
        standard: `${num(item.min_lux, " lux")} 이상`,
        result: text(item.conformity),
      };
    case "receiving":
      return {
        ...base,
        zone: STORAGE_CATEGORY_LABEL[text(item.storage_category)] ?? text(item.storage_category),
        item: text(item.item_name),
        measured: joinParts([
          ["박스", item.box_qty],
          ["낱개", item.unit_qty],
          ["잔량(g)", item.remainder_g],
          ["총중량(g)", item.total_weight_g],
        ]),
        standard: joinParts([["유통기한·LOT", item.expiry_or_lot]]),
        result: text(item.conformity),
        note: text(item.remarks),
      };
    default:
      return base;
  }
}

/** 머리글에만 저장된 측정값(냉장냉동 온도, 부자재 창고 온습도, 원료 해동)을 행으로 푼다. */
export function headerMeasurements(spec: HaccpLogSpec, header: Row): (ItemView & { column: string; floor: FloorResult })[] {
  const out: (ItemView & { column: string; floor: FloorResult })[] = [];
  const blank = { standard: "", result: "", note: "", equipmentText: null };
  if (spec.key === "cold") {
    const columns = Object.keys(header).filter(isColdTempColumn).sort();
    columns.forEach((column, i) => {
      const m = /^(am|pm)_temp_(.+)_c$/.exec(column);
      if (!m) return;
      const when = m[1] === "am" ? "오전" : "오후";
      const time = text(header[`${m[1]}_measure_time`]);
      out.push({
        ...blank,
        zone: COLD_UNIT_LABEL[m[2]] ?? m[2],
        item: `${when} 온도${time ? ` (${time})` : ""}`,
        measured: num(header[column], "℃"),
        order: 1000 + i,
        column,
        floor: resolveColumnFloor(column),
      });
    });
  }
  if (spec.key === "storage3f") {
    const pairs: [string, string, string, string][] = [
      ["원료보관실", "온도", "raw_room_temp_c", "℃"],
      ["원료보관실", "습도", "raw_room_humidity_pct", "%"],
      ["부자재보관실", "온도", "sub_room_temp_c", "℃"],
      ["부자재보관실", "습도", "sub_room_humidity_pct", "%"],
    ];
    pairs.forEach(([zone, item, column, unit], i) => {
      if (!(column in header)) return;
      out.push({ ...blank, zone, item, measured: num(header[column], unit), order: 1000 + i, column, floor: resolveColumnFloor(column) });
    });
  }
  if (spec.key === "thaw") {
    out.push({
      ...blank,
      zone: "해동실",
      item: text(header.material_name) || "원료 해동",
      measured: joinParts([
        ["해동실 온도(℃)", header.thawing_room_temp_c],
        ["시작", formatKst(header.thawing_start_at)],
        ["종료", formatKst(header.thawing_end_at)],
        ["총중량(g)", header.total_weight_g],
      ]),
      standard: joinParts([
        ["LOT", header.lot_no ?? header.lot_selected ?? header.lot_manual],
        ["사용예정일", header.planned_use_date],
      ]),
      result: joinParts([
        ["색", header.sensory_color_result],
        ["냄새", header.sensory_odor_result],
        ["이물", header.foreign_matter_result],
      ]),
      order: 0,
      column: "",
      floor: { floor: null, basis: "" },
    });
  }
  if (spec.key === "process") {
    const summary = joinParts([
      ["제품", header.product_name],
      ["작업", [text(header.work_start_time), text(header.work_end_time)].filter(Boolean).join("~")],
      ["발효", [formatKst(header.fermentation_start_at), formatKst(header.fermentation_end_at)].filter(Boolean).join("~")],
      ["토핑중량(g)", header.topping_weight_check_g],
      ["비고", header.notes],
    ]);
    if (summary) {
      out.push({ ...blank, zone: "", item: "작업 정보", measured: summary, order: -1, column: "", floor: { floor: null, basis: "" } });
    }
  }
  if (spec.key === "hoist" && header.overall_assessment) {
    out.push({ ...blank, zone: "", item: "종합 판정", result: text(header.overall_assessment), order: 9999, column: "overall_assessment", measured: "", floor: { floor: null, basis: "" } });
  }
  return out;
}

export type MonthInput = {
  month: string;
  generatedAt: string;
  logs: LogBundle[];
  profiles: Map<string, ProfileLite>;
  equipment: EquipmentFloorIndex;
  photos: Map<string, PhotoRecord>;
  photoPresent: Set<string>;
  corrections: CorrectionRow[];
  deletes: DeleteEvent[];
  /** `${headerTable}:${id}` → 일지 생성 감사로그 */
  createAudits: Map<string, CreateAudit>;
};

export const ITEM_COLUMNS = [
  "점검일", "상태", "구역", "층", "층 근거", "점검항목", "측정값", "기준", "적합 여부", "특이사항", "개선조치",
  "작성자", "제출자", "제출시각", "승인자", "승인시각", "반려·정정 사유", "사진", "저장 위치", "작성 경로", "일지 ID", "세부항목 ID", "원본 열",
];
const ITEM_WIDTHS = [90, 150, 110, 50, 140, 280, 180, 170, 80, 200, 240, 80, 80, 130, 80, 130, 200, 80, 140, 200, 270, 270, 160];

export const LIST_COLUMNS = [
  "점검일", "일지", "상태", "작성자", "제출자", "제출시각", "승인자", "승인시각", "반려·정정 사유", "세부항목 수", "사진 수",
  "개선조치", "저장 위치", "작성 경로", "일지 ID", "바로가기",
];
const LIST_WIDTHS = [90, 200, 160, 80, 80, 130, 80, 130, 220, 80, 60, 260, 140, 200, 270, 90];

export const HISTORY_COLUMNS = ["발생시각", "구분", "일지", "기록일", "대상 ID", "처리자", "내용", "근거 ID"];
const HISTORY_WIDTHS = [130, 120, 200, 90, 270, 100, 360, 270];

function nameOf(profiles: Map<string, ProfileLite>, id: unknown): string {
  if (!id) return "";
  const profile = profiles.get(String(id));
  if (!profile) return `계정 ${String(id).slice(0, 8)}`;
  return profile.display_name?.trim() || profile.login_id || `계정 ${String(id).slice(0, 8)}`;
}

function authorOf(spec: HaccpLogSpec, header: Row, profiles: Map<string, ProfileLite>): string {
  const recorded = text(header[spec.authorNameColumn]).trim();
  if (recorded) return recorded;
  return nameOf(profiles, header[spec.authorUserColumn] ?? header.author_user_id);
}

function headerOrder(spec: HaccpLogSpec, a: Row, b: Row): number {
  const da = recordDateOf(spec, a);
  const db = recordDateOf(spec, b);
  if (da !== db) return da < db ? -1 : 1;
  const ca = text(a.created_at);
  const cb = text(b.created_at);
  if (ca !== cb) return ca < cb ? -1 : 1;
  return text(a.id) < text(b.id) ? -1 : 1;
}

export function buildMonthTabs(input: MonthInput): { tabs: Tab[]; headerCount: number; itemCount: number; rowCount: number } {
  const reopened = new Set<string>();
  for (const c of input.corrections) {
    if (c.kind === "reopen") for (const id of c.target_ids) reopened.add(`${c.target_table}:${id}`);
  }

  const listRows: Cell[][] = [];
  const logTabs: Tab[] = [];
  let headerCount = 0;
  let itemCount = 0;

  for (const log of input.logs) {
    const { spec } = log;
    const itemsByLog = new Map<string, Row[]>();
    for (const item of log.items) {
      const key = text(item.log_id);
      const list = itemsByLog.get(key) ?? [];
      list.push(item);
      itemsByLog.set(key, list);
    }
    const rows: Cell[][] = [];
    const headers = [...log.headers].sort((a, b) => headerOrder(spec, a, b));
    for (const header of headers) {
      headerCount += 1;
      const id = text(header.id);
      const status = statusLabel(header, reopened.has(`${spec.headerTable}:${id}`));
      const date = recordDateOf(spec, header);
      const author = authorOf(spec, header, input.profiles);
      const submitter = nameOf(input.profiles, header.submitted_by);
      const approver = text(header.approved_by_name) || (header.approved_by ? nameOf(input.profiles, header.approved_by) : "");
      const reason = text(header.reject_reason);
      const corrective = correctiveText(header);
      const provenance = provenanceLabel(input.createAudits.get(`${spec.headerTable}:${id}`));
      const common = (view: ItemView, floor: FloorResult, photo: Cell, itemId: string, column: string): Cell[] => [
        date, status, view.zone, floor.floor ?? "", floor.basis, clip(view.item), clip(view.measured), clip(view.standard),
        view.result, clip(view.note), clip(corrective), author, submitter, formatKst(header.submitted_at), approver,
        formatKst(header.approved_at), clip(reason), photo, STORAGE_LABEL, provenance, id, itemId, column,
      ];

      const views: { view: ItemView; floor: FloorResult; photo: Cell; itemId: string; column: string }[] = [];
      for (const m of headerMeasurements(spec, header)) views.push({ view: m, floor: m.floor, photo: "", itemId: "", column: m.column });
      const items = itemsByLog.get(id) ?? [];
      let photoCount = 0;
      for (const item of items) {
        itemCount += 1;
        const view = describeItem(spec, item);
        const itemId = text(item.id);
        let photo: Cell = "";
        if (spec.photoColumn) {
          const record = input.photos.get(itemId);
          if (record) {
            photo = { url: record.webViewLink, label: "사진 보기" };
            photoCount += 1;
          } else if (input.photoPresent.has(itemId)) {
            photo = "보관 대기";
            photoCount += 1;
          }
        }
        views.push({ view, floor: resolveItemFloor(item, input.equipment, view.equipmentText), photo, itemId, column: "" });
      }
      views.sort((a, b) => a.view.order - b.view.order || (a.itemId < b.itemId ? -1 : 1));
      for (const v of views) rows.push(common(v.view, v.floor, v.photo, v.itemId, v.column));

      listRows.push([
        date, spec.label, status, author, submitter, formatKst(header.submitted_at), approver, formatKst(header.approved_at),
        clip(reason), items.length, photoCount, clip(corrective), STORAGE_LABEL, provenance, id, { tabLink: spec.short, label: spec.short },
      ]);
    }
    logTabs.push({ title: spec.short, columns: ITEM_COLUMNS, widths: ITEM_WIDTHS, rows });
  }

  listRows.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : String(a[1]) < String(b[1]) ? -1 : 1));

  const labelOfTable = new Map<string, string>();
  for (const log of input.logs) {
    labelOfTable.set(log.spec.headerTable, log.spec.label);
    if (log.spec.itemTable) labelOfTable.set(log.spec.itemTable, `${log.spec.label}(세부항목)`);
  }
  const history: Cell[][] = [];
  for (const d of input.deletes) {
    history.push([
      formatKst(d.created_at, true), "삭제", labelOfTable.get(d.target_table) ?? d.target_table, d.recordDate ?? "",
      d.target_id, d.actor_display_name ?? "", clip(d.target_label ?? ""), `감사로그 ${d.auditId}`,
    ]);
  }
  for (const c of input.corrections) {
    history.push([
      formatKst(c.created_at, true), c.kind === "reopen" ? "정정 요청(승인 취소)" : "직접 정정", labelOfTable.get(c.target_table) ?? c.target_table,
      "", c.target_ids.join(", "), c.requested_by_name ?? "", clip(c.reason ?? ""), `정정요청 ${c.id}`,
    ]);
  }
  history.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));

  const guide: Cell[][] = [
    ["대상 월", input.month],
    ["갱신 시각(KST)", formatKst(input.generatedAt, true)],
    ["저장 위치", `모든 행은 ${STORAGE_LABEL}에서 읽었다. 이는 현재 저장 위치이며 최초 작성 시스템을 뜻하지 않는다.`],
    ["작성 경로", `일지 생성 감사로그가 있을 때만 '웹 전자일지 작성' 등으로 적는다. 감사로그가 없으면(보존기간 이전 기록, 이관 자료 등) '${PROVENANCE_UNKNOWN}'으로 두고 단정하지 않는다.`],
    ["AppSheet", "AppSheet 원본 기록은 이 파일과 별도로 보존한다. 이 파일의 '출처 미확인' 행이 AppSheet 기록인지는 AppSheet 원본과 대조해 판단한다."],
    ["성격", "열람용 사본이다. 시트는 보호되어 소유자 외에는 수정할 수 없고, 고쳐도 전자일지 원본·승인기록·감사로그에는 반영되지 않는다."],
    ["원본 대조", "일지 ID·세부항목 ID는 전자일지 원본 행의 ID다. 월별 원본백업(JSON)과 SHA-256으로 대조한다."],
    ["시각", "모든 시각은 한국시간(KST)이다. 점검일은 일지에 기록된 날짜다(입고검수는 입고시각의 한국 날짜)."],
    ["층", "항목 문구에 층이 하나만 있거나, 측정 항목명에 층이 있거나, 설비마스터에서 이름이 하나로 대응되는 경우에만 적는다. 근거가 없으면 비운다."],
    ["상태", "승인 / 제출(승인 대기) / 반려 / 정정 재검토 중(승인 취소) / 작성 중. 정정 후 다시 승인된 일지는 '승인(정정 후 재승인)'이다."],
    ["사진", "'사진 보기'는 비공개 보관 폴더의 원본 사진 링크다. '보관 대기'는 아직 Drive로 옮기지 않은 사진이다."],
    ["삭제·정정", "삭제된 일지는 일지 탭에 없고 '정정·삭제이력' 탭에 감사로그 근거와 함께 남는다."],
    ["건수", `일지 ${headerCount}건, 세부항목 ${itemCount}건`],
  ];

  const tabs: Tab[] = [
    { title: "안내", columns: ["항목", "내용"], widths: [140, 900], rows: guide },
    { title: "전체목록", columns: LIST_COLUMNS, widths: LIST_WIDTHS, rows: listRows },
    ...logTabs,
    { title: "정정·삭제이력", columns: HISTORY_COLUMNS, widths: HISTORY_WIDTHS, rows: history },
  ];
  const rowCount = tabs.reduce((sum, tab) => sum + tab.rows.length, 0);
  return { tabs, headerCount, itemCount, rowCount };
}
