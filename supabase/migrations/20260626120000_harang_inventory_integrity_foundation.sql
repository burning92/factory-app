-- 재고 정본 = harang_inventory_transactions
-- 생산 저장 시 line_lots ↔ usage 원장 1:1 연결 + 저장 후 검증

-- ---------------------------------------------------------------------------
-- 1) line_lots ↔ usage 원장 FK (신규 저장분부터 사용, 기존은 NULL 허용)
-- ---------------------------------------------------------------------------
ALTER TABLE public.harang_production_line_lots
  ADD COLUMN IF NOT EXISTS inventory_transaction_id BIGINT
    REFERENCES public.harang_inventory_transactions(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_harang_production_line_lots_inventory_tx
  ON public.harang_production_line_lots (inventory_transaction_id)
  WHERE inventory_transaction_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) LOT 원장 합계 / current_quantity 동기화 (GREATEST(0) 사용 안 함)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harang_lot_ledger_sum(p_lot_id UUID)
RETURNS NUMERIC(14, 3)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(t.quantity_delta), 0)::NUMERIC(14, 3)
  FROM public.harang_inventory_transactions t
  WHERE t.lot_id = p_lot_id;
$$;

CREATE OR REPLACE FUNCTION public.harang_sync_lot_current_from_ledger(p_lot_id UUID)
RETURNS NUMERIC(14, 3)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sum NUMERIC(14, 3);
BEGIN
  v_sum := public.harang_lot_ledger_sum(p_lot_id);
  UPDATE public.harang_inventory_lots
  SET current_quantity = v_sum
  WHERE id = p_lot_id;
  RETURN v_sum;
END;
$$;

