import type { SheetsApi } from "@/features/haccpArchive/google/sheets";
import type { Cell, Tab } from "@/features/haccpArchive/sheetModel";

type CellData = { userEnteredValue?: Record<string, unknown> };
type Request = Record<string, unknown>;

const HEADER_FORMAT = {
  textFormat: { bold: true },
  backgroundColor: { red: 0.9, green: 0.93, blue: 0.97 },
  verticalAlignment: "MIDDLE",
  wrapStrategy: "WRAP",
};
const BODY_FORMAT = { textFormat: { bold: false }, verticalAlignment: "TOP", wrapStrategy: "WRAP" };
const DEFAULT_TAB_TITLES = new Set(["Sheet1", "시트1"]);
/** 요청 하나의 권장 크기. 넘으면 탭 단위로 나눠 보낸다(탭마다 원자적). */
export const SINGLE_REQUEST_MAX_BYTES = 8 * 1024 * 1024;

function quote(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCellData(cell: Cell, gids: Map<string, number>): CellData {
  if (cell === null || cell === "") return {};
  if (typeof cell === "number") return { userEnteredValue: { numberValue: cell } };
  if (typeof cell === "string") return { userEnteredValue: { stringValue: cell } };
  if ("url" in cell) {
    if (!/^https:\/\//.test(cell.url)) return { userEnteredValue: { stringValue: cell.label } };
    return { userEnteredValue: { formulaValue: `=HYPERLINK(${quote(cell.url)},${quote(cell.label)})` } };
  }
  const gid = gids.get(cell.tabLink);
  if (gid === undefined) return { userEnteredValue: { stringValue: cell.label } };
  return { userEnteredValue: { formulaValue: `=HYPERLINK(${quote(`#gid=${gid}`)},${quote(cell.label)})` } };
}

/**
 * 탭이 없으면 만들고, 모든 탭에 실제 편집 보호를 건다(경고만이 아님).
 * 보호 편집자는 비워 두어 스프레드시트 소유자(보관 계정)만 수정할 수 있다.
 * Drive 에서 편집 권한을 받은 사람(상위 폴더 상속 포함)도 보호된 탭의 셀은 고칠 수 없다.
 */
export async function ensureTabs(sheets: SheetsApi, spreadsheetId: string, titles: string[]): Promise<Map<string, number>> {
  let current = await sheets.getSheets(spreadsheetId);
  const missing = titles.filter((t) => !current.some((s) => s.title === t));
  if (missing.length > 0) {
    await sheets.batchUpdate(spreadsheetId, missing.map((title) => ({ addSheet: { properties: { title } } })));
    current = await sheets.getSheets(spreadsheetId);
  }
  const requests: Request[] = [];
  for (const title of titles) {
    const tab = current.find((s) => s.title === title)!;
    if (tab.protections.some((p) => !p.warningOnly && p.wholeSheet)) continue;
    for (const p of tab.protections) requests.push({ deleteProtectedRange: { protectedRangeId: p.protectedRangeId } });
    requests.push({ addProtectedRange: { protectedRange: strictProtection(tab.sheetId) } });
  }
  const defaults = current.filter((s) => DEFAULT_TAB_TITLES.has(s.title) && !titles.includes(s.title));
  for (const s of defaults) requests.push({ deleteSheet: { sheetId: s.sheetId } });
  if (requests.length > 0) await sheets.batchUpdate(spreadsheetId, requests);
  return new Map(current.filter((s) => !defaults.includes(s)).map((s) => [s.title, s.sheetId]));
}

export function strictProtection(sheetId: number) {
  return {
    range: { sheetId },
    warningOnly: false,
    editors: { users: [], groups: [], domainUsersCanEdit: false },
    description: "열람용 사본(자동 생성). 소유자 외 수정 불가. 원본은 전자일지 DB 입니다.",
  };
}

/** 탭 하나를 통째로 다시 쓰는 요청들: 크기 맞춤(남는 행 제거) → 값 → 서식 → 고정 → 필터 → 열 너비 */
export function buildTabRequests(tab: Tab, index: number, gids: Map<string, number>): Request[] {
  const sheetId = gids.get(tab.title);
  if (sheetId === undefined) throw new Error(`탭 없음: ${tab.title}`);
  const rowCount = Math.max(tab.rows.length + 1, 2);
  const columnCount = tab.columns.length;
  const full = { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount };
  const requests: Request[] = [
    {
      updateSheetProperties: {
        properties: { sheetId, index, gridProperties: { rowCount, columnCount, frozenRowCount: 1 } },
        fields: "index,gridProperties(rowCount,columnCount,frozenRowCount)",
      },
    },
    {
      updateCells: {
        range: full,
        fields: "userEnteredValue",
        rows: [
          { values: tab.columns.map((c) => toCellData(c, gids)) },
          ...tab.rows.map((row) => ({ values: tab.columns.map((_, i) => toCellData(row[i] ?? null, gids)) })),
          ...(tab.rows.length === 0 ? [{ values: tab.columns.map(() => ({})) }] : []),
        ],
      },
    },
    { repeatCell: { range: { ...full, startRowIndex: 1 }, cell: { userEnteredFormat: BODY_FORMAT }, fields: "userEnteredFormat" } },
    { repeatCell: { range: { ...full, endRowIndex: 1 }, cell: { userEnteredFormat: HEADER_FORMAT }, fields: "userEnteredFormat" } },
    { setBasicFilter: { filter: { range: full } } },
  ];
  tab.widths.forEach((pixelSize, i) => {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
        properties: { pixelSize },
        fields: "pixelSize",
      },
    });
  });
  return requests;
}

export function buildWriteRequests(tabs: Tab[], gids: Map<string, number>): Request[][] {
  return tabs.map((tab, index) => buildTabRequests(tab, index, gids));
}

/**
 * 모든 탭을 batchUpdate 하나로 다시 쓴다(원자적: 실패하면 이전 내용이 그대로 남는다).
 * 요청이 너무 크면 탭 단위로 나눠 보내며, 이때도 탭마다 원자적이다.
 */
export async function writeTabs(sheets: SheetsApi, spreadsheetId: string, tabs: Tab[]): Promise<{ batches: number }> {
  const gids = await ensureTabs(sheets, spreadsheetId, tabs.map((t) => t.title));
  const perTab = buildWriteRequests(tabs, gids);
  const all = perTab.flat();
  if (Buffer.byteLength(JSON.stringify(all)) <= SINGLE_REQUEST_MAX_BYTES) {
    await sheets.batchUpdate(spreadsheetId, all);
    return { batches: 1 };
  }
  for (const requests of perTab) await sheets.batchUpdate(spreadsheetId, requests);
  return { batches: perTab.length };
}
