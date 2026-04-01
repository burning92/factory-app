/**
 * 생산계획 동기화 (다중 시트: MASTER/DRAFT/END → 앱 API → Supabase)
 *
 * 지원 시트명:
 *  - PLAN_MASTER               -> plan_version = master
 *  - YYYY_M월_가안             -> plan_version = draft
 *  - YYYY_M월_END              -> plan_version = end
 *
 * POST 본문:
 *  {
 *    rows: [{
 *      plan_date, product_name, qty, category, note,
 *      plan_year, plan_month, plan_version, source_sheet_name
 *    }],
 *    sourceRefreshedAt
 *  }
 */

var CONFIG = {
  MASTER_SHEET_NAME: "PLAN_MASTER",
  /** 연도 숫자 (예: 2026). 시트 셀 참조는 아래 YEAR_CELL_A1 */
  YEAR_CELL_A1: "C2",
  /** 월 1~12. VIEW의 PLAN_MASTER!$C$3 와 대응 */
  MONTH_CELL_A1: "C3",
  /** 날짜 헤더 행 (1-based). MATCH(오늘, PLAN_MASTER!$6:$6, 0) 의 행 */
  DATE_HEADER_ROW: 6,
  /** 공휴일 표시 행 (해당 열) */
  HOLIDAY_ROW: 5,
  /** 제품명 열 (고정 C열 = 3) */
  PRODUCT_NAME_COL: 3,
  PRODUCT_FIRST_ROW: 7,
  PRODUCT_LAST_ROW: 35,
  ANNUAL_LEAVE_FIRST_ROW: 40,
  ANNUAL_LEAVE_LAST_ROW: 43,
  HALF_DAY_FIRST_ROW: 44,
  HALF_DAY_LAST_ROW: 46,
  OTHER_ROW: 47,
  FIRST_DATA_COL: 2,
  MAX_COL_SCAN: 120,
};

