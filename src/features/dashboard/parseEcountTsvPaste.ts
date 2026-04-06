import type { RawEcountProductionRow } from "@/features/dashboard/ecountProductionTypes";
import { shouldSkipEcountItemName } from "@/features/dashboard/ecountProductionImport";

export type ParseEcountPasteStats = {
  linesRead: number;
  /** 탭 열 부족·날짜 파싱 실패 */
  parseFailed: number;
  /** dateFrom~dateTo 밖 */
  skippedDateRange: number;
};

const RECEIPT_TYPE = "생산입고";

function looksLikeHeaderLine(line: string): boolean {
  const n = line.normalize("NFKC").toLowerCase();
  return (
    (n.includes("일자") && n.includes("품목")) ||
    (n.includes("변동") && n.includes("구분"))
  );
}

/**
 * 엑셀에서 복사한 탭 구분 한 줄 (이카운트보내기 형식).
 * 열: 일자-No, 품목명, 지시/로트, 수량, 변동구분, 연결전표, 유효기한 …
 */
export function parseEcountTsvLineToRawRow(line: string): RawEcountProductionRow | null {
  const parts = line.split("\t");
  if (parts.length < 5) return null;
  const col0 = parts[0].trim();
  const dm = col0.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!dm) return null;
  const movement_date = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`;
  const item_name = (parts[1] ?? "").trim();
  const qtyRaw = (parts[3] ?? "").replace(/,/g, "").trim();
  const qty = Number(qtyRaw);
  const movement_type = (parts[4] ?? "").trim();
  if (!item_name || !Number.isFinite(qty)) return null;
  return {
    movement_date,
    item_name,
    quantity: qty,
    movement_type: movement_type || RECEIPT_TYPE,
    external_ref: col0,
  };
}

export type ParseEcountPasteOptions = {
  /** YYYY-MM-DD 포함 */
  dateFrom?: string | null;
  /** YYYY-MM-DD 포함 */
  dateTo?: string | null;
};

/**
 * 메모장/엑셀에서 붙여 넣은 전체 텍스트 → 원시 행 배열 + 통계.
 * (생산입고만 남기기·품목 스킵은 호출부에서 처리)
 */
export function parseEcountSpreadsheetPaste(
  text: string,
  options?: ParseEcountPasteOptions
): { rows: RawEcountProductionRow[]; stats: ParseEcountPasteStats } {
  const stats: ParseEcountPasteStats = {
    linesRead: 0,
    parseFailed: 0,
    skippedDateRange: 0,
  };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\r/g, "").trimEnd())
    .filter((l) => l.trim().length > 0);

  const rows: RawEcountProductionRow[] = [];
  let first = true;
  const from = options?.dateFrom?.trim() || null;
  const to = options?.dateTo?.trim() || null;

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (first && looksLikeHeaderLine(line)) {
      first = false;
      continue;
    }
    first = false;
    stats.linesRead += 1;
    const row = parseEcountTsvLineToRawRow(line);
    if (!row?.movement_date) {
      stats.parseFailed += 1;
      continue;
    }
    if (from && row.movement_date < from) {
      stats.skippedDateRange += 1;
      continue;
    }
    if (to && row.movement_date > to) {
      stats.skippedDateRange += 1;
      continue;
    }
    rows.push(row);
  }

  return { rows, stats };
}

export { RECEIPT_TYPE };

export type EcountDbRow = {
  movement_date: string;
  item_name: string;
  quantity: number;
  movement_type: string;
  external_ref: string | null;
  source: string;
};

/**
 * DB 저장용: 생산입고만, 볼도우·씬도우 등은 제외 (대시보드와 동일 규칙).
 */
export function filterRawRowsForEcountDatabase(rows: RawEcountProductionRow[]): {
  payload: EcountDbRow[];
  skippedNotReceipt: number;
  skippedByItemRule: number;
  skippedInvalid: number;
} {
  let skippedNotReceipt = 0;
  let skippedByItemRule = 0;
  let skippedInvalid = 0;
  const payload: EcountDbRow[] = [];

  for (const raw of rows) {
    const movement_date = String(raw.movement_date ?? "").slice(0, 10);
    const item_name = (raw.item_name != null ? String(raw.item_name) : "").trim();
    const qty = typeof raw.quantity === "number" ? raw.quantity : Number(String(raw.quantity ?? "").replace(/,/g, ""));
    const movement_type = (raw.movement_type != null ? String(raw.movement_type).trim() : "") || RECEIPT_TYPE;
    const external_ref =
      raw.external_ref != null && String(raw.external_ref).trim()
        ? String(raw.external_ref).trim()
        : null;

    if (!movement_date || !item_name || !Number.isFinite(qty)) {
      skippedInvalid += 1;
      continue;
    }
    if (movement_type !== RECEIPT_TYPE) {
      skippedNotReceipt += 1;
      continue;
    }
    if (shouldSkipEcountItemName(item_name)) {
      skippedByItemRule += 1;
      continue;
    }

    payload.push({
      movement_date,
      item_name,
      quantity: qty,
      movement_type,
      external_ref,
      source: "ecount",
    });
  }

  return { payload, skippedNotReceipt, skippedByItemRule, skippedInvalid };
}
