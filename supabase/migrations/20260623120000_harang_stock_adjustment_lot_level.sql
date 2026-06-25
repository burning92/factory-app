-- LOT별 실사일 기준 재고 + 재고조정 세션 LOT 실사 저장

CREATE OR REPLACE FUNCTION public.harang_inventory_stock_as_of_lot(p_as_of_date DATE)
RETURNS TABLE (
  lot_id UUID,
  category TEXT,
  item_id UUID,
  stock_qty NUMERIC(14, 3)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_as_of_date IS NULL THEN
    RAISE EXCEPTION '기준일이 필요합니다.';
  END IF;
  IF NOT (public.can_access_harang_data() OR public.is_headquarters_organization()) THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  RETURN QUERY
  WITH lot_now AS (
    SELECT
      l.id AS lot_id,
      l.category,
      l.item_id,
      l.current_quantity::NUMERIC(14, 3) AS qty
    FROM public.harang_inventory_lots l
  ),
  usage_after AS (
    SELECT
      pl.lot_id,
      COALESCE(SUM(pl.quantity_used), 0)::NUMERIC(14, 3) AS qty
    FROM public.harang_production_line_lots pl
    INNER JOIN public.harang_production_lines ln ON ln.id = pl.line_id
    INNER JOIN public.harang_production_headers h ON h.id = ln.header_id
    WHERE h.production_date > p_as_of_date
    GROUP BY pl.lot_id
  ),
  tx_after AS (
    SELECT
      t.lot_id,
      COALESCE(SUM(t.quantity_delta), 0)::NUMERIC(14, 3) AS qty
    FROM public.harang_inventory_transactions t
    WHERE t.tx_date > p_as_of_date
      AND t.lot_id IS NOT NULL
    GROUP BY t.lot_id
  ),
  keys AS (
    SELECT lot_id FROM lot_now
    UNION
    SELECT lot_id FROM usage_after
    UNION
    SELECT lot_id FROM tx_after
  )
  SELECT
    k.lot_id,
    l.category,
    l.item_id,
    (
      COALESCE(n.qty, 0)
      + COALESCE(u.qty, 0)
      - COALESCE(x.qty, 0)
    )::NUMERIC(14, 3) AS stock_qty
  FROM keys k
  INNER JOIN public.harang_inventory_lots l ON l.id = k.lot_id
  LEFT JOIN lot_now n ON n.lot_id = k.lot_id
  LEFT JOIN usage_after u ON u.lot_id = k.lot_id
  LEFT JOIN tx_after x ON x.lot_id = k.lot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.harang_inventory_stock_as_of_lot(DATE) TO authenticated;

CREATE TABLE IF NOT EXISTS public.harang_stock_adjustment_lot_physical (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.harang_stock_adjustment_sessions(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES public.harang_inventory_lots(id) ON DELETE RESTRICT,
  physical_qty NUMERIC(14, 3) NOT NULL CHECK (physical_qty >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, lot_id)
);

CREATE INDEX IF NOT EXISTS idx_harang_stock_adj_lot_physical_session
  ON public.harang_stock_adjustment_lot_physical (session_id);

COMMENT ON TABLE public.harang_stock_adjustment_lot_physical IS '재고조정 세션 LOT별 실사 수량 (draft)';

DROP TRIGGER IF EXISTS set_harang_stock_adjustment_lot_physical_updated_at
  ON public.harang_stock_adjustment_lot_physical;
CREATE TRIGGER set_harang_stock_adjustment_lot_physical_updated_at
  BEFORE UPDATE ON public.harang_stock_adjustment_lot_physical
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.harang_stock_adjustment_lot_physical ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "harang_stock_adj_lot_physical_select" ON public.harang_stock_adjustment_lot_physical;
DROP POLICY IF EXISTS "harang_stock_adj_lot_physical_write" ON public.harang_stock_adjustment_lot_physical;
CREATE POLICY "harang_stock_adj_lot_physical_select"
  ON public.harang_stock_adjustment_lot_physical FOR SELECT TO authenticated
  USING (public.can_access_harang_data() OR public.is_headquarters_organization());
CREATE POLICY "harang_stock_adj_lot_physical_write"
  ON public.harang_stock_adjustment_lot_physical FOR ALL TO authenticated
  USING (public.can_write_harang_stock_adjustment())
  WITH CHECK (public.can_write_harang_stock_adjustment());

NOTIFY pgrst, 'reload schema';
