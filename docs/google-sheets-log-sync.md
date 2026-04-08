# Google Sheets 로그 동기화 설정

이 문서는 관리자 로그 페이지의 `구글시트 동기화` 버튼을 사용하기 위한 설정 절차입니다.

## 1) 스프레드시트 구성

Google Sheets에서 새 문서를 만들고 시트(tab) 2개를 생성합니다.

- `access_logs`
- `audit_logs`

각 시트 1행 헤더(첫 줄)는 아래 순서로 고정하세요.

### access_logs 헤더

1. `id`
2. `created_at`
3. `login_id`
4. `display_name`
5. `role`
6. `event`
7. `page_path`
8. `ip_address`
9. `user_agent`
10. `synced_at`

### audit_logs 헤더

1. `id`
2. `created_at`
3. `actor_login_id`
4. `actor_display_name`
5. `actor_role`
6. `action`
7. `target_table`
8. `target_id`
9. `target_label`
10. `before_data`
11. `after_data`
12. `meta`
13. `ip_address`
14. `user_agent`
15. `synced_at`

## 2) Apps Script 웹훅 만들기

스프레드시트에서 `확장 프로그램 > Apps Script`를 열고 아래 코드를 붙여넣습니다.

```javascript
const WEBHOOK_SECRET = "여기에-긴-랜덤-문자열";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || "{}");
    if (!body || body.secret !== WEBHOOK_SECRET) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const accessSheet = ss.getSheetByName("access_logs");
    const auditSheet = ss.getSheetByName("audit_logs");
    if (!accessSheet || !auditSheet) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "sheet_not_found" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const syncedAt = new Date().toISOString();

    // 중복 방지용 id set
    const accessExisting = new Set(readFirstColumnIds(accessSheet));
    const auditExisting = new Set(readFirstColumnIds(auditSheet));

    const accessRows = Array.isArray(body.access_rows) ? body.access_rows : [];
    const auditRows = Array.isArray(body.audit_rows) ? body.audit_rows : [];

    const accessAppend = [];
    for (const r of accessRows) {
      const id = String(r.id || "");
      if (!id || accessExisting.has(id)) continue;
      accessAppend.push([
        id,
        r.created_at || "",
        r.login_id || "",
        r.display_name || "",
        r.role || "",
        r.event || "",
        r.page_path || "",
        r.ip_address || "",
        r.user_agent || "",
        syncedAt,
      ]);
    }

    const auditAppend = [];
    for (const r of auditRows) {
      const id = String(r.id || "");
      if (!id || auditExisting.has(id)) continue;
      auditAppend.push([
        id,
        r.created_at || "",
        r.actor_login_id || "",
        r.actor_display_name || "",
        r.actor_role || "",
        r.action || "",
        r.target_table || "",
        r.target_id || "",
        r.target_label || "",
        safeStringify(r.before_data),
        safeStringify(r.after_data),
        safeStringify(r.meta),
        r.ip_address || "",
        r.user_agent || "",
        syncedAt,
      ]);
    }

    if (accessAppend.length > 0) {
      accessSheet.getRange(accessSheet.getLastRow() + 1, 1, accessAppend.length, accessAppend[0].length)
        .setValues(accessAppend);
    }
    if (auditAppend.length > 0) {
      auditSheet.getRange(auditSheet.getLastRow() + 1, 1, auditAppend.length, auditAppend[0].length)
        .setValues(auditAppend);
    }

    return ContentService.createTextOutput(
      JSON.stringify({
        ok: true,
        access_appended: accessAppend.length,
        audit_appended: auditAppend.length,
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function readFirstColumnIds(sheet) {
  const last = sheet.getLastRow();
  if (last <= 1) return [];
  return sheet.getRange(2, 1, last - 1, 1).getValues().flat().map(String);
}

function safeStringify(v) {
  if (v == null) return "";
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}
```

## 3) Apps Script 배포

1. `배포 > 새 배포`
2. 유형: `웹 앱`
3. 실행 사용자: `나`
4. 액세스: `모든 사용자`
5. 배포 후 나온 `웹 앱 URL` 복사

## 4) 서버 환경변수 설정

배포 서버(Vercel 등)에 아래를 추가하세요.

- `LOGS_SHEETS_WEBHOOK_URL` = Apps Script 웹 앱 URL
- `LOGS_SHEETS_WEBHOOK_SECRET` = Apps Script 코드의 `WEBHOOK_SECRET` 값

설정 후 서버 재배포(또는 환경변수 반영 재시작)하세요.

## 5) 사용 방법

1. 사이트에서 관리자 계정 로그인
2. `관리 > 로그 조회` 또는 상단 `관리 > 로그조회` 이동
3. 기간 선택(1/3/7/30일)
4. `구글시트 동기화` 버튼 클릭
5. 완료 메시지(접속 N건 / 감사 N건) 확인

## 6) 운영 참고

- 버튼 1회당 최근 기간 데이터 최대 2000건씩 전송합니다.
- Apps Script 쪽에서 `id` 중복을 걸러 동일 레코드는 중복 적재되지 않습니다.
- 감사 로그의 `before_data`, `after_data`, `meta`는 JSON 문자열로 저장됩니다.
- 접속 로그는 잡음 감소를 위해 중요 경로만 수집하며, `/admin/logs` 자체 조회 경로는 제외됩니다.
- 동일 사용자·동일 경로는 클라이언트 5분/서버 15분 중복 방지 정책이 적용됩니다.
- 감사 로그는 DB 트리거로 적재되어 데일리 일지, 원료사용량(`usage_calculations`), 반죽사용량(`dough_logs`), 생산기록(`production_logs`)의 작성/수정/삭제를 자동 수집합니다.
