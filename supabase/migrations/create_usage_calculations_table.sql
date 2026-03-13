-- ============================================================
-- usage_calculations: 사용량 계산 (Step 1~3) 저장 테이블
-- ============================================================
-- Supabase SQL Editor에 붙여넣기 후 Run 실행
-- ============================================================

CREATE TABLE IF NOT EXISTS public.usage_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_date DATE NOT NULL,
  product_name TEXT NOT NULL,
  author_name TEXT,
  dough_usage_g NUMERIC,
  dough_usage_qty NUMERIC,
  dough_waste_g NUMERIC,
  dough_waste_qty NUMERIC,
  finished_qty_expected NUMERIC,
  finished_qty_actual NUMERIC,
  parbake_add_qty NUMERIC,
  parbake_woozooin_qty NUMERIC,
  parbake_sales_qty NUMERIC,
  materials_data JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'stock_entered', 'closed')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (production_date, product_name)
);

COMMENT ON TABLE public.usage_calculations IS '사용량 계산: 생산일자·제품별 기본정보, 도우 내역, 원료 재고(Step 1~3). 마감은 목록 상세에서 진행';
COMMENT ON COLUMN public.usage_calculations.author_name IS '작성자(일반반)';
COMMENT ON COLUMN public.usage_calculations.dough_usage_qty IS '도우 반죽량 (EA)';
COMMENT ON COLUMN public.usage_calculations.dough_waste_qty IS '도우 폐기량 (EA)';
COMMENT ON COLUMN public.usage_calculations.materials_data IS '원료별 전일/당일 재고 다중 LOT JSON';
COMMENT ON COLUMN public.usage_calculations.status IS 'draft=작성중, stock_entered=마감전, closed=마감완료';

CREATE INDEX IF NOT EXISTS idx_usage_calculations_production_date ON public.usage_calculations (production_date);

ALTER TABLE public.usage_calculations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_calculations_all"
  ON public.usage_calculations FOR ALL
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