CREATE OR REPLACE FUNCTION public.harang_assert_lot_current_matches_ledger(p_lot_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current NUMERIC(14, 3);
  v_ledger NUMERIC(14, 3);
BEGIN
  SELECT l.current_quantity INTO v_current
  FROM public.harang_inventory_lots l
  WHERE l.id = p_lot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOT를 찾을 수 없습니다: %', p_lot_id;
  END IF;

  v_ledger := public.harang_lot_ledger_sum(p_lot_id);

  IF ABS(COALESCE(v_current, 0) - COALESCE(v_ledger, 0)) > 0.0005 THEN
    RAISE EXCEPTION 'LOT current_quantity(%)와 원장 합계(%)가 일치하지 않습니다. lot_id=%',
      v_current, v_ledger, p_lot_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.harang_list_lot_current_vs_ledger_mismatches()
RETURNS TABLE (
  category TEXT,
  item_id UUID,
  item_name TEXT,
  lot_id UUID,
  lot_date DATE,
  initial_quantity NUMERIC(14, 3),
  current_quantity NUMERIC(14, 3),
  ledger_sum NUMERIC(14, 3),
  diff NUMERIC(14, 3)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.category,
    l.item_id,
    l.item_name,
    l.id AS lot_id,
    l.lot_date,
    l.initial_quantity,
    l.current_quantity,
    COALESCE(SUM(t.quantity_delta), 0)::NUMERIC(14, 3) AS ledger_sum,
    (l.current_quantity - COALESCE(SUM(t.quantity_delta), 0))::NUMERIC(14, 3) AS diff
  FROM public.harang_inventory_lots l
  LEFT JOIN public.harang_inventory_transactions t ON t.lot_id = l.id
  GROUP BY l.id
  HAVING ABS(l.current_quantity - COALESCE(SUM(t.quantity_delta), 0)) > 0.0005
  ORDER BY l.category, l.item_name, l.lot_date;
$$;

-- ---------------------------------------------------------------------------
-- 3) 생산 라인 / 헤더 단위 정합성 검증
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harang_assert_production_line_inventory_integrity(p_line_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line RECORD;
  v_hdr RECORD;
  v_request_no TEXT;
  v_line_lot_sum NUMERIC(14, 3);
  v_pll RECORD;
  v_tx RECORD;
  v_expected_ref TEXT;
  v_expected_note TEXT;
BEGIN
  SELECT
    ln.id,
    ln.header_id,
    ln.material_name,
    ln.usage_qty
  INTO v_line
  FROM public.harang_production_lines ln
  WHERE ln.id = p_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '생산 라인을 찾을 수 없습니다: %', p_line_id;
  END IF;

  SELECT h.id, h.production_date, h.production_no, h.request_id
  INTO v_hdr
  FROM public.harang_production_headers h
  WHERE h.id = v_line.header_id;

  v_request_no := NULL;
  IF v_hdr.request_id IS NOT NULL THEN
    SELECT r.request_no INTO v_request_no
    FROM public.harang_production_requests r
    WHERE r.id = v_hdr.request_id;
  END IF;

  IF v_request_no IS NOT NULL THEN
    v_expected_ref := v_request_no;
    v_expected_note := '작업지시 생산입고';
  ELSE
    v_expected_ref := v_hdr.production_no;
    v_expected_note := '생산입고';
  END IF;

  SELECT COALESCE(SUM(pll.quantity_used), 0)::NUMERIC(14, 3) INTO v_line_lot_sum
  FROM public.harang_production_line_lots pll
  WHERE pll.line_id = p_line_id;

  IF COALESCE(v_line.usage_qty, 0) > 0.0005 AND ABS(v_line_lot_sum - v_line.usage_qty) > 0.0005 THEN
    RAISE EXCEPTION 'usage_qty(%)와 line_lots 합계(%)가 일치하지 않습니다: %',
      v_line.usage_qty, v_line_lot_sum, v_line.material_name;
  END IF;

  IF COALESCE(v_line.usage_qty, 0) <= 0.0005 AND v_line_lot_sum > 0.0005 THEN
    RAISE EXCEPTION 'usage_qty가 0인데 line_lots가 있습니다: %', v_line.material_name;
  END IF;

  FOR v_pll IN
    SELECT pll.id, pll.lot_id, pll.quantity_used, pll.inventory_transaction_id
    FROM public.harang_production_line_lots pll
    WHERE pll.line_id = p_line_id
  LOOP
    IF v_pll.inventory_transaction_id IS NULL THEN
      RAISE EXCEPTION 'line_lot에 usage 원장 연결이 없습니다 (inventory_transaction_id NULL): % lot=%',
        v_line.material_name, v_pll.lot_id;
    END IF;

    SELECT t.* INTO v_tx
    FROM public.harang_inventory_transactions t
    WHERE t.id = v_pll.inventory_transaction_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '연결된 usage 원장이 없습니다: % tx_id=%',
        v_line.material_name, v_pll.inventory_transaction_id;
    END IF;

    IF v_tx.tx_type <> 'usage' THEN
      RAISE EXCEPTION '연결된 원장이 usage가 아닙니다: %', v_line.material_name;
    END IF;

    IF v_tx.lot_id <> v_pll.lot_id THEN
      RAISE EXCEPTION 'line_lot과 usage 원장의 LOT가 다릅니다: %', v_line.material_name;
    END IF;

    IF v_tx.tx_date <> v_hdr.production_date THEN
      RAISE EXCEPTION 'usage 원장 일자가 생산일과 다릅니다: %', v_line.material_name;
    END IF;

    IF v_tx.reference_no IS DISTINCT FROM v_expected_ref THEN
      RAISE EXCEPTION 'usage 원장 reference_no가 기대값(%)과 다릅니다: % actual=%',
        v_expected_ref, v_line.material_name, v_tx.reference_no;
    END IF;

    IF COALESCE(v_tx.note, '') <> v_expected_note THEN
      RAISE EXCEPTION 'usage 원장 note가 기대값(%)과 다릅니다: %', v_expected_note, v_line.material_name;
    END IF;

    IF ABS(v_tx.quantity_delta + v_pll.quantity_used) > 0.0005 THEN
      RAISE EXCEPTION 'usage 원장 수량(%)과 line_lot(%)이 일치하지 않습니다: %',
        v_tx.quantity_delta, v_pll.quantity_used, v_line.material_name;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.harang_assert_production_inventory_integrity(p_header_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line_id UUID;
  v_lot_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.harang_production_headers h WHERE h.id = p_header_id
  ) THEN
    RAISE EXCEPTION '생산입고를 찾을 수 없습니다: %', p_header_id;
  END IF;

  FOR v_line_id IN
    SELECT ln.id
    FROM public.harang_production_lines ln
    WHERE ln.header_id = p_header_id
  LOOP
    PERFORM public.harang_assert_production_line_inventory_integrity(v_line_id);
  END LOOP;

  FOR v_lot_id IN
    SELECT DISTINCT pll.lot_id
    FROM public.harang_production_line_lots pll
    INNER JOIN public.harang_production_lines ln ON ln.id = pll.line_id
    WHERE ln.header_id = p_header_id
  LOOP
    PERFORM public.harang_assert_lot_current_matches_ledger(v_lot_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.harang_lot_ledger_sum(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.harang_sync_lot_current_from_ledger(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.harang_assert_lot_current_matches_ledger(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.harang_list_lot_current_vs_ledger_mismatches() TO authenticated;
GRANT EXECUTE ON FUNCTION public.harang_assert_production_line_inventory_integrity(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.harang_assert_production_inventory_integrity(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) create_harang_production_with_usage — 원장 우선 + FK 연결 + 저장 후 검증
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_harang_production_with_usage(
  p_production_date DATE,
  p_product_name TEXT,
  p_finished_qty NUMERIC,
  p_note TEXT,
  p_lines JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_header_id UUID;
  v_created_by UUID;
  v_seq INTEGER;
  v_production_no TEXT;
  v_line JSONB;
  v_line_id UUID;
  v_material_category TEXT;
  v_material_id UUID;
  v_material_code TEXT;
  v_material_name TEXT;
  v_bom_qty NUMERIC;
  v_unit TEXT;
  v_usage_qty NUMERIC;
  v_sort_order INT;
  v_alloc JSONB;
  v_lot_id UUID;
  v_qty NUMERIC;
  v_lot RECORD;
  v_sum_check NUMERIC;
  v_lot_summary TEXT;
  v_tx_id BIGINT;
  v_ledger_sum NUMERIC(14, 3);
BEGIN
  v_created_by := auth.uid();
  IF v_created_by IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  IF p_product_name IS NULL OR trim(p_product_name) = '' THEN
    RAISE EXCEPTION '제품명이 필요합니다.';
  END IF;
  IF p_finished_qty IS NULL OR p_finished_qty <= 0 THEN
    RAISE EXCEPTION '생산수량이 올바르지 않습니다.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '생산 상세라인이 필요합니다.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('harang-production-no-' || p_production_date::TEXT));

  SELECT COUNT(*) + 1 INTO v_seq
  FROM public.harang_production_headers
  WHERE production_date = p_production_date;

  v_production_no := to_char(p_production_date, 'YYYY/MM/DD') || '-' || v_seq::TEXT;

  INSERT INTO public.harang_production_headers (
    production_date, production_no, product_name, finished_qty, note, created_by
  )
  VALUES (
    p_production_date, v_production_no, trim(p_product_name), p_finished_qty,
    NULLIF(trim(COALESCE(p_note, '')), ''), v_created_by
  )
  RETURNING id INTO v_header_id;

  v_sort_order := 0;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_sort_order := v_sort_order + 1;
    v_material_category := COALESCE(v_line->>'material_category', '');
    v_material_id := NULLIF(v_line->>'material_id', '')::UUID;
    v_material_code := COALESCE(v_line->>'material_code', '');
    v_material_name := COALESCE(v_line->>'material_name', '');
    v_bom_qty := COALESCE((v_line->>'bom_qty')::NUMERIC, 0);
    v_unit := COALESCE(v_line->>'unit', '');
    v_usage_qty := COALESCE((v_line->>'usage_qty')::NUMERIC, -1);

    IF v_material_category NOT IN ('raw_material', 'packaging_material') THEN
      RAISE EXCEPTION '분류(material_category)가 올바르지 않습니다.';
    END IF;
    IF v_material_id IS NULL THEN
      RAISE EXCEPTION '소모 품목 ID가 필요합니다.';
    END IF;
    IF v_material_name = '' OR trim(v_unit) = '' THEN
      RAISE EXCEPTION '소모 품목명/단위는 필수입니다.';
    END IF;
    IF v_usage_qty < 0 THEN
      RAISE EXCEPTION '사용량이 올바르지 않습니다.';
    END IF;
    IF v_usage_qty > 0 AND (
      v_line->'allocations' IS NULL
      OR jsonb_typeof(v_line->'allocations') <> 'array'
      OR jsonb_array_length(v_line->'allocations') = 0
    ) THEN
      RAISE EXCEPTION '사용량이 있으면 LOT 배분(allocations)이 필요합니다: %', v_material_name;
    END IF;
    IF v_usage_qty = 0 AND COALESCE(jsonb_array_length(v_line->'allocations'), 0) > 0 THEN
      RAISE EXCEPTION '사용량이 0이면 LOT 배분이 없어야 합니다: %', v_material_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.harang_product_bom b
      WHERE b.product_name = trim(p_product_name)
        AND b.is_active = true
        AND b.material_id = v_material_id
        AND b.material_category = v_material_category
    ) THEN
      RAISE EXCEPTION 'BOM에 없는 소모품목입니다: %', v_material_name;
    END IF;

    INSERT INTO public.harang_production_lines (
      header_id, material_category, material_id, material_code, material_name,
      bom_qty, unit, usage_qty, lot_dates_summary, sort_order
    )
    VALUES (
      v_header_id, v_material_category, v_material_id, v_material_code, v_material_name,
      v_bom_qty, trim(v_unit), v_usage_qty, NULL, v_sort_order
    )
    RETURNING id INTO v_line_id;

    FOR v_alloc IN SELECT value FROM jsonb_array_elements(COALESCE(v_line->'allocations', '[]'::jsonb))
    LOOP
      v_lot_id := NULLIF(v_alloc->>'lot_id', '')::UUID;
      v_qty := COALESCE((v_alloc->>'quantity_used')::NUMERIC, 0);
      IF v_lot_id IS NULL OR v_qty <= 0 THEN
        RAISE EXCEPTION 'LOT 입력값이 올바르지 않습니다.';
      END IF;

      SELECT * INTO v_lot
      FROM public.harang_inventory_lots
      WHERE id = v_lot_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'LOT를 찾을 수 없습니다.';
      END IF;
      IF v_lot.category <> v_material_category OR v_lot.item_id <> v_material_id THEN
        RAISE EXCEPTION 'LOT가 소모품목과 일치하지 않습니다: %', v_material_name;
      END IF;

      v_ledger_sum := public.harang_lot_ledger_sum(v_lot_id);
      IF v_ledger_sum < v_qty - 0.0005 THEN
        RAISE EXCEPTION '재고가 부족합니다 (원장 기준 %g): %', v_ledger_sum, v_material_name;
      END IF;

      IF v_lot.inbound_date IS NOT NULL AND v_lot.inbound_date > p_production_date THEN
        RAISE EXCEPTION '생산일(%)보다 늦게 입고된 LOT는 사용할 수 없습니다: %', p_production_date, v_material_name;
      END IF;

      INSERT INTO public.harang_inventory_transactions (
        category, item_id, item_code, item_name, lot_id, tx_date, tx_type,
        reference_no, quantity_delta, unit, note
      )
      VALUES (
        v_material_category, v_material_id, v_lot.item_code, v_lot.item_name, v_lot_id,
        p_production_date, 'usage', v_production_no, -v_qty, v_lot.unit, '생산입고'
      )
      RETURNING id INTO v_tx_id;

      INSERT INTO public.harang_production_line_lots (
        line_id, lot_id, quantity_used, inventory_transaction_id
      )
      VALUES (v_line_id, v_lot_id, v_qty, v_tx_id);

      v_ledger_sum := public.harang_sync_lot_current_from_ledger(v_lot_id);
      IF v_ledger_sum < -0.0005 THEN
        RAISE EXCEPTION 'LOT 원장 잔량이 음수가 됩니다 (%g): %', v_ledger_sum, v_material_name;
      END IF;
    END LOOP;

    IF v_usage_qty > 0 THEN
      SELECT COALESCE(SUM(quantity_used), 0) INTO v_sum_check
      FROM public.harang_production_line_lots
      WHERE line_id = v_line_id;
      IF ABS(v_sum_check - v_usage_qty) > 0.0005 THEN
        RAISE EXCEPTION 'LOT 배분 합계가 사용량과 일치하지 않습니다: %', v_material_name;
      END IF;
    END IF;

    SELECT string_agg(d, ' · ' ORDER BY d) INTO v_lot_summary
    FROM (
      SELECT DISTINCT to_char(l.lot_date, 'YYYY.MM.DD') AS d
      FROM public.harang_production_line_lots pl
      JOIN public.harang_inventory_lots l ON l.id = pl.lot_id
      WHERE pl.line_id = v_line_id
    ) s;

    UPDATE public.harang_production_lines
    SET lot_dates_summary = v_lot_summary
    WHERE id = v_line_id;
  END LOOP;

  PERFORM public.harang_assert_production_inventory_integrity(v_header_id);

  RETURN v_header_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) create_harang_production_from_request_line
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_harang_production_from_request_line(
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
  v_header_id UUID;
  v_created_by UUID;
  v_seq INTEGER;
  v_production_no TEXT;
  v_line JSONB;
  v_line_id UUID;
  v_material_category TEXT;
  v_material_id UUID;
  v_material_code TEXT;
  v_material_name TEXT;
  v_bom_qty NUMERIC;
  v_unit TEXT;
  v_usage_qty NUMERIC;
  v_sort_order INT;
  v_alloc JSONB;
  v_lot_id UUID;
  v_qty NUMERIC;
  v_lot RECORD;
  v_sum_check NUMERIC;
  v_lot_summary TEXT;
  v_req RECORD;
  v_remaining NUMERIC;
  v_applied NUMERIC;
  v_overrun NUMERIC;
  v_lot_date DATE;
  v_tx_id BIGINT;
  v_ledger_sum NUMERIC(14, 3);
BEGIN
  v_created_by := auth.uid();
  IF v_created_by IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  IF p_request_line_id IS NULL THEN
    RAISE EXCEPTION '작업지시 라인이 필요합니다.';
  END IF;
  IF p_finished_qty IS NULL OR p_finished_qty <= 0 THEN
    RAISE EXCEPTION '이번 생산수량은 0보다 커야 합니다.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '생산 상세라인이 필요합니다.';
  END IF;

  v_lot_date := COALESCE(p_finished_product_lot_date, p_production_date);

  SELECT
    ln.id AS line_id,
    ln.header_id,
    ln.product_name,
    ln.remaining_qty,
    h.request_no,
    h.status
  INTO v_req
  FROM public.harang_production_request_lines ln
  JOIN public.harang_production_requests h ON h.id = ln.header_id
  WHERE ln.id = p_request_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '작업지시 라인을 찾을 수 없습니다.';
  END IF;
  IF v_req.status IN ('completed', 'settled', 'cancelled') THEN
    RAISE EXCEPTION '완료/종결/취소 상태 작업지시는 생산반영할 수 없습니다.';
  END IF;

  v_remaining := GREATEST(COALESCE(v_req.remaining_qty, 0), 0);
  v_applied := LEAST(p_finished_qty, v_remaining);
  v_overrun := GREATEST(p_finished_qty - v_remaining, 0);

  PERFORM pg_advisory_xact_lock(hashtext('harang-production-no-' || p_production_date::TEXT));
  SELECT COUNT(*) + 1 INTO v_seq
  FROM public.harang_production_headers
  WHERE production_date = p_production_date;
  v_production_no := to_char(p_production_date, 'YYYY/MM/DD') || '-' || v_seq::TEXT;

  INSERT INTO public.harang_production_headers (
    production_date, production_no, product_name, finished_qty, applied_to_request_qty, overrun_qty,
    note, created_by, request_id, request_line_id, finished_product_lot_date
  )
  VALUES (
    p_production_date, v_production_no, v_req.product_name, p_finished_qty, v_applied, v_overrun,
    NULLIF(trim(COALESCE(p_note, '')), ''), v_created_by, v_req.header_id, v_req.line_id, v_lot_date
  )
  RETURNING id INTO v_header_id;

  v_sort_order := 0;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_sort_order := v_sort_order + 1;
    v_material_category := COALESCE(v_line->>'material_category', '');
    v_material_id := NULLIF(v_line->>'material_id', '')::UUID;
    v_material_code := COALESCE(v_line->>'material_code', '');
    v_material_name := COALESCE(v_line->>'material_name', '');
    v_bom_qty := COALESCE((v_line->>'bom_qty')::NUMERIC, 0);
    v_unit := COALESCE(v_line->>'unit', '');
    v_usage_qty := COALESCE((v_line->>'usage_qty')::NUMERIC, -1);

    IF v_material_category NOT IN ('raw_material', 'packaging_material') THEN
      RAISE EXCEPTION '분류(material_category)가 올바르지 않습니다.';
    END IF;
    IF v_material_id IS NULL THEN
      RAISE EXCEPTION '소모 품목 ID가 필요합니다.';
    END IF;
    IF v_material_name = '' OR trim(v_unit) = '' THEN
      RAISE EXCEPTION '소모 품목명/단위는 필수입니다.';
    END IF;
    IF v_usage_qty < 0 THEN
      RAISE EXCEPTION '사용량이 올바르지 않습니다.';
    END IF;

    INSERT INTO public.harang_production_lines (
      header_id, material_category, material_id, material_code, material_name,
      bom_qty, unit, usage_qty, lot_dates_summary, sort_order
    )
    VALUES (
      v_header_id, v_material_category, v_material_id, v_material_code, v_material_name,
      v_bom_qty, trim(v_unit), v_usage_qty, NULL, v_sort_order
    )
    RETURNING id INTO v_line_id;

    FOR v_alloc IN SELECT value FROM jsonb_array_elements(COALESCE(v_line->'allocations', '[]'::jsonb))
    LOOP
      v_lot_id := NULLIF(v_alloc->>'lot_id', '')::UUID;
      v_qty := COALESCE((v_alloc->>'quantity_used')::NUMERIC, 0);
      IF v_lot_id IS NULL OR v_qty <= 0 THEN
        RAISE EXCEPTION 'LOT 입력값이 올바르지 않습니다.';
      END IF;

      SELECT * INTO v_lot
      FROM public.harang_inventory_lots
      WHERE id = v_lot_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'LOT를 찾을 수 없습니다.';
      END IF;
      IF v_lot.category <> v_material_category OR v_lot.item_id <> v_material_id THEN
        RAISE EXCEPTION 'LOT가 소모품목과 일치하지 않습니다: %', v_material_name;
      END IF;

      v_ledger_sum := public.harang_lot_ledger_sum(v_lot_id);
      IF v_ledger_sum < v_qty - 0.0005 THEN
        RAISE EXCEPTION '재고가 부족합니다 (원장 기준 %g): %', v_ledger_sum, v_material_name;
      END IF;

      IF v_lot.inbound_date IS NOT NULL AND v_lot.inbound_date > p_production_date THEN
        RAISE EXCEPTION '생산일(%)보다 늦게 입고된 LOT는 사용할 수 없습니다: % (입고 %, 소비기한 %)',
          p_production_date, v_material_name, v_lot.inbound_date, v_lot.lot_date;
      END IF;

      INSERT INTO public.harang_inventory_transactions (
        category, item_id, item_code, item_name, lot_id, tx_date, tx_type,
        reference_no, quantity_delta, unit, note
      )
      VALUES (
        v_material_category, v_material_id, v_lot.item_code, v_lot.item_name, v_lot_id,
        p_production_date, 'usage', v_req.request_no, -v_qty, v_lot.unit, '작업지시 생산입고'
      )
      RETURNING id INTO v_tx_id;

      INSERT INTO public.harang_production_line_lots (
        line_id, lot_id, quantity_used, inventory_transaction_id
      )
      VALUES (v_line_id, v_lot_id, v_qty, v_tx_id);

      v_ledger_sum := public.harang_sync_lot_current_from_ledger(v_lot_id);
      IF v_ledger_sum < -0.0005 THEN
        RAISE EXCEPTION 'LOT 원장 잔량이 음수가 됩니다 (%g): %', v_ledger_sum, v_material_name;
      END IF;
    END LOOP;

    IF v_usage_qty > 0 THEN
      SELECT COALESCE(SUM(quantity_used), 0) INTO v_sum_check
      FROM public.harang_production_line_lots
      WHERE line_id = v_line_id;
      IF ABS(v_sum_check - v_usage_qty) > 0.0005 THEN
        RAISE EXCEPTION 'LOT 배분 합계가 사용량과 일치하지 않습니다: %', v_material_name;
      END IF;
    END IF;

    SELECT string_agg(d, ' · ' ORDER BY d) INTO v_lot_summary
    FROM (
      SELECT DISTINCT to_char(l.lot_date, 'YYYY.MM.DD') AS d
      FROM public.harang_production_line_lots pl
      JOIN public.harang_inventory_lots l ON l.id = pl.lot_id
      WHERE pl.line_id = v_line_id
    ) s;

    UPDATE public.harang_production_lines
    SET lot_dates_summary = v_lot_summary
    WHERE id = v_line_id;
  END LOOP;

  UPDATE public.harang_production_request_lines
  SET
    produced_qty = produced_qty + v_applied,
    remaining_qty = remaining_qty - v_applied,
    updated_at = now()
  WHERE id = p_request_line_id;

  PERFORM public.refresh_harang_request_line_reservations(p_request_line_id);
  PERFORM public.refresh_harang_all_open_shortage_flags();
  PERFORM public.refresh_every_harang_request_header_status();

  PERFORM public.harang_assert_production_inventory_integrity(v_header_id);

  RETURN v_header_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) delete_harang_production_with_usage — FK 기반 삭제 + 원장 sync
-- ---------------------------------------------------------------------------
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

  -- 레거시 usage (FK 없음): 삭제 대상 tx_id 수집
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

  -- line_lots 먼저 제거 (FK RESTRICT) 후 usage 원장 삭제
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

GRANT EXECUTE ON FUNCTION public.create_harang_production_with_usage(DATE, TEXT, NUMERIC, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_harang_production_from_request_line(DATE, UUID, NUMERIC, TEXT, JSONB, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_harang_production_with_usage(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_harang_production_from_request_line(UUID, DATE, UUID, NUMERIC, TEXT, JSONB, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
