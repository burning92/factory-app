# 이카운트 재고 동기화 3단계: 파이프라인 (구글시트 → 앱 서버 → Supabase)

## 개요

- **흐름:** Google Apps Script(1분 주기) → 시트 읽기 → 앱 내부 sync API POST → Supabase 반영
- **구현 범위:** 동기화 파이프라인만. 앱 UI는 별도 단계.

---

## 1. 환경 변수 (앱 서버)

| 이름 | 필수 | 설명 |
|------|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` 또는 `SUPABASE_URL` | O | Supabase 프로젝트 URL (로컬 fallback: SUPABASE_URL) |
| `SUPABASE_SERVICE_ROLE_KEY` | O | Supabase service role key (서버 전용, 노출 금지) |
| `ECCOUNT_SYNC_SECRET` | O | sync API 인증용 토큰. Apps Script의 sync token과 동일한 값으로 설정 |

---

## 2. Script Properties (Google Apps Script)

프로젝트 속성 → Script properties에서 아래 키로 설정.

| 키 | 설명 |
|------|------|
| `ECCOUNT_SYNC_SPREADSHEET_ID` | 구글시트 ID (URL의 /d/ 다음 부분) |
| `ECCOUNT_SYNC_API_URL` | sync API 전체 URL. 예: `https://your-app.vercel.app/api/internal/ecount-inventory/sync` |
| `ECCOUNT_SYNC_TOKEN` | 위 `ECCOUNT_SYNC_SECRET`와 동일한 값 |

---

## 3. 사용자 실행 순서

1. **Supabase**  
   - 마이그레이션 `20260313002000_add_ecount_inventory_display_columns.sql` 실행 (아직 안 했다면).

2. **앱 서버 (Vercel/로컬)**  
   - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ECCOUNT_SYNC_SECRET` 설정 후 배포.

3. **Google Apps Script**  
   - 스프레드시트에서 확장 프로그램 → Apps Script 열기.  
   - `docs/google-apps-script/ecount_inventory_sync.gs` 내용 붙여넣기 후 저장.  
   - Script Properties에 `ECCOUNT_SYNC_SPREADSHEET_ID`, `ECCOUNT_SYNC_API_URL`, `ECCOUNT_SYNC_TOKEN` 설정.  
   - `syncEcountInventory` 함수 한 번 수동 실행하여 동작 확인.  
   - 1분 주기 트리거 설정(아래 참고).

4. **1분 주기 트리거 설정**  
   - Apps Script 편집기에서 왼쪽 **트리거**(시계 아이콘) 클릭.  
   - **트리거 추가** → 실행할 함수: `syncEcountInventory`, 이벤트 소스: **시간 기반**, 시간 간격: **1분마다** → 저장.

---

## 4. 실패 시 확인

- **Apps Script:** 보기 → 실행 기록, 로그. `[syncEcountInventory]` 로그로 API 호출 결과 확인.  
- **앱 서버:** Vercel Functions 로그 또는 로컬 터미널. 401/500 시 응답 body 확인.  
- **Supabase:** `ecount_sync_status` 테이블에서 `sync_name = 'ecount_inventory'` 행의 `last_status`, `message` 확인.

---

## 5. API 요약

- **URL:** `POST /api/internal/ecount-inventory/sync`
- **인증:** `Authorization: Bearer <ECCOUNT_SYNC_SECRET>` 또는 헤더 `x-sync-token: <ECCOUNT_SYNC_SECRET>`
- **Body:** `{ "masterRows": [...], "inventoryRows": [...], "sourceRefreshedAt": "ISO 문자열(선택)" }`
- **성공 시:** `ecount_item_master` upsert, `ecount_inventory_current` 전체 교체, `ecount_sync_status` upsert 후 200과 counts 반환.
- **실패 시:** 401(인증 실패) 또는 500(처리 오류). 500이면 `ecount_sync_status`에 `last_status='failure'`, `message`에 오류 내용 기록.
