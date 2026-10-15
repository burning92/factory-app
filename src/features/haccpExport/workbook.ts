import ExcelJS from "exceljs";
import { AUDIT_NOTE, HEADER_COLUMN_ORDER } from "@/features/haccpExport/catalog";
import {
  auditKey,
  headerAuditCount,
  type ExportBundle,
  type LoadedLog,
} from "@/features/haccpExport/assemble";
import { approvalConsistencyLabel, AUDIT_MISSING_LABEL, auditTraceLabel, authorCompareLabel } from "@/features/haccpExport/flags";
import {
  detectFloorFromColumn,
  detectFloorFromRecord,
  isColdTempColumn,
  type FloorValue,
} from "@/features/haccpExport/floor";
import { DELETE_AUDIT_LOOKBACK_DAYS, HaccpExportError, PHOTO_OMITTED_MARK } from "@/features/haccpExport/load";
import { provenanceLabel, STORAGE_LABEL } from "@/features/haccpArchive/provenance";
import { resolveItemFloor } from "@/features/haccpArchive/floors";
import {
  EMPTY_STRING_MARK,
  formatKstDisplay,
  isTimestamptzColumn,
  orderedKeys,
  toExcelValue,
} from "@/features/haccpExport/values";

const LONG_LIMIT = 30000;

type LongPiece = {
  sheet: string;
  recordId: string;
  column: string;
  part: number;
  text: string;
};

type Grid = { name: string; columns: string[]; rows: unknown[][]; idColumn?: number };

function safeSheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
}

function coldTempColumns(headers: Record<string, unknown>[]): string[] {
  const columns = new Set<string>();
  for (const header of headers) {
    for (const key of Object.keys(header)) {
      if (isColdTempColumn(key)) columns.add(key);
    }
  }
  return Array.from(columns).sort();
}

class WorkbookFile {
  readonly book = new ExcelJS.Workbook();
  readonly longText: LongPiece[] = [];
  readonly written = new Map<string, number>();

  constructor() {
    this.book.creator = "factory HACCP export";
    this.book.lastModifiedBy = "read-only extract";
  }

  private cell(sheet: string, column: string, recordId: unknown, value: unknown): string | number | boolean | null {
    const excel = toExcelValue(value);
    if (typeof excel === "string" && excel.length > LONG_LIMIT) {
      const parts = Math.ceil(excel.length / LONG_LIMIT);
      for (let index = 0; index < parts; index += 1) {
        this.longText.push({
          sheet,
          recordId: recordId == null ? "" : String(recordId),
          column,
          part: index + 1,
          text: excel.slice(index * LONG_LIMIT, (index + 1) * LONG_LIMIT),
        });
      }
      return `[원문 ${excel.length}자. 긴텍스트 시트 ${parts}부분. 시트=${sheet} 열=${column} id=${String(recordId ?? "")}]`;
    }
    return excel;
  }

  addGrid(grid: Grid): void {
    const name = safeSheetName(grid.name);
    if (this.book.getWorksheet(name)) {
      throw new HaccpExportError(`시트 이름이 겹칩니다: ${name}`);
    }
    const sheet = this.book.addWorksheet(name);
    sheet.addRow(grid.columns);
    sheet.getRow(1).font = { bold: true };
    for (const row of grid.rows) {
      const added = sheet.addRow(
        row.map((value, index) =>
          this.cell(grid.name, grid.columns[index] ?? String(index), row[grid.idColumn ?? 0], value)
        )
      );
      added.eachCell((cell) => {
        if (typeof cell.value === "string") cell.numFmt = "@";
      });
    }
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    if (grid.columns.length > 0) {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: grid.columns.length },
      };
    }
    let seen = 0;
    sheet.eachRow((_row, rowNumber) => {
      if (rowNumber > 1) seen += 1;
    });
    if (seen !== grid.rows.length) {
      throw new HaccpExportError(
        `${grid.name} 시트에 쓴 행 ${seen}건과 추출 대상 ${grid.rows.length}건이 다릅니다. 파일을 만들지 않습니다.`
      );
    }
    this.written.set(grid.name, grid.rows.length);
  }

  async finish(extra: Grid[]): Promise<Buffer> {
    for (const grid of extra) this.addGrid(grid);
    if (this.longText.length > 0) {
      this.addGrid({
        name: "긴텍스트",
        columns: ["시트", "record_id", "열", "부분", "텍스트"],
        rows: this.longText.map((piece) => [piece.sheet, piece.recordId, piece.column, piece.part, piece.text]),
      });
    }
    const raw = await this.book.xlsx.writeBuffer();
    return Buffer.from(raw);
  }
}

