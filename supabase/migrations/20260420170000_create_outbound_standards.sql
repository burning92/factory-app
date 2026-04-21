-- 제품 출고 기준(참고용) 테이블: BOM과 분리 저장
CREATE TABLE IF NOT EXISTS public.outbound_standards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name TEXT NOT NULL,
  material_name TEXT NOT NULL,
  standard_g_per_ea NUMERIC(12,3) NOT NULL CHECK (standard_g_per_ea >= 0),
  basis TEXT NOT NULL CHECK (basis IN ('완제품', '도우')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.outbound_standards IS '출고 계산기 참고용 제품 출고 기준(g/ea). BOM과 독립 관리.';
COMMENT ON COLUMN public.outbound_standards.product_name IS '제품명 - 기준 조합 (예: 마르게리따 - 일반)';
COMMENT ON COLUMN public.outbound_standards.material_name IS '원료명';
COMMENT ON COLUMN public.outbound_standards.standard_g_per_ea IS '출고 기준 g/ea';
COMMENT ON COLUMN public.outbound_standards.basis IS '완제품 또는 도우 기준';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_outbound_standards_product_material_basis
  ON public.outbound_standards (product_name, material_name, basis);

CREATE INDEX IF NOT EXISTS idx_outbound_standards_product_name
  ON public.outbound_standards (product_name);

CREATE OR REPLACE FUNCTION public.set_outbound_standards_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_outbound_standards_updated_at ON public.outbound_standards;
CREATE TRIGGER trg_outbound_standards_updated_at
BEFORE UPDATE ON public.outbound_standards
FOR EACH ROW
EXECUTE FUNCTION public.set_outbound_standards_updated_at();

ALTER TABLE public.outbound_standards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "outbound_standards_all" ON public.outbound_standards;
CREATE POLICY "outbound_standards_all"
  ON public.outbound_standards
  FOR ALL
  USING (true)
  WITH CHECK (true);
