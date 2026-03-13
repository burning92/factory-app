/**
 * 이카운트 재고 동기화 (구글시트 → 앱 서버 → Supabase)
 * - 시트: 재고_품목마스터, 시리얼/로트No. 재고현황->원재료,부재료,반제품
 * - RAW 갱신시각: 시트 "동기화설정" B2 (ISO 문자열). 없으면 미전송.
 * - 1분 주기: syncEcountInventory(). 이카운트에서 시트 덮어쓴 뒤 markEcountRawRefreshedAt() → syncEcountInventory() 권장.
 */

var CONFIG = {
  /** Script Properties 키 (설정 시 파일/프로젝트 속성에서 설정) */
  SPREADSHEET_ID: "ECCOUNT_SYNC_SPREADSHEET_ID",
  API_URL: "ECCOUNT_SYNC_API_URL",
  SYNC_TOKEN: "ECCOUNT_SYNC_TOKEN",
};

/**
 * Script Properties에서 값 조회
 */
function getProperty(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

/**
 * 시트에서 헤더 행(1행) 기준으로 객체 배열 생성
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Object[]}
 */
function sheetToRows(sheet) {
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];
  var headers = data[0].map(function (h) {
    return (h != null ? String(h).trim() : "");
  });
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) row[headers[j]] = data[i][j];
    }
    rows.push(row);
  }
  return rows;
}

/**
 * 품목마스터 시트 컬럼명 → API 필드 매핑 (시트 헤더가 다르면 여기서 키 변환)
 * 시트 헤더가 코드/품목명/재고분류/카테고리/1박스(g)/1개(g)/사용여부/비고 이면 그대로 사용 가능.
 */
function mapMasterRow(row) {
  return {
    item_code: row["코드"] != null ? String(row["코드"]).trim() : (row["item_code"] != null ? String(row["item_code"]).trim() : ""),
    item_name: row["품목명"] != null ? String(row["품목명"]).trim() : (row["item_name"] != null ? String(row["item_name"]).trim() : ""),
    inventory_type: row["재고분류"] != null ? String(row["재고분류"]).trim() : (row["inventory_type"] != null ? String(row["inventory_type"]).trim() : ""),
    category: row["카테고리"] != null ? String(row["카테고리"]).trim() : (row["category"] != null ? String(row["category"]).trim() : ""),
    box_weight_g: row["1박스(g)"] != null ? row["1박스(g)"] : (row["box_weight_g"] != null ? row["box_weight_g"] : ""),
    unit_weight_g: row["1개(g)"] != null ? row["1개(g)"] : (row["unit_weight_g"] != null ? row["unit_weight_g"] : ""),
    use_yn: row["사용여부"] != null ? String(row["사용여부"]).trim() : (row["use_yn"] != null ? String(row["use_yn"]).trim() : ""),
    note: row["비고"] != null ? String(row["비고"]).trim() : (row["note"] != null ? String(row["note"]).trim() : ""),
  };
}

/**
 * 재고현황 시트 컬럼명 → API 필드 매핑
 * 시트 헤더가 품목코드(또는 코드)/품목명/시리얼·로트No./재고수량 등일 수 있음.
 */
function mapInventoryRow(row) {
  var code = row["품목코드"] != null ? row["품목코드"] : (row["코드"] != null ? row["코드"] : row["item_code"]);
  var name = row["품목명"] != null ? row["품목명"] : (row["raw_item_name"] != null ? row["raw_item_name"] : "");
  var lot = row["시리얼/로트No."] != null ? row["시리얼/로트No."] : (row["로트번호"] != null ? row["로트번호"] : (row["lot_no"] != null ? row["lot_no"] : ""));
  var qty = row["재고수량"] != null ? row["재고수량"] : (row["qty"] != null ? row["qty"] : "");
  return {
    item_code: code != null ? String(code).trim() : "",
    raw_item_name: name != null ? String(name).trim() : "",
    lot_no: lot != null ? String(lot).trim() : "",
    qty: qty,
  };
}

/**
 * 메인 실행 함수. 1분 주기 trigger에서 호출.
 * Script Properties: ECCOUNT_SYNC_SPREADSHEET_ID, ECCOUNT_SYNC_API_URL, ECCOUNT_SYNC_TOKEN
 */
function syncEcountInventory() {
  var spreadsheetId = getProperty("ECCOUNT_SYNC_SPREADSHEET_ID");
  var apiUrl = getProperty("ECCOUNT_SYNC_API_URL");
  var syncToken = getProperty("ECCOUNT_SYNC_TOKEN");

  if (!spreadsheetId || !apiUrl || !syncToken) {
    Logger.log("[syncEcountInventory] Missing Script Properties. Set ECCOUNT_SYNC_SPREADSHEET_ID, ECCOUNT_SYNC_API_URL, ECCOUNT_SYNC_TOKEN.");
    return;
  }

  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var masterSheet = spreadsheet.getSheetByName("재고_품목마스터");
  var inventorySheet = spreadsheet.getSheetByName("시리얼/로트No. 재고현황->원재료,부재료,반제품");

  if (!masterSheet) {
    Logger.log("[syncEcountInventory] Sheet not found: 재고_품목마스터");
    return;
  }
  if (!inventorySheet) {
    Logger.log("[syncEcountInventory] Sheet not found: 시리얼/로트No. 재고현황->원재료,부재료,반제품");
    return;
  }

  var masterRows = sheetToRows(masterSheet).map(mapMasterRow);
  var inventoryRows = sheetToRows(inventorySheet).map(mapInventoryRow);

  var sourceRefreshedAt = null;
  var configSheet = spreadsheet.getSheetByName("동기화설정");
  if (configSheet) {
    var rawVal = configSheet.getRange("B2").getValue();
    if (rawVal && typeof rawVal === "string" && rawVal.trim()) sourceRefreshedAt = rawVal.trim();
  }

  var payload = {
    masterRows: masterRows,
    inventoryRows: inventoryRows,
  };
  if (sourceRefreshedAt) payload.sourceRefreshedAt = sourceRefreshedAt;

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    headers: {
      "x-sync-token": syncToken,
    },
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(apiUrl, options);
  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code !== 200) {
    Logger.log("[syncEcountInventory] API error " + code + ": " + body);
    return;
  }

  try {
    var result = JSON.parse(body);
    Logger.log("[syncEcountInventory] ok: master upserted=" + (result.master && result.master.upserted) + ", inventory inserted=" + (result.inventory && result.inventory.inserted));
  } catch (e) {
    Logger.log("[syncEcountInventory] response: " + body);
  }
}

/**
 * RAW 마지막 갱신시각을 "동기화설정" 시트 B2에 기록.
 * 이카운트에서 구글시트에 데이터를 덮어쓴 뒤 이 함수를 실행한 다음 syncEcountInventory() 호출.
 */
function markEcountRawRefreshedAt() {
  var spreadsheetId = getProperty("ECCOUNT_SYNC_SPREADSHEET_ID");
  if (!spreadsheetId) {
    Logger.log("[markEcountRawRefreshedAt] ECCOUNT_SYNC_SPREADSHEET_ID not set.");
    return;
  }
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var sheet = spreadsheet.getSheetByName("동기화설정");
  if (!sheet) {
    sheet = spreadsheet.insertSheet("동기화설정");
    sheet.getRange("A1").setValue("RAW 마지막 갱신시각 (ISO)");
    sheet.getRange("B1").setValue("값");
  }
  var iso = new Date().toISOString();
  sheet.getRange("B2").setValue(iso);
  Logger.log("[markEcountRawRefreshedAt] B2 set to " + iso);
}