function headerGrid(log: LoadedLog, bundle: ExportBundle): Grid {
  const keys = orderedKeys(log.headers, HEADER_COLUMN_ORDER);
  const tzColumns = keys.filter(isTimestamptzColumn);
  const columns = [
    ...keys,
    "분석_작성자대조",
    "분석_계정표시이름",
    "분석_계정로그인",
    "분석_계정소속조직",
    "분석_승인정합",
    "분석_이력추적",
    "분석_저장위치",
    "분석_작성경로",
    ...tzColumns.map((column) => `표시KST_${column}`),
  ];
  const rows = log.headers.map((row) => {
    const userId = row[log.spec.authorUserColumn];
    const profile = userId ? bundle.profiles.get(String(userId)) : undefined;
    const approver = row.approved_by ? bundle.profiles.get(String(row.approved_by)) : undefined;
    const auditCount = headerAuditCount(log, String(row.id), bundle.audits);
    return [
      ...keys.map((key) => (key in row ? row[key] : null)),
      authorCompareLabel(row[log.spec.authorNameColumn], userId, profile),
      profile ? profile.display_name : null,
      profile ? profile.login_id : null,
      profile ? profile.organization_code : null,
      approvalConsistencyLabel(row, approver),
      auditTraceLabel(auditCount),
      STORAGE_LABEL,
      provenanceLabel(
        (bundle.audits.get(auditKey(log.spec.headerTable, String(row.id))) ?? [])
          .filter((a) => a.action === "create")
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0]
      ),
      ...tzColumns.map((column) => formatKstDisplay(row[column])),
    ];
  });
  return { name: `${log.spec.short}_헤더`, columns, rows };
}

function itemGrid(log: LoadedLog, bundle: ExportBundle): Grid | null {
  if (!log.spec.itemTable) return null;
  const keys = orderedKeys(log.items, ["id", "log_id", "created_at"]);
  const columns = [...keys, "분석_문구상층", "분석_층", "분석_층근거"];
  if (log.spec.photoColumn) columns.push("분석_사진종류", "분석_사진접근", "분석_사진HTTP");
  const rows = log.items.map((row) => {
    const photo = log.spec.photoColumn ? bundle.photos.get(String(row.id)) : undefined;
    const equipmentText = log.spec.key === "mfg" || log.spec.key === "air" ? String(row.question_text ?? "") || null : null;
    const floor = resolveItemFloor(row, bundle.equipment, equipmentText);
    const base = [
      ...keys.map((key) => (key in row ? row[key] : null)),
      detectFloorFromRecord(row),
      floor.floor,
      floor.basis || null,
    ];
    if (log.spec.photoColumn) base.push(photo?.kind ?? null, photo?.access ?? null, photo?.httpStatus ?? null);
    return base;
  });
  return { name: `${log.spec.short}_항목`, columns, rows };
}

