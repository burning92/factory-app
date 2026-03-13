-- ============================================================
-- usage_calculations: 수량(EA) 전용 파베이크 필드 추가
-- ============================================================
-- 도우 반죽량/도우 폐기량/완제품 생산수량은 기존 컬럼 활용.
-- 추가 파베이크 수량, 우주인 파베이크 생산량, 판매용 파베이크 생산량 추가.
-- ============================================================

ALTER TABLE public.usage_calculations
  ADD COLUMN IF NOT EXISTS parbake_add_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS parbake_woozooin_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS parbake_sales_qty NUMERIC;

COMMENT ON COLUMN public.usage_calculations.parbake_add_qty IS '추가 파베이크 수량 (EA)';
COMMENT ON COLUMN public.usage_calculations.parbake_woozooin_qty IS '우주인 파베이크 생산량 (EA)';
COMMENT ON COLUMN public.usage_calculations.parbake_sales_qty IS '판매용 파베이크 생산량 (EA)';

NOTIFY pgrst, 'reload schema';
