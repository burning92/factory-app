-- Reconstruct stock as-of date from LOT balances + production_line_lots (source of truth for usage)
-- Fixes gap when production_line_lots exist but harang_inventory_transactions are missing.

CREATE OR REPLACE FUNCTION public.harang_inventory_stock_as_of(p_as_of_date DATE)
RETURNS TABLE (
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
      l.category,
      l.item_id,
      COALESCE(SUM(l.current_quantity), 0)::NUMERIC(14, 3) AS qty
    FROM public.harang_inventory_lots l
    GROUP BY l.category, l.item_id
  ),
  usage_after AS (
    SELECT
      ln2.material_category AS category,
      ln2.material_id AS item_id,
      COALESCE(SUM(pl.quantity_used), 0)::NUMERIC(14, 3) AS qty
    FROM public.harang_production_line_lots pl
    INNER JOIN public.harang_production_lines ln2 ON ln2.id = pl.line_id
    INNER JOIN public.harang_production_headers h ON h.id = ln2.header_id
    WHERE h.production_date > p_as_of_date
    GROUP BY ln2.material_category, ln2.material_id
  ),
  tx_after AS (
    SELECT
      t.category,
      t.item_id,
      COALESCE(SUM(t.quantity_delta), 0)::NUMERIC(14, 3) AS qty
    FROM public.harang_inventory_transactions t
    WHERE t.tx_date > p_as_of_date
    GROUP BY t.category, t.item_id
  ),
  keys AS (
    SELECT category, item_id FROM lot_now
    UNION
    SELECT category, item_id FROM usage_after
    UNION
    SELECT category, item_id FROM tx_after
  )
  SELECT
    k.category,
    k.item_id,
    (
      COALESCE(n.qty, 0)
      + COALESCE(u.qty, 0)
      - COALESCE(x.qty, 0)
    )::NUMERIC(14, 3) AS stock_qty
  FROM keys k
  LEFT JOIN lot_now n ON n.category = k.category AND n.item_id = k.item_id
  LEFT JOIN usage_after u ON u.category = k.category AND u.item_id = k.item_id
  LEFT JOIN tx_after x ON x.category = k.category AND x.item_id = k.item_id;
END;
$$;

-- Backfill missing usage transactions from production_line_lots (admin/harang write)

CREATE OR REPLACE FUNCTION public.harang_backfill_missing_production_usage_tx()
RETURNS TABLE (
  inserted_count INTEGER,
  sample_reference TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_sample TEXT;
BEGIN
  IF NOT public.can_write_harang_stock_adjustment() AND public.get_my_profile_role() <> 'admin' THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  WITH missing AS (
    SELECT
      pl.id AS production_line_lot_id,
      pl.lot_id,
      pl.quantity_used,
      ln.material_category,
      ln.material_id,
      ln.material_name,
      h.production_date,
      h.production_no,
      r.request_no,
      l.item_code,
      l.item_name,
      l.unit
    FROM public.harang_production_line_lots pl
    INNER JOIN public.harang_production_lines ln ON ln.id = pl.line_id
    INNER JOIN public.harang_production_headers h ON h.id = ln.header_id
    INNER JOIN public.harang_inventory_lots l ON l.id = pl.lot_id
    LEFT JOIN public.harang_production_requests r ON r.id = h.request_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.harang_inventory_transactions t
      WHERE t.tx_type = 'usage'
        AND t.lot_id = pl.lot_id
        AND t.tx_date = h.production_date
        AND abs(t.quantity_delta + pl.quantity_used) < 0.0005
        AND (
          (r.request_no IS NOT NULL AND t.reference_no = r.request_no AND t.note = '작업지시 생산입고')
          OR (t.reference_no = h.production_no AND t.note IN ('작업지시 생산입고', '생산입고'))
        )
    )
  ),
  ins AS (
    INSERT INTO public.harang_inventory_transactions (
      category,
      item_id,
      item_code,
      item_name,
      lot_id,
      tx_date,
      tx_type,
      reference_no,
      quantity_delta,
      unit,
      note
    )
    SELECT
      m.material_category,
      m.material_id,
      m.item_code,
      m.item_name,
      m.lot_id,
      m.production_date,
      'usage',
      COALESCE(m.request_no, m.production_no),
      -m.quantity_used,
      m.unit,
      CASE WHEN m.request_no IS NOT NULL THEN '작업지시 생산입고' ELSE '생산입고' END
    FROM missing m
    RETURNING reference_no
  )
  SELECT COUNT(*)::INTEGER, MIN(reference_no)
    INTO v_count, v_sample
  FROM ins;

  RETURN QUERY SELECT v_count, v_sample;
END;
$$;

GRANT EXECUTE ON FUNCTION public.harang_backfill_missing_production_usage_tx() TO authenticated;

NOTIFY pgrst, 'reload schema';
