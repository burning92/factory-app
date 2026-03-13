-- ============================================================
-- usage_calculations: 사용량 계산 페이지 저장 (생산일자·제품별)
-- ============================================================
-- Step 1~4 입력 결과: 도우 사용/폐기, 완제품 수량, 원료별 전일/당일 재고(다중 LOT)
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
  materials_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(production_date, product_name)
);

COMMENT ON TABLE public.usage_calculations IS '사용량 계산: 생산일자·제품별 도우 사용/폐기, 완제품 수량, 원료별 전일·당일 재고(다중 LOT)';
COMMENT ON COLUMN public.usage_calculations.materials_data IS '원료명별 { prior_stock: [{ qty_g, expiry }], closing_stock: [{ qty_g, expiry }] }';

CREATE INDEX IF NOT EXISTS idx_usage_calculations_production_date ON public.usage_calculations (production_date);

ALTER TABLE public.usage_calculations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage_calculations_all" ON public.usage_calculations FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
