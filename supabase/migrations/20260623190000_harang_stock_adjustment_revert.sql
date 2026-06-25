-- Revert a confirmed production-cycle stock adjustment (restore production usage + inventory, return session to draft)

CREATE OR REPLACE FUNCTION public.revert_harang_stock_cycle_adjustment(p_session_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_ref TEXT;
  v_delta RECORD;
  v_line RECORD;
  v_pl RECORD;
  v_hdr_delta INTEGER;
  v_pl_sum NUMERIC(14, 3);
  v_pl_assigned NUMERIC(14, 3);
  v_pl_add NUMERIC(14, 3);
  v_pl_new_qty NUMERIC(14, 3);
  v_lot_ids UUID[];
  v_tx RECORD;
  v_line_id UUID;
BEGIN
  IF NOT public.can_write_harang_stock_adjustment() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  SELECT * INTO v_session
  FROM public.harang_stock_adjustment_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '조정 세션을 찾을 수 없습니다.';
  END IF;
  IF v_session.status <> 'confirmed' THEN
    RAISE EXCEPTION '확정된 조정만 되돌릴 수 있습니다.';
  END IF;
  IF v_session.adjustment_type <> 'production_cycle' THEN
    RAISE EXCEPTION '생산 사이클 조정만 되돌릴 수 있습니다.';
  END IF;

  v_ref := 'SA-' || left(replace(p_session_id::TEXT, '-', ''), 12);

  FOR v_delta IN
    SELECT
      pd.production_header_id,
      pd.usage_delta_qty,
      sr.material_category,
      sr.material_id,
      sr.lot_date
    FROM public.harang_stock_adjustment_production_deltas pd
    INNER JOIN public.harang_stock_adjustment_serial_results sr ON sr.id = pd.serial_result_id
    WHERE pd.session_id = p_session_id
    ORDER BY sr.lot_date, pd.production_header_id
  LOOP
    v_hdr_delta := (-round(v_delta.usage_delta_qty))::INTEGER;
    IF v_hdr_delta = 0 THEN
      CONTINUE;
    END IF;

    SELECT array_agg(l.id ORDER BY l.inbound_date, l.id)
      INTO v_lot_ids
    FROM public.harang_inventory_lots l
    WHERE l.category = v_delta.material_category
      AND l.item_id = v_delta.material_id
      AND l.lot_date = v_delta.lot_date;

    IF v_lot_ids IS NULL OR array_length(v_lot_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'LOT를 찾을 수 없습니다: %', v_delta.lot_date;
    END IF;

    SELECT ln.id INTO v_line
    FROM public.harang_production_lines ln
    WHERE ln.header_id = v_delta.production_header_id
      AND ln.material_category = v_delta.material_category
      AND ln.material_id = v_delta.material_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE public.harang_production_lines
    SET usage_qty = GREATEST(0, usage_qty + v_hdr_delta)
    WHERE id = v_line.id;

    SELECT COALESCE(SUM(pl.quantity_used), 0) INTO v_pl_sum
    FROM public.harang_production_line_lots pl
    WHERE pl.line_id = v_line.id
      AND pl.lot_id = ANY(v_lot_ids);

    v_pl_assigned := 0;

    IF v_pl_sum > 0 THEN
      FOR v_pl IN
        SELECT pl.id, pl.quantity_used
        FROM public.harang_production_line_lots pl
        WHERE pl.line_id = v_line.id
          AND pl.lot_id = ANY(v_lot_ids)
        ORDER BY pl.id
      LOOP
        IF v_pl.id = (
          SELECT pl2.id
          FROM public.harang_production_line_lots pl2
          WHERE pl2.line_id = v_line.id AND pl2.lot_id = ANY(v_lot_ids)
          ORDER BY pl2.id DESC
          LIMIT 1
        ) THEN
          v_pl_add := v_hdr_delta - v_pl_assigned;
        ELSE
          v_pl_add := round((v_hdr_delta * v_pl.quantity_used) / v_pl_sum);
          v_pl_assigned := v_pl_assigned + v_pl_add;
        END IF;

        v_pl_new_qty := v_pl.quantity_used + v_pl_add;
        IF v_pl_new_qty <= 0.0005 THEN
          DELETE FROM public.harang_production_line_lots WHERE id = v_pl.id;
        ELSE
          UPDATE public.harang_production_line_lots
          SET quantity_used = v_pl_new_qty
          WHERE id = v_pl.id;
        END IF;
      END LOOP;
    ELSIF v_hdr_delta > 0 THEN
      INSERT INTO public.harang_production_line_lots (line_id, lot_id, quantity_used)
      VALUES (v_line.id, v_lot_ids[1], v_hdr_delta);
    END IF;
  END LOOP;

  FOR v_line_id IN
    SELECT DISTINCT ln.id
    FROM public.harang_stock_adjustment_production_targets t
    INNER JOIN public.harang_production_lines ln ON ln.header_id = t.production_header_id
    WHERE t.session_id = p_session_id
  LOOP
    UPDATE public.harang_production_lines
    SET lot_dates_summary = (
      SELECT string_agg(d, ' · ' ORDER BY d)
      FROM (
        SELECT DISTINCT to_char(l.lot_date, 'YYYY.MM.DD') AS d
        FROM public.harang_production_line_lots pl
        INNER JOIN public.harang_inventory_lots l ON l.id = pl.lot_id
        WHERE pl.line_id = v_line_id
      ) s
    )
    WHERE id = v_line_id;
  END LOOP;

  FOR v_tx IN
    SELECT t.id, t.lot_id, t.quantity_delta
    FROM public.harang_inventory_transactions t
    WHERE t.reference_no = v_ref
      AND t.tx_type = 'adjustment'
      AND t.note = '재고조정 확정'
  LOOP
    UPDATE public.harang_inventory_lots
    SET current_quantity = GREATEST(0, current_quantity - v_tx.quantity_delta)
    WHERE id = v_tx.lot_id;
  END LOOP;

  DELETE FROM public.harang_inventory_transactions
  WHERE reference_no = v_ref
    AND tx_type = 'adjustment'
    AND note = '재고조정 확정';

  DELETE FROM public.harang_stock_adjustment_serial_results
  WHERE session_id = p_session_id;

  UPDATE public.harang_stock_adjustment_sessions
  SET
    status = 'draft',
    wizard_step = 4,
    confirmed_at = NULL
  WHERE id = p_session_id;

  RETURN p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_harang_stock_cycle_adjustment(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
