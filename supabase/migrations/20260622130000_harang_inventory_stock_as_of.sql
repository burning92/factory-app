-- Ledger balance as of date (sum of quantity_delta through p_as_of_date inclusive)

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
  SELECT
    t.category,
    t.item_id,
    COALESCE(SUM(t.quantity_delta), 0)::NUMERIC(14, 3) AS stock_qty
  FROM public.harang_inventory_transactions t
  WHERE t.tx_date <= p_as_of_date
  GROUP BY t.category, t.item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.harang_inventory_stock_as_of(DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