function getProperty_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function getSpreadsheet_() {
  var id = getProperty_("PRODUCTION_PLAN_SPREADSHEET_ID");
  if (id && String(id).trim()) {
    return SpreadsheetApp.openById(String(id).trim());
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Google Sheets WEEKDAY(..., 1) 과 동일: 일=1 … 토=7
 * @param {Date} d
 * @return {number}
 */
function weekdayType1_(d) {
  return d.getDay() + 1;
}

/**
 * VIEW_CALENDAR B5 와 동일 의미:
 * DATE(year, month, 1) - WEEKDAY(DATE(year, month, 1), 1) + 1
 * → 해당 월의 달력 그리드가 시작하는 날(일요일 시작 주의 첫 칸)
 * @param {number} year
 * @param {number} month 1..12
 * @return {Date}
 */
function calendarGridStartDate_(year, month) {
  var first = new Date(year, month - 1, 1);
  var w = weekdayType1_(first);
  var start = new Date(first.getTime());
  start.setDate(first.getDate() - (w - 1));
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * @param {*} v
 * @return {boolean}
 */
function isNonEmpty_(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  return true;
}

/**
 * @param {*} v
 * @return {string|null} YYYY-MM-DD
 */
function toIsoDate_(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    var y = v.getFullYear();
    var m = ("0" + (v.getMonth() + 1)).slice(-2);
    var d = ("0" + v.getDate()).slice(-2);
    return y + "-" + m + "-" + d;
  }
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

/**
 * 제품명 가공: (2입) 제거, 파베이크+우주인 규칙
 * @param {string} name
 * @return {{ displayName: string, doubleQty: boolean, parbakeReplace: boolean }}
 */
function parseProductRules_(name) {
  var raw = String(name != null ? name : "").trim();
  var doubleQty = raw.indexOf("(2입)") !== -1;
  var display = raw.replace(/\s*\(2입\)\s*/g, "").trim();
  var hasParbake = display.indexOf("파베이크") !== -1;
  var hasWoo = display.indexOf("우주인") !== -1;
  if (hasParbake && !hasWoo) {
    display = display.split("선인").join("판매용");
  }
  return { displayName: display, doubleQty: doubleQty, parbakeReplace: hasParbake && !hasWoo };
}

/**
 * @param {*} v
 * @return {number|null}
 */
function toNumberOrNull_(v) {
  if (v === "" || v === null || v === undefined) return null;
  var n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  if (!isFinite(n)) return null;
  return n;
}

function readYearMonth_(sheet) {
  var yRaw = sheet.getRange(CONFIG.YEAR_CELL_A1).getValue();
  var mRaw = sheet.getRange(CONFIG.MONTH_CELL_A1).getValue();
  var year = parseInt(yRaw, 10);
  var month = parseInt(mRaw, 10);
  if (!isFinite(year) || year < 2000 || year > 2100) {
    year = new Date().getFullYear();
    Logger.log("[production_plan] YEAR_CELL 비어 있거나 비정상 — 현재 연도 사용: " + year);
  }
  if (!isFinite(month) || month < 1 || month > 12) {
    month = new Date().getMonth() + 1;
    Logger.log("[production_plan] MONTH_CELL 비어 있거나 비정상 — 현재 월 사용: " + month);
  }
  return { year: year, month: month };
}

/**
 * 시트 이름에서 연월/버전 추출
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {{ matched: boolean, year: number, month: number, version: string, sheetName: string }}
 */
function parsePlanSheetMeta_(sheet) {
  var name = String(sheet.getName() || "").trim();
  if (!name) return { matched: false };
  if (name === CONFIG.MASTER_SHEET_NAME) {
    var ym = readYearMonth_(sheet);
    return {
      matched: true,
      year: ym.year,
      month: ym.month,
      version: "master",
      sheetName: name,
    };
  }
  var m = name.match(/^(\d{4})_(\d{1,2})월_(가안|END)$/i);
  if (!m) return { matched: false };
  var year = parseInt(m[1], 10);
  var month = parseInt(m[2], 10);
  if (!isFinite(year) || !isFinite(month) || month < 1 || month > 12) {
    return { matched: false };
  }
  return {
    matched: true,
    year: year,
    month: month,
    version: String(m[3]).toUpperCase() === "END" ? "end" : "draft",
    sheetName: name,
  };
}

/**
 * row6에서 날짜가 있는 열을 순회하며 API 행 생성 (시트별)
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {{year:number, month:number, version:string, sheetName:string}} meta
 * @return {{ rows: Object[], log: string }}
 */
function buildPayloadRowsFromSheet_(sheet, meta) {
  var lastCol = Math.min(sheet.getLastColumn(), CONFIG.MAX_COL_SCAN);
  var r6 = CONFIG.DATE_HEADER_ROW;
  var rows = [];
  var order = 0;

  for (var col = CONFIG.FIRST_DATA_COL; col <= lastCol; col++) {
    var cellDate = sheet.getRange(r6, col).getValue();
    var planDate = toIsoDate_(cellDate);
    if (!planDate) continue;

    // 해당 열의 날짜가 제어 연·월과 같은 달인지 (VIEW 달력 범위 밖 열 제외)
    var parts = planDate.split("-");
    var py = parseInt(parts[0], 10);
    var pm = parseInt(parts[1], 10);
    if (py !== meta.year || pm !== meta.month) continue;

    var holidayVal = sheet.getRange(CONFIG.HOLIDAY_ROW, col).getValue();
    if (isNonEmpty_(holidayVal)) {
      rows.push({
        plan_date: planDate,
        product_name: String(holidayVal).trim(),
        qty: null,
        category: "공휴일",
        note: null,
        plan_year: meta.year,
        plan_month: meta.month,
        plan_version: meta.version,
        source_sheet_name: meta.sheetName,
      });
      order++;
    }

    for (var pr = CONFIG.PRODUCT_FIRST_ROW; pr <= CONFIG.PRODUCT_LAST_ROW; pr++) {
      var pName = sheet.getRange(pr, CONFIG.PRODUCT_NAME_COL).getValue();
      var qtyRaw = sheet.getRange(pr, col).getValue();
      if (!isNonEmpty_(pName)) continue;
      var rules = parseProductRules_(pName);
      if (!rules.displayName) continue;
      var qty = toNumberOrNull_(qtyRaw);
      if (rules.doubleQty && qty !== null) qty = qty * 2;
      if (qty === null || qty === 0) continue;
      rows.push({
        plan_date: planDate,
        product_name: rules.displayName,
        qty: qty,
        category: "생산",
        note: null,
        plan_year: meta.year,
        plan_month: meta.month,
        plan_version: meta.version,
        source_sheet_name: meta.sheetName,
      });
      order++;
    }

    for (var ar = CONFIG.ANNUAL_LEAVE_FIRST_ROW; ar <= CONFIG.ANNUAL_LEAVE_LAST_ROW; ar++) {
      var an = sheet.getRange(ar, col).getValue();
      if (!isNonEmpty_(an)) continue;
      rows.push({
        plan_date: planDate,
        product_name: String(an).trim(),
        qty: null,
        category: "연차",
        note: null,
        plan_year: meta.year,
        plan_month: meta.month,
        plan_version: meta.version,
        source_sheet_name: meta.sheetName,
      });
      order++;
    }
    for (var hr = CONFIG.HALF_DAY_FIRST_ROW; hr <= CONFIG.HALF_DAY_LAST_ROW; hr++) {
      var hn = sheet.getRange(hr, col).getValue();
      if (!isNonEmpty_(hn)) continue;
      rows.push({
        plan_date: planDate,
        product_name: String(hn).trim(),
        qty: null,
        category: "반차",
        note: null,
        plan_year: meta.year,
        plan_month: meta.month,
        plan_version: meta.version,
        source_sheet_name: meta.sheetName,
      });
      order++;
    }
    var ot = sheet.getRange(CONFIG.OTHER_ROW, col).getValue();
    if (isNonEmpty_(ot)) {
      rows.push({
        plan_date: planDate,
        product_name: String(ot).trim(),
        qty: null,
        category: "기타",
        note: null,
        plan_year: meta.year,
        plan_month: meta.month,
        plan_version: meta.version,
        source_sheet_name: meta.sheetName,
      });
      order++;
    }
  }

  // sort_order 는 서버 normalize 에서 배열 순서로 부여됨 — 전송 순서 유지
  var log =
    "[production_plan] sheet=" +
    meta.sheetName +
    ", built rows=" +
    rows.length +
    " (year=" +
    meta.year +
    ", month=" +
    meta.month +
    ", version=" +
    meta.version +
    ")";
  return { rows: rows, log: log };
}

function buildPayloadRowsFromAllPlanSheets_(ss) {
  var rows = [];
  var logs = [];
  var metas = [];
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var meta = parsePlanSheetMeta_(sheets[i]);
    if (!meta.matched) continue;
    metas.push(meta);
  }
  for (var j = 0; j < metas.length; j++) {
    var meta2 = metas[j];
    var sheet = ss.getSheetByName(meta2.sheetName);
    if (!sheet) continue;
    var built = buildPayloadRowsFromSheet_(sheet, meta2);
    rows = rows.concat(built.rows);
    logs.push(built.log);
  }
  return { rows: rows, logs: logs, sheetCount: metas.length };
}

/**
 * 메인: 트리거 또는 수동 실행
 */
function syncProductionPlan() {
  var ss = getSpreadsheet_();
  var builtAll = buildPayloadRowsFromAllPlanSheets_(ss);
  if (builtAll.sheetCount === 0) {
    throw new Error("동기화 대상 시트를 찾지 못했습니다. (PLAN_MASTER, YYYY_M월_가안, YYYY_M월_END)");
  }
  for (var i = 0; i < builtAll.logs.length; i++) Logger.log(builtAll.logs[i]);

  var apiUrl = getProperty_("PRODUCTION_PLAN_API_URL");
  var token = getProperty_("PRODUCTION_PLAN_SYNC_TOKEN");
  if (!apiUrl || !String(apiUrl).trim()) {
    throw new Error("Script Property PRODUCTION_PLAN_API_URL 을 설정하세요.");
  }
  if (!token || !String(token).trim()) {
    throw new Error("Script Property PRODUCTION_PLAN_SYNC_TOKEN 을 설정하세요. (서버 ECCOUNT_SYNC_SECRET 과 동일)");
  }

  var payload = {
    rows: builtAll.rows,
    sourceRefreshedAt: new Date().toISOString(),
  };

  var options = {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    headers: {
      Authorization: "Bearer " + String(token).trim(),
    },
    payload: JSON.stringify(payload),
  };

  var res = UrlFetchApp.fetch(String(apiUrl).trim(), options);
  var code = res.getResponseCode();
  var body = res.getContentText();
  Logger.log("[production_plan] HTTP " + code + " " + body);
  if (code < 200 || code >= 300) {
    throw new Error("sync failed: " + code + " " + body);
  }
}

/**
 * 연·월만 확인 (API 호출 없음)
 */
function testBuildProductionPlanRows() {
  var ss = getSpreadsheet_();
  var builtAll = buildPayloadRowsFromAllPlanSheets_(ss);
  if (builtAll.sheetCount === 0) {
    Logger.log("동기화 대상 시트 없음");
    return;
  }
  for (var i = 0; i < builtAll.logs.length; i++) Logger.log(builtAll.logs[i]);
  Logger.log("[production_plan] total rows=" + builtAll.rows.length + ", sheets=" + builtAll.sheetCount);
  Logger.log(JSON.stringify(builtAll.rows.slice(0, Math.min(20, builtAll.rows.length))));
}

/**
 * 커스텀 메뉴 등록 (기존 Code.gs onOpen에서 호출 권장)
 * - 메뉴명: 생산계획
 * - 페이지 반영: syncProductionPlanFromMenu
 * - 데이터 미리보기: previewProductionPlanFromMenu
 */
function addProductionPlanMenu_() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("생산계획")
    .addItem("페이지 반영", "syncProductionPlanFromMenu")
    .addItem("데이터 미리보기", "previewProductionPlanFromMenu")
    .addToUi();
}

/**
 * 메뉴용 실행 래퍼: 성공/실패 알림 포함
 */
function syncProductionPlanFromMenu() {
  var ui = SpreadsheetApp.getUi();
  try {
    syncProductionPlan();
    ui.alert("생산계획", "페이지 반영(동기화)이 완료되었습니다.", ui.ButtonSet.OK);
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    ui.alert("생산계획 동기화 실패", msg, ui.ButtonSet.OK);
    throw err;
  }
}

/**
 * 메뉴용 미리보기 래퍼: 상위 20건 로그 + 완료 안내
 */
function previewProductionPlanFromMenu() {
  var ui = SpreadsheetApp.getUi();
  try {
    testBuildProductionPlanRows();
    ui.alert("생산계획", "데이터 미리보기를 실행했습니다. 실행 로그에서 결과를 확인하세요.", ui.ButtonSet.OK);
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    ui.alert("생산계획 미리보기 실패", msg, ui.ButtonSet.OK);
    throw err;
  }
}

/**
 * 단독 사용용 onOpen.
 * 이미 기존 Code.gs에 onOpen이 있으면 이 함수를 그대로 추가하지 말고,
 * 기존 onOpen 내부에서 addProductionPlanMenu_()만 호출하세요.
 */
function onOpenProductionPlanMenuOnly() {
  addProductionPlanMenu_();
}