function coverRows(bundle: ExportBundle, mode: string): unknown[][] {
  const headerTotal = bundle.logs.reduce((sum, log) => sum + log.headers.length, 0);
  const itemTotal = bundle.logs.reduce((sum, log) => sum + log.items.length, 0);
  return [
    ["추출 시각 원본", bundle.generatedAt],
    ["추출 시각 표시KST", formatKstDisplay(bundle.generatedAt)],
    ["기간 시작", bundle.from],
    ["기간 종료", bundle.to],
    ["추출 방식", mode],
    ["일지", bundle.logs.map((log) => log.spec.label).join(", ")],
    ["헤더 건수", headerTotal],
    ["항목 건수", itemTotal],
    ["DB 수정", "이 파일은 조회 결과만 담는다. 원본 테이블은 변경하지 않는다."],
    ["날짜 컬럼", "inspection_date, thawing_date 는 시간대 없는 DATE 원본이다. KST로 다시 계산하지 않는다."],
    ["시각 컬럼", "received_at 등 timestamptz 원본은 오프셋이 포함된 문자열이다. 표시KST_ 열은 Asia/Seoul 표시값이며 원본이 아니다."],
    ["입고 기간", "received_at 은 한국시간 달력 날짜가 시작일~종료일에 들어가는 행만 포함한다."],
    ["NULL", "DB NULL 은 빈 셀이다."],
    ["빈 문자열", `DB 빈 문자열은 셀 문자 ${EMPTY_STRING_MARK} 이다. 적합 같은 값으로 채우지 않는다.`],
    ["감사로그", AUDIT_NOTE],
    ["이력 표시", `연결 이력이 없는 헤더는 ${AUDIT_MISSING_LABEL} 이다. 이 문구를 무수정으로 읽지 않는다.`],
    ["층", "원본 시트의 분석_문구상층은 항목 문자열에 1층/2층/3층이 하나만 있을 때만 적는다. 비어 있으면 층을 배정하지 않은 것이다."],
    ["층(설비마스터)", "분석_층은 분석_문구상층이 없을 때 설비마스터에서 설비명이 하나의 층으로만 대응되면 그 층을 적고, 분석_층근거에 관리번호를 남긴다. 같은 이름이 여러 층에 있거나 전층이면 비운다."],
    ["삭제이력 범위", `선택 기간 일지의 삭제만 담는다. 일지 삭제는 삭제 전 기록일이 기간 안인 것, 세부항목 삭제는 기간 안 일지에 속한 것이다(기간 시작 ${DELETE_AUDIT_LOOKBACK_DAYS}일 전 이후 감사로그에서 찾음).`],
    ["정정이력", "정정이력 시트는 기간 안 일지를 대상으로 한 정정 요청서(data_corrections)다. 정정 전 원본(before_snapshot)은 Drive 정정·보완 이력 보관본에 있다."],
    ["부자재 창고", "일지 이름에 3F가 있어도 항목 문구에 층이 없으면 3층으로 넣지 않는다."],
    ["제조설비 2층", "2층 분류는 층 단어 없이 저장된 과거 일지가 있다. 그 행은 2층으로 추정하지 않는다."],
    ["사진", `입고 표시사진 본문(base64 data URL)은 엑셀에 넣지 않고 ${PHOTO_OMITTED_MARK} 로 표시한다. 원본은 DB와 Drive 비공개 보관본(지정 관리자 계정 열람)에 있다. http 주소는 그대로 적고 분석_사진접근에 확인 결과를 적는다.`],
    ["작성 경로", "분석_저장위치는 현재 저장 위치다. 분석_작성경로는 일지 생성 감사로그가 있을 때만 적고, 없으면 출처 미확인이다(AppSheet 등 이전 시스템 기록일 수 있으며 단정하지 않는다)."],
    ["긴 값", "Excel 셀 한도를 넘는 값은 긴텍스트 시트에 나눠 두고, 원래 칸에는 참조 문구를 넣는다."],
    ["기록일 없음", "기록일 컬럼이 NULL인 행은 기간 필터에 넣지 않는다. 검증 시트의 기록일NULL이 그 건수다."],
  ];
}

