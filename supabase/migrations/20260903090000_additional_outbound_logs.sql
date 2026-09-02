-- 추가 출고 입력 이력 (원료명·중량·LOT·입력 시각·입력자)

CREATE TABLE IF NOT EXISTS public.additional_outbound_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code TEXT NOT NULL DEFAULT '100',
  production_date DATE NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  material_name TEXT NOT NULL,
  lot_expiry TEXT NOT NULL,
  box_qty NUMERIC NOT NULL DEFAULT 0,
  bag_qty NUMERIC NOT NULL DEFAULT 0,
  g_qty NUMERIC NOT NULL DEFAULT 0,
  author_name TEXT,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_additional_outbound_logs_org_created
  ON public.additional_outbound_logs (organization_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_additional_outbound_logs_production_date
  ON public.additional_outbound_logs (organization_code, production_date DESC);

COMMENT ON TABLE public.additional_outbound_logs IS '추가 출고 입력 이력. 생산 중 추가로 올린 원료 기록.';
COMMENT ON COLUMN public.additional_outbound_logs.lot_expiry IS 'LOT(소비기한)';

ALTER TABLE public.additional_outbound_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "additional_outbound_logs_select"
  ON public.additional_outbound_logs FOR SELECT TO authenticated USING (true);

CREATE POLICY "additional_outbound_logs_insert"
  ON public.additional_outbound_logs FOR INSERT TO authenticated WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
