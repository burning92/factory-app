-- ============================================================
-- production_logs 확장: 출고자, 작업자, 반죽량, 소비기한 등
-- Supabase SQL Editor에서 실행
-- ============================================================

ALTER TABLE public.production_logs
  ADD COLUMN IF NOT EXISTS preparer_name TEXT,
  ADD COLUMN IF NOT EXISTS preparer_name_2 TEXT,
  ADD COLUMN IF NOT EXISTS approver_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS expiry_date DATE,
  ADD COLUMN IF NOT EXISTS dough_qty INT,
  ADD COLUMN IF NOT EXISTS dough_waste_qty INT,
  ADD COLUMN IF NOT EXISTS operator_name TEXT;

COMMENT ON COLUMN public.production_logs.preparer_name IS '출고자/작성자';
COMMENT ON COLUMN public.production_logs.preparer_name_2 IS '작성자 2';
COMMENT ON COLUMN public.production_logs.approver_name IS '승인자';
COMMENT ON COLUMN public.production_logs.expiry_date IS '소비기한 (생산일자+364일)';
COMMENT ON COLUMN public.production_logs.dough_qty IS '반죽량';
COMMENT ON COLUMN public.production_logs.dough_waste_qty IS '반죽폐기량';
COMMENT ON COLUMN public.production_logs.operator_name IS '작업자(잔량 입력자)';