function org000Rows(bundle: ExportBundle): unknown[][] {
  if (bundle.org000.length === 0) {
    return [["조직 000", "이 기간 공조설비 일지에 organization_code 000 행이 없다."]];
  }
  const rows: unknown[][] = [
    [
      "판단 기준",
      "공조 일지의 organization_code는 계정 소속이 아니라 저장 당시 화면의 조직 코드다. 아래는 그 행과 작성 계정 소속을 대조한 것이다.",
    ],
  ];
  for (const row of bundle.org000) {
    const profile = row.author_user_id ? bundle.profiles.get(String(row.author_user_id)) : undefined;
    const sameDay = bundle.org000SameDayOrg100.filter((other) => other.inspection_date === row.inspection_date);
    rows.push(
      ["id", row.id],
      ["inspection_date", row.inspection_date],
      ["created_at 원본", row.created_at],
      ["created_at 표시KST", formatKstDisplay(row.created_at)],
      ["status", row.status],
      ["author_name", row.author_name],
      ["author_user_id", row.author_user_id],
      ["계정 표시이름", profile ? profile.display_name : null],
      ["계정 로그인", profile ? profile.login_id : null],
      ["계정 소속 조직", profile ? `${profile.organization_code ?? ""} ${profile.organization_name ?? ""}`.trim() : null],
      ["approved_at 원본", row.approved_at],
      ["approved_by_name", row.approved_by_name],
      ["같은 날짜 조직 100 행 수", sameDay.length],
      ["같은 날짜 조직 100 ID", sameDay.map((other) => String(other.id)).join(", ") || null]
    );
    const home = profile?.organization_code ?? null;
    if (home && home !== "000") {
      rows.push([
        "대조",
        `기록 organization_code는 000이고 작성 계정 소속은 ${home}이다. 저장 값이 계정 소속과 다르므로, 저장 당시 화면 조직이 000이었던 기록으로 본다.`,
      ]);
    } else if (home === "000") {
      rows.push(["대조", "작성 계정 소속 조직 코드도 000이다."]);
    } else {
      rows.push(["대조", "작성 계정 소속을 프로필에서 찾지 못했다. organization_code 000은 기록에 저장된 값 그대로다."]);
    }
  }
  return rows;
}

function exceptionRows(log: LoadedLog, bundle: ExportBundle, kind: "author" | "approval"): unknown[][] {
  const rows: unknown[][] = [];
  for (const row of log.headers) {
    const userId = row[log.spec.authorUserColumn];
    const profile = userId ? bundle.profiles.get(String(userId)) : undefined;
    const approver = row.approved_by ? bundle.profiles.get(String(row.approved_by)) : undefined;
    const author = authorCompareLabel(row[log.spec.authorNameColumn], userId, profile);
    const approval = approvalConsistencyLabel(row, approver);
    const flag = kind === "author" ? author : approval;
    const skip = kind === "author" ? flag === "일치" : flag === "정합" || flag === "해당 없음";
    if (skip) continue;
    rows.push([
      log.spec.label,
      row.id,
      row[log.spec.dateColumn],
      row[log.spec.authorNameColumn],
      profile ? profile.display_name : null,
      row.status,
      row.approved_by_name,
      row.approved_at,
      flag,
    ]);
  }
  return rows;
}

function auditGrid(bundle: ExportBundle): Grid {
  const columns = [
    "target_table",
    "target_id",
    "id",
    "created_at",
    "표시KST_created_at",
    "action",
    "actor_login_id",
    "actor_display_name",
    "actor_role",
    "target_label",
    "before_data",
    "after_data",
    "meta",
  ];
  const rows: unknown[][] = [];
  bundle.audits.forEach((list) => {
    for (const audit of list) {
      rows.push(columns.map((column) => (column === "표시KST_created_at" ? formatKstDisplay(audit.created_at) : audit[column] ?? null)));
    }
  });
  return { name: "감사로그", columns, rows, idColumn: 2 };
}

