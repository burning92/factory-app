-- ============================================================
-- production_logs 테이블에 관리일지/파베이크 등에서 사용하는 컬럼 추가
-- ============================================================
-- 사용법: 아래 전체를 Supabase 대시보드 → SQL Editor에 붙여넣고 Run.
-- IF NOT EXISTS 덕분에 이미 있는 컬럼은 건너뛰고, 없는 컬럼만 추가됩니다.
-- (Postgres 9.5+ / Supabase 기본 환경에서 지원)
-- 마지막 NOTIFY 로 스키마 캐시를 새로고침해 API가 새 컬럼을 인식하도록 합니다.
-- ============================================================

-- 출고자 (작성자1) — insert 시 항상 사용
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS preparer_name TEXT;

-- 작성자2 (관리일지)
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS preparer_name_2 TEXT;

-- 승인자 (관리일지)
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS approver_name TEXT;

-- 소비기한 (날짜 문자열, 예: 2025-02-26)
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS expiry_date TEXT;

-- 반죽량
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS dough_qty NUMERIC;

-- 반죽 폐기량
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS dough_waste_qty NUMERIC;

-- 작업자 (관리일지)
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS operator_name TEXT;

-- 1차 실시간 사용량 (g)
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS primary_usage_g NUMERIC;

-- 소스 폐기량 (g) / 파베이크 정산
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS source_waste_g NUMERIC;

-- 소스 폐기량 소비기한
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS source_waste_expiry TEXT;

-- 완제품 생산량 (파베이크 run 메타)
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS finished_product_qty NUMERIC;

-- 파베이크 사용 라인 (jsonb, 예: [{"qty": 10, "expiry": "2025-03-01"}])
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS parbake_used_lines JSONB;

-- 보관용 파베이크 수량
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS parbake_storage_qty NUMERIC;

-- 판매용 파베이크 수량
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS parbake_sales_qty NUMERIC;

-- 잔량 마감 시 입력값: 전일 재고 합계(g), 당일 잔량 합계(g) — 리스트에 계산 공식 표시용
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS prior_stock_g NUMERIC;
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS closing_remainder_g NUMERIC;

-- Supabase(PostgREST) 스키마 캐시 강제 새로고침 (API가 새 컬럼 인식)
NOTIFY pgrst, 'reload schema';
