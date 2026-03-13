-- ============================================================
-- production_logs: 잔량 마감 UI용 컬럼 (전일 재고, 당일 잔량)
-- ============================================================
-- [마감 처리 및 사용량 계산] 시 closing_remainder_g / prior_stock_g 에러 나면 실행.
-- Supabase SQL Editor에 붙여넣고 Run. 이미 있으면 건너뜁니다.
-- 다른 컬럼(예: preparer_name, approver_name 등) 에러가 나면
-- add_production_logs_columns.sql 통합 스크립트를 실행하세요.
-- ============================================================

-- 전일 재고 합계(g) — 잔량 마감 시 입력, 리스트 표시용
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS prior_stock_g NUMERIC;

-- 당일 잔량 합계(g) — 잔량 마감 시 입력, 리스트 표시용
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS closing_remainder_g NUMERIC;

-- Supabase(PostgREST) 스키마 캐시 강제 새로고침
NOTIFY pgrst, 'reload schema';