export async function buildFullWorkbook(
  bundle: ExportBundle
): Promise<{ buffer: Buffer; headerTotal: number; itemTotal: number }> {
  const detail: Grid[] = [];
  const verifyRows = bundle.logs.map((log) => {
    const headers = headerGrid(log, bundle);
    const items = itemGrid(log, bundle);
    detail.push(headers);
    if (items) detail.push(items);
    const excelHeaders = headers.rows.length;
    const excelItems = items ? items.rows.length : 0;
    const ok = excelHeaders === log.headerDbCount && excelItems === log.itemDbCount;
    return [log.spec.label, log.headerDbCount, excelHeaders, log.itemDbCount, excelItems, log.nullDateCount, ok ? "일치" : "불일치"];
  });
  if (verifyRows.some((row) => row[6] !== "일치")) {
    throw new HaccpExportError("DB 건수와 추출 행 수가 일치하지 않아 파일을 만들지 않습니다.");
  }
  const headerTotal = verifyRows.reduce((sum, row) => sum + Number(row[1]), 0);
  const itemTotal = verifyRows.reduce((sum, row) => sum + Number(row[3]), 0);
  const excelHeaderTotal = verifyRows.reduce((sum, row) => sum + Number(row[2]), 0);
  const excelItemTotal = verifyRows.reduce((sum, row) => sum + Number(row[4]), 0);
  if (headerTotal !== excelHeaderTotal || itemTotal !== excelItemTotal) {
    throw new HaccpExportError("합계 건수가 일치하지 않아 파일을 만들지 않습니다.");
  }
  verifyRows.push(["합계", headerTotal, excelHeaderTotal, itemTotal, excelItemTotal, "", "일치"]);

  const file = new WorkbookFile();
  const buffer = await file.finish([
    { name: "표지", columns: ["항목", "내용"], rows: coverRows(bundle, "원본 전체") },
    {
      name: "검증",
      columns: ["일지", "DB헤더", "엑셀헤더", "DB항목", "엑셀항목", "기록일NULL", "결과"],
      rows: verifyRows,
    },
    { name: "확인사항", columns: ["항목", "내용"], rows: org000Rows(bundle) },
    {
      name: "작성자대조",
      columns: ["일지", "헤더ID", "기록일", "기록상이름", "계정표시이름", "상태", "승인자이름", "승인시각", "대조"],
      rows: bundle.logs.flatMap((log) => exceptionRows(log, bundle, "author")),
    },
    {
      name: "승인정합",
      columns: ["일지", "헤더ID", "기록일", "기록상이름", "계정표시이름", "상태", "승인자이름", "승인시각", "정합"],
      rows: bundle.logs.flatMap((log) => exceptionRows(log, bundle, "approval")),
    },
    auditGrid(bundle),
    {
      name: "삭제이력",
      columns: ["구분", "일지ID", "target_table", "target_id", "id", "created_at", "표시KST_created_at", "actor_display_name", "target_label", "before_data"],
      rows: bundle.deleteAudits.map((audit) => [
        audit.구분 ?? null,
        audit.일지ID ?? null,
        audit.target_table,
        audit.target_id,
        audit.id,
        audit.created_at,
        formatKstDisplay(audit.created_at),
        audit.actor_display_name,
        audit.target_label,
        audit.before_data ?? null,
      ]),
      idColumn: 4,
    },
    {
      name: "정정이력",
      columns: ["id", "created_at", "표시KST_created_at", "구분", "target_table", "target_ids", "target_columns", "reason", "requested_by_name", "approved_by_name", "approved_at", "표시KST_approved_at"],
      rows: bundle.corrections.map((row) => [
        row.id,
        row.created_at,
        formatKstDisplay(row.created_at),
        row.kind === "reopen" ? "승인 취소 후 재검토(앱)" : row.kind === "direct_sql" ? "직접 정정(SQL)" : row.kind ?? null,
        row.target_table,
        ((row.target_ids as unknown[] | null) ?? []).join(", "),
        ((row.target_columns as unknown[] | null) ?? []).join(", "),
        row.reason,
        row.requested_by_name,
        row.approved_by_name,
        row.approved_at,
        formatKstDisplay(row.approved_at),
      ]),
    },
    ...detail,
  ]);
  return { buffer, headerTotal, itemTotal };
}

type FloorUnit = { floor: FloorValue | null; row: unknown[] };

