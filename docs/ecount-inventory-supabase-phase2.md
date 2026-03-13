# 이카운트 재고 Supabase 2단계: 테이블 및 LOT 처리

## 1. 생성 테이블 요약

| 테이블 | 역할 |
|--------|------|
| **ecount_item_master** | 품목마스터. item_code PK, inventory_type(원재료/부자재/반제품), box_weight_g/unit_weight_g 기본 0, is_active 기본 true |
| **ecount_inventory_current** | 재고현황. (item_code, lot_no) UNIQUE, item_code 인덱스만(FK 없음). synced_at, updated_at. 앱은 이 테이블 주로 읽음. master 조인은 앱/쿼리에서 |
| **ecount_sync_status** | 동기화 현재 상태. sync_name PK, last_synced_at, last_status, row_count, message, updated_at. sync_name별 1행 |

- 조인: `ecount_inventory_current.item_code` = `ecount_item_master.item_code` (앱/쿼리에서 수행. FK 없음으로 RAW만 있고 마스터 없는 코드도 적재 가능)
- `inventory_type` CHECK: `'원재료', '부자재', '반제품'`
- `updated_at`: DEFAULT now(), UPDATE 시 트리거로 자동 갱신. inventory_current 에는 `synced_at` 추가
- qty / box_weight_g / unit_weight_g: 기본값 0

**RLS:** 이 3개 테이블은 서버(동기화/백엔드) 전용으로 두고 RLS를 켜지 않음(옵션 A). MVP에서 클라이언트가 직접 이 테이블을 읽지 않고 서버만 접근하므로, 익명 전체 허용 정책을 두기보다 RLS 미사용이 더 단순함.

---

## 2. LOT 없는 행 처리

| 방식 | 설명 |
|------|------|
| **제외** | LOT(시리얼/로트No.)가 비어 있는 행은 동기화 시 아예 넣지 않음. 수량 누락 가능. |
| **NO_LOT 치환** | LOT가 비어 있으면 `lot_no`를 `'NO_LOT'`(또는 고정 상수)로 넣어서 한 행으로 적재. 수량 유지, 앱에서 구분 가능. |

**권장:** **NO_LOT 치환**.  
LOT 없는 재고도 수량을 잃지 않고 보여주고, 나중에 LOT가 생기면 그때 분리하는 편이 MVP에 유리함.  
동기화 시 `lot_no`가 빈 문자열/공백/null이면 `'NO_LOT'`로 치환 후 upsert.

---

## 3. Supabase에서 실행 순서

1. **SQL Editor**에서 `supabase/migrations/20260313000000_create_ecount_inventory_tables.sql` 전체 내용 열기
2. **Run** 한 번으로 실행 (테이블·인덱스·트리거·RLS 정책 순서대로 실행됨)
3. 필요 시 `ecount_item_master`, `ecount_inventory_current`, `ecount_sync_status` 테이블 존재 여부 확인

동기화 스크립트·Apps Script·Next.js UI는 이 단계 이후 진행.
