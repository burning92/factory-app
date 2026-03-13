# 이카운트 재고: 로컬 개발 + 실제 사용 방법

## 1. 로컬 개발 시 Supabase 설정 (localhost 에러 방지)

재고현황 페이지(`/inventory/ecount`)는 서버에서 Supabase를 사용합니다. 로컬에서도 동작시키려면 아래 env를 반드시 설정하세요.

### .env.local 예시 (로컬 전용)

```env
# Supabase (재고현황 페이지 / sync API 서버 로직)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....

# 로컬에서 sync API 호출 테스트 시에만 사용 (선택)
# ECCOUNT_SYNC_SECRET=your-secret
```

- **NEXT_PUBLIC_SUPABASE_URL**  
  Supabase 프로젝트 URL. 없으면 **SUPABASE_URL**도 fallback으로 사용합니다.
- **SUPABASE_SERVICE_ROLE_KEY**  
  서버 전용 키. 재고 조회/동기화에 필요. `.env.local`에만 두고 Git에 올리지 마세요.

설정이 없으면 재고현황 페이지에  
"재고 데이터를 불러올 수 없습니다. 로컬 개발환경의 Supabase 설정을 확인하세요."  
가 표시됩니다.

---

## 2. 시간 표시 (한국 시간, 24시간제)

- 앱 재고현황 페이지의 **마지막 동기화**, **RAW 갱신시각**은 모두 **Asia/Seoul, 24시간제**로 표시됩니다.
- 형식: `YYYY.MM.DD HH:mm` (예: 2026.03.13 17:42).

---

## 3. RAW 갱신시각이란?

- **마지막 동기화:** 앱이 구글시트를 읽어서 Supabase에 반영한 시각 (`ecount_sync_status.last_synced_at`).
- **RAW 갱신시각:** 이카운트에서 구글시트에 데이터를 **마지막으로 덮어쓴 시각**.  
  동기화 설정 시트의 B2에 기록하고, 동기화 시 API로 보내 `ecount_sync_status.source_refreshed_at`에 저장합니다.

---

## 4. 실제로 쓰는 방법 (이카운트 → 시트 → 앱)

### 4.1 Supabase

- 마이그레이션 실행:  
  `20260313002000_add_ecount_inventory_display_columns.sql`  
  `20260313003000_add_ecount_sync_source_refreshed_at.sql`

### 4.2 구글시트 + Apps Script

1. **동기화설정 시트**  
   - 시트 이름: `동기화설정`  
   - B2: RAW 마지막 갱신시각(ISO 문자열). 스크립트가 여기를 읽어 API로 보냅니다.  
   - 시트가 없으면 `markEcountRawRefreshedAt()` 실행 시 자동 생성됩니다.

2. **이카운트에서 시트를 덮어쓴 뒤**
   - Apps Script에서 **`markEcountRawRefreshedAt()`** 실행  
     → 현재 시각을 "동기화설정" B2에 기록.
   - 그 다음 **`syncEcountInventory()`** 실행  
     → 시트 데이터 + B2 값(RAW 갱신시각)을 앱 sync API로 전송.

3. **1분 트리거**  
   - 트리거로 `syncEcountInventory()`만 1분마다 돌려도 됩니다.  
   - 이때 B2에 값이 있으면 그대로 `sourceRefreshedAt`으로 전송되고, 없으면 전송하지 않습니다(RAW 갱신시각은 "-"로 표시).

### 4.3 요약

- **RAW 갱신시각을 앱에 반영하려면:**  
  이카운트에서 시트 덮어쓴 뒤 → `markEcountRawRefreshedAt()` → `syncEcountInventory()`  
- **자동 동기화만:**  
  1분 트리거로 `syncEcountInventory()` 실행. (B2를 수동으로 채워두면 RAW 갱신시각도 함께 저장됨.)

---

## 5. API Body (sourceRefreshedAt)

- `POST /api/internal/ecount-inventory/sync` Body 예시:

```json
{
  "masterRows": [...],
  "inventoryRows": [...],
  "sourceRefreshedAt": "2026-03-13T08:42:00.000Z"
}
```

- **sourceRefreshedAt**  
  선택. ISO 8601 문자열. 있으면 `ecount_sync_status.source_refreshed_at`에 저장되고, 재고현황 페이지 "RAW 갱신시각"에 한국 시간 24시간제로 표시됩니다.