function floorUnits(log: LoadedLog): { columns: string[]; units: FloorUnit[] } {
  const itemKeys = orderedKeys(log.items, ["id", "log_id"]);
  const columns = ["검출층", "출처", "헤더ID", "항목ID", "원본열", "원본값", ...itemKeys];
  const units: FloorUnit[] = log.items.map((item) => {
    const floor = detectFloorFromRecord(item);
    return {
      floor,
      row: [
        floor,
        "항목",
        item.log_id ?? null,
        item.id ?? null,
        null,
        null,
        ...itemKeys.map((key) => (key in item ? item[key] : null)),
      ],
    };
  });
  if (log.spec.key === "cold") {
    for (const header of log.headers) {
      for (const column of coldTempColumns(log.headers)) {
        const floor = detectFloorFromColumn(column);
        units.push({
          floor,
          row: [
            floor,
            "온도칸",
            header.id ?? null,
            null,
            column,
            column in header ? header[column] : null,
            ...itemKeys.map(() => null),
          ],
        });
      }
    }
  }
  return { columns, units };
}

export async function buildFloorWorkbook(
  bundle: ExportBundle,
  floors: FloorValue[]
): Promise<{ buffer: Buffer; headerTotal: number; itemTotal: number }> {
  if (floors.length === 0) throw new HaccpExportError("층별 분석은 1층, 2층, 3층 중 하나 이상을 선택하세요.", 400);
  const selected = new Set(floors);
  const file = new WorkbookFile();
  const verify: unknown[][] = [];

  file.addGrid({
    name: "헤더참조",
    columns: ["일지", "id", "organization_code", "기록일", "status"],
    rows: bundle.logs.flatMap((log) =>
      log.headers.map((row) => [log.spec.label, row.id, row.organization_code, row[log.spec.dateColumn], row.status])
    ),
  });

  for (const log of bundle.logs) {
    const { columns, units } = floorUnits(log);
    const chosen = units.filter((unit) => unit.floor != null && selected.has(unit.floor));
    const unknown = units.filter((unit) => unit.floor == null);
    const other = units.length - chosen.length - unknown.length;
    file.addGrid({ name: `${log.spec.short}_선택층`, columns, rows: chosen.map((unit) => unit.row) });
    file.addGrid({ name: `${log.spec.short}_층없음`, columns, rows: unknown.map((unit) => unit.row) });
    const excelChosen = file.written.get(`${log.spec.short}_선택층`) ?? -1;
    const excelUnknown = file.written.get(`${log.spec.short}_층없음`) ?? -1;
    const sumOk = excelChosen + excelUnknown + other === units.length && excelChosen === chosen.length && excelUnknown === unknown.length;
    verify.push([log.spec.label, units.length, chosen.length, unknown.length, other, excelChosen, excelUnknown, sumOk ? "일치" : "불일치"]);
    if (!sumOk) {
      throw new HaccpExportError(`${log.spec.label} 층별 행 수가 원본 분석 단위와 다릅니다. 파일을 만들지 않습니다.`);
    }
  }

  const note = [
    ...coverRows(bundle, `층별 분석 ${floors.join(", ")}`),
    ["층별 범위", "선택층 시트는 문구 또는 온도 컬럼명에서 층이 하나로 확인되고, 선택한 층과 같은 행만 담는다."],
    ["층 없음", "층없음 시트는 층을 확인하지 못한 행이다. 2층이나 3층으로 채우지 않는다."],
    ["선택 외 층", "선택하지 않은 층으로 확인된 행은 이 파일에 넣지 않는다. 건수는 검증 시트의 선택외층에 있다. 원본 전체 파일에는 있다."],
    ["헤더", "헤더참조는 층을 나누지 않은 연결용 ID다."],
  ];
  const buffer = await file.finish([
    { name: "표지", columns: ["항목", "내용"], rows: note },
    {
      name: "검증",
      columns: ["일지", "분석단위", "선택층", "층없음", "선택외층", "엑셀선택층", "엑셀층없음", "결과"],
      rows: verify,
    },
  ]);
  const headerTotal = bundle.logs.reduce((sum, log) => sum + log.headers.length, 0);
  const itemTotal = bundle.logs.reduce((sum, log) => sum + log.items.length, 0);
  return { buffer, headerTotal, itemTotal };
}
