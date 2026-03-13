# 이카운트 재고현황 페이지

## 경로

- `/inventory/ecount`

## 기능

- **탭:** 원재료 / 부자재 / 반제품 (ecount_inventory_current.inventory_type 기준)
- **상단 요약:** 마지막 동기화 시각(ecount_sync_status), 현재 탭명, 표시 행 수
- **검색:** 품목코드·품목명·LOT (URL 쿼리 `q`, 서버에서 필터)
- **정렬:** 품목명 오름차순 → LOT 오름차순 (서버 fetch 시 적용)
- **표 컬럼:** 품목코드, 품목명(display_item_name), LOT, 재고수량(qty), 카테고리, 1박스(g), 1개(g). synced_at/updated_at 미표시.

## 데이터 소스

- 서버 컴포넌트에서만 조회.
- `getEcountInventoryPageData(tab, searchQ)` → `getSupabaseAdmin()` 사용.
- 테이블: `ecount_inventory_current`, `ecount_sync_status`.

## 네비게이션

- 헤더 메뉴(와플) → **재고 현황** 클릭 시 `/inventory/ecount` 이동.

## 파일

- 페이지: `src/app/inventory/ecount/page.tsx`
- 조회: `src/features/ecount/inventory/getEcountInventoryPageData.ts`
- 타입: `src/features/ecount/inventory/types.ts`

수정/삭제 기능 없음. 조회 전용.
