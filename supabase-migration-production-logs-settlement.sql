-- ============================================================
-- production_logs 2차 정산 필드: 1차 사용량, 소스 폐기량, 파베이크 정산
-- Supabase SQL Editor에서 실행
-- ============================================================

ALTER TABLE public.production_logs
  ADD COLUMN IF NOT EXISTS primary_usage_g INT,
  ADD COLUMN IF NOT EXISTS source_waste_g INT,
  ADD COLUMN IF NOT EXISTS source_waste_expiry DATE,
  ADD COLUMN IF NOT EXISTS finished_product_qty INT,
  ADD COLUMN IF NOT EXISTS parbake_used_lines JSONB,
  ADD COLUMN IF NOT EXISTS parbake_storage_qty INT,
  ADD COLUMN IF NOT EXISTS parbake_sales_qty INT;

COMMENT ON COLUMN public.production_logs.primary_usage_g IS '1차 실시간 사용량 (당일 출고+전일재고-당일잔량)';
COMMENT ON COLUMN public.production_logs.source_waste_g IS '소스 폐기량(g), 2차 정산 시 도출';
COMMENT ON COLUMN public.production_logs.source_waste_expiry IS '소스 폐기량의 소비기한(출고/전일재고 연동)';
COMMENT ON COLUMN public.production_logs.finished_product_qty IS '실제 완제품 생산량';
COMMENT ON COLUMN public.production_logs.parbake_used_lines IS '미리 구워놓은 파베이크 사용 [{ "qty": 0, "expiry": "YYYY-MM-DD" }]';
COMMENT ON COLUMN public.production_logs.parbake_storage_qty IS '보관용 파베이크 생산량';
COMMENT ON COLUMN public.production_logs.parbake_sales_qty IS '판매용 파베이크 생산량';
