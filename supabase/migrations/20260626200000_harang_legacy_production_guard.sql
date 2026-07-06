-- 레거시 생산입고(원장 미연결 line_lot) 수정/삭제 차단 — pool usage 이중 차감 방지

CREATE OR REPLACE FUNCTION public.harang_reject_legacy_unlinked_production(p_header_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.harang_production_line_lots pl
    INNER JOIN public.harang_production_lines ln ON ln.id = pl.line_id
    WHERE ln.header_id = p_header_id
      AND pl.inventory_transaction_id IS NULL
      AND pl.quantity_used > 0.0005
  ) THEN
    RAISE EXCEPTION
      '레거시 생산입고(원장 미연결 line_lot)는 수정/삭제할 수 없습니다. 데이터 복구 전에는 조회만 가능합니다.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.harang_reject_legacy_unlinked_production(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_harang_production_with_usage(
  p_header_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_head RECORD;
  v_status TEXT;
  v_request_no TEXT;
  v_lot_id UUID;
BEGIN
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  SELECT * INTO v_head
  FROM public.harang_production_headers
  WHERE id = p_header_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '생산입고를 찾을 수 없습니다.';
  END IF;

  PERFORM public.harang_reject_legacy_unlinked_production(p_header_id);

  v_request_no := NULL;
  IF v_head.request_id IS NOT NULL THEN
    SELECT r.request_no INTO v_request_no
    FROM public.harang_production_requests r
    WHERE r.id = v_head.request_id;
  END IF;

  IF v_request_no IS NULL AND v_head.request_line_id IS NOT NULL THEN
    SELECT r.request_no INTO v_request_no
    FROM public.harang_production_request_lines ln
    JOIN public.harang_production_requests r ON r.id = ln.header_id
    WHERE ln.id = v_head.request_line_id;
  END IF;

  IF v_head.request_line_id IS NOT NULL THEN
    SELECT h.status INTO v_status
    FROM public.harang_production_request_lines ln
    JOIN public.harang_production_requests h ON h.id = ln.header_id
    WHERE ln.id = v_head.request_line_id
    FOR UPDATE;

    IF v_status IN ('cancelled') THEN
      RAISE EXCEPTION '취소된 요청 라인의 생산입고는 수정/삭제할 수 없습니다.';
    END IF;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _harang_del_prod_lots (lot_id UUID PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _harang_del_prod_tx (tx_id BIGINT PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE _harang_del_prod_lots;
  TRUNCATE _harang_del_prod_tx;

  INSERT INTO _harang_del_prod_lots (lot_id)
  SELECT DISTINCT pl.lot_id
  FROM public.harang_production_lines ln
  JOIN public.harang_production_line_lots pl ON pl.line_id = ln.id
  WHERE ln.header_id = p_header_id;

  INSERT INTO _harang_del_prod_tx (tx_id)
  SELECT pl.inventory_transaction_id
  FROM public.harang_production_lines ln
  JOIN public.harang_production_line_lots pl ON pl.line_id = ln.id
  WHERE ln.header_id = p_header_id
    AND pl.inventory_transaction_id IS NOT NULL;

  INSERT INTO _harang_del_prod_tx (tx_id)
  SELECT t.id
  FROM public.harang_inventory_transactions t
  WHERE t.tx_type = 'usage'
    AND NOT EXISTS (SELECT 1 FROM _harang_del_prod_tx d WHERE d.tx_id = t.id)
    AND EXISTS (
      SELECT 1
      FROM public.harang_production_lines ln
      JOIN public.harang_production_line_lots pl ON pl.line_id = ln.id
      WHERE ln.header_id = p_header_id
        AND pl.inventory_transaction_id IS NULL
        AND pl.lot_id = t.lot_id
        AND t.tx_date = v_head.production_date
        AND abs(t.quantity_delta + pl.quantity_used) < 0.0005
        AND (
          (t.reference_no = v_head.production_no AND t.note = '생산입고')
          OR (
            v_request_no IS NOT NULL
            AND t.reference_no = v_request_no
            AND t.note = '작업지시 생산입고'
          )
        )
    )
  ON CONFLICT DO NOTHING;

  IF v_head.request_line_id IS NOT NULL THEN
    UPDATE public.harang_production_request_lines
    SET
      produced_qty = GREATEST(0, produced_qty - COALESCE(v_head.applied_to_request_qty, 0)),
      remaining_qty = remaining_qty + COALESCE(v_head.applied_to_request_qty, 0),
      updated_at = now()
    WHERE id = v_head.request_line_id;
  END IF;

  DELETE FROM public.harang_production_headers WHERE id = p_header_id;

  DELETE FROM public.harang_inventory_transactions t
  WHERE t.id IN (SELECT tx_id FROM _harang_del_prod_tx);

  FOR v_lot_id IN SELECT lot_id FROM _harang_del_prod_lots
  LOOP
    PERFORM public.harang_sync_lot_current_from_ledger(v_lot_id);
  END LOOP;

  IF v_head.request_line_id IS NOT NULL THEN
    PERFORM public.refresh_harang_request_line_reservations(v_head.request_line_id);
    PERFORM public.refresh_harang_all_open_shortage_flags();
    PERFORM public.refresh_every_harang_request_header_status();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_harang_production_from_request_line(
  p_header_id UUID,
  p_production_date DATE,
  p_request_line_id UUID,
  p_finished_qty NUMERIC,
  p_note TEXT,
  p_lines JSONB,
  p_finished_product_lot_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_head RECORD;
  v_new_id UUID;
BEGIN
  SELECT * INTO v_head FROM public.harang_production_headers WHERE id = p_header_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '생산입고를 찾을 수 없습니다.';
  END IF;

  PERFORM public.harang_reject_legacy_unlinked_production(p_header_id);

  PERFORM public.delete_harang_production_with_usage(p_header_id);

  v_new_id := public.create_harang_production_from_request_line(
    p_production_date,
    p_request_line_id,
    p_finished_qty,
    p_note,
    p_lines,
    p_finished_product_lot_date
  );

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_harang_production_with_usage(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_harang_production_from_request_line(UUID, DATE, UUID, NUMERIC, TEXT, JSONB, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
