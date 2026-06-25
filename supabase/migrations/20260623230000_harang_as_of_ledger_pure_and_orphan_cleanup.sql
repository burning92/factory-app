-- as-of 재고: 원장 합산(기준일 포함)으로 단순화 — line_lots 보정 제거
-- 220000 confirm 인코딩 오류로 되돌리기가 놓친 SA- 조정 원장 정리 + LOT 현재고 재동기화

-- ---------------------------------------------------------------------------
-- 1) LOT별 / 품목별 as-of = 원장 quantity_delta 합 (tx_date <= 기준일)
-- ---------------------------------------------------------------------------
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
  SELECT
    l.id AS lot_id,
    l.category,
    l.item_id,
    COALESCE(tx.stock_qty, 0)::NUMERIC(14, 3) AS stock_qty
  FROM public.harang_inventory_lots l
  LEFT JOIN (
    SELECT
      t.lot_id,
      SUM(t.quantity_delta)::NUMERIC(14, 3) AS stock_qty
    FROM public.harang_inventory_transactions t
    WHERE t.lot_id IS NOT NULL
      AND t.tx_date <= p_as_of_date
    GROUP BY t.lot_id
  ) tx ON tx.lot_id = l.id
  WHERE l.inbound_date <= p_as_of_date
     OR tx.lot_id IS NOT NULL;
END;
$$;

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

-- ---------------------------------------------------------------------------
-- 2) 되돌리기: note 조건 제거 (인코딩 깨진 조정 원장도 삭제)
-- ---------------------------------------------------------------------------
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
  LOOP
    UPDATE public.harang_inventory_lots
    SET current_quantity = GREATEST(0, current_quantity - v_tx.quantity_delta)
    WHERE id = v_tx.lot_id;
  END LOOP;

  DELETE FROM public.harang_inventory_transactions
  WHERE reference_no = v_ref
    AND tx_type = 'adjustment';

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

-- ---------------------------------------------------------------------------
-- 3) 확정되지 않은 세션에 남은 SA- 조정 원장 일괄 제거
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_harang_orphaned_adjustment_transactions()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx RECORD;
  v_removed INTEGER := 0;
BEGIN
  IF NOT public.can_write_harang_stock_adjustment() AND public.get_my_profile_role() <> 'admin' THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  FOR v_tx IN
    SELECT t.id, t.lot_id, t.quantity_delta
    FROM public.harang_inventory_transactions t
    LEFT JOIN public.harang_stock_adjustment_sessions s
      ON 'SA-' || left(replace(s.id::TEXT, '-', ''), 12) = t.reference_no
     AND s.status = 'confirmed'
    WHERE t.tx_type = 'adjustment'
      AND t.reference_no LIKE 'SA-%'
      AND s.id IS NULL
    ORDER BY t.tx_date, t.id
    FOR UPDATE OF t
  LOOP
    UPDATE public.harang_inventory_lots
    SET current_quantity = GREATEST(0, current_quantity - v_tx.quantity_delta)
    WHERE id = v_tx.lot_id;

    DELETE FROM public.harang_inventory_transactions
    WHERE id = v_tx.id;

    v_removed := v_removed + 1;
  END LOOP;

  RETURN jsonb_build_object('transactions_removed', v_removed);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) LOT 현재고 ← 원장 합산 동기화
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harang_sync_inventory_lots_from_ledger()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  IF NOT public.can_write_harang_stock_adjustment() AND public.get_my_profile_role() <> 'admin' THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  WITH ledger AS (
    SELECT
      t.lot_id,
      COALESCE(SUM(t.quantity_delta), 0)::NUMERIC(14, 3) AS stock_qty
    FROM public.harang_inventory_transactions t
    WHERE t.lot_id IS NOT NULL
    GROUP BY t.lot_id
  )
  UPDATE public.harang_inventory_lots l
  SET current_quantity = GREATEST(0, COALESCE(g.stock_qty, 0))
  FROM ledger g
  WHERE g.lot_id = l.id
    AND abs(l.current_quantity - g.stock_qty) > 0.0005;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('lots_updated', v_updated);
END;
$$;

GRANT EXECUTE ON FUNCTION public.harang_inventory_stock_as_of_lot(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.harang_inventory_stock_as_of(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_harang_stock_cycle_adjustment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_harang_orphaned_adjustment_transactions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.harang_sync_inventory_lots_from_ledger() TO authenticated;

-- 마이그레이션 적용 시 1회 정리
SELECT public.cleanup_harang_orphaned_adjustment_transactions();
SELECT public.harang_sync_inventory_lots_from_ledger();

NOTIFY pgrst, 'reload schema';
