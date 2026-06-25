-- ============================================================
-- Harang stock adjustment sessions (production cycle + packaging)
-- Phase 1: session + production target selection (draft)
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_write_harang_stock_adjustment()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT (
    public.is_harang_organization()
    OR public.get_my_profile_role() = 'admin'
  )
  AND public.get_my_profile_role() IN ('manager', 'worker', 'assistant_manager', 'admin');
$$;

GRANT EXECUTE ON FUNCTION public.can_write_harang_stock_adjustment() TO authenticated;

CREATE TABLE IF NOT EXISTS public.harang_stock_adjustment_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('production_cycle', 'packaging')),
  adjustment_date DATE NOT NULL,
  product_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  wizard_step SMALLINT NOT NULL DEFAULT 1 CHECK (wizard_step >= 1 AND wizard_step <= 4),
  memo TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  CONSTRAINT harang_stock_adjustment_sessions_product_chk CHECK (
    adjustment_type <> 'production_cycle'
    OR (product_name IS NOT NULL AND trim(product_name) <> '')
  )
);

CREATE TABLE IF NOT EXISTS public.harang_stock_adjustment_production_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.harang_stock_adjustment_sessions(id) ON DELETE CASCADE,
  production_header_id UUID NOT NULL REFERENCES public.harang_production_headers(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, production_header_id)
);

CREATE INDEX IF NOT EXISTS idx_harang_stock_adj_sessions_type_date
  ON public.harang_stock_adjustment_sessions (adjustment_type, adjustment_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_harang_stock_adj_sessions_product
  ON public.harang_stock_adjustment_sessions (product_name, status)
  WHERE product_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_harang_stock_adj_targets_header
  ON public.harang_stock_adjustment_production_targets (production_header_id);

COMMENT ON TABLE public.harang_stock_adjustment_sessions IS '재고조정 세션 (생산 사이클 / 부자재 전체)';
COMMENT ON TABLE public.harang_stock_adjustment_production_targets IS '생산 사이클 조정 시 분배 대상 생산입고';

DROP TRIGGER IF EXISTS set_harang_stock_adjustment_sessions_updated_at ON public.harang_stock_adjustment_sessions;
CREATE TRIGGER set_harang_stock_adjustment_sessions_updated_at
  BEFORE UPDATE ON public.harang_stock_adjustment_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.harang_stock_adjustment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_stock_adjustment_production_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "harang_stock_adj_sessions_select" ON public.harang_stock_adjustment_sessions;
DROP POLICY IF EXISTS "harang_stock_adj_sessions_write" ON public.harang_stock_adjustment_sessions;
CREATE POLICY "harang_stock_adj_sessions_select"
  ON public.harang_stock_adjustment_sessions FOR SELECT TO authenticated
  USING (public.can_access_harang_data() OR public.is_headquarters_organization());
CREATE POLICY "harang_stock_adj_sessions_write"
  ON public.harang_stock_adjustment_sessions FOR ALL TO authenticated
  USING (public.can_write_harang_stock_adjustment())
  WITH CHECK (public.can_write_harang_stock_adjustment());

DROP POLICY IF EXISTS "harang_stock_adj_targets_select" ON public.harang_stock_adjustment_production_targets;
DROP POLICY IF EXISTS "harang_stock_adj_targets_write" ON public.harang_stock_adjustment_production_targets;
CREATE POLICY "harang_stock_adj_targets_select"
  ON public.harang_stock_adjustment_production_targets FOR SELECT TO authenticated
  USING (public.can_access_harang_data() OR public.is_headquarters_organization());
CREATE POLICY "harang_stock_adj_targets_write"
  ON public.harang_stock_adjustment_production_targets FOR ALL TO authenticated
  USING (public.can_write_harang_stock_adjustment())
  WITH CHECK (public.can_write_harang_stock_adjustment());

NOTIFY pgrst, 'reload schema';
