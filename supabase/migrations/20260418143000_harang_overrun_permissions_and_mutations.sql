-- ============================================================
-- Harang permissions + overrun production application + edit/delete RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_access_harang_data()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    (public.get_my_organization_code() = '000' AND public.get_my_profile_role() = 'admin')
    OR (public.get_my_organization_code() = '100' AND public.get_my_profile_role() IN ('manager', 'admin'))
    OR (public.get_my_organization_code() = '200' AND public.get_my_profile_role() IN ('worker', 'manager', 'admin'));
$$;

CREATE OR REPLACE FUNCTION public.can_write_harang_ops()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    (public.get_my_organization_code() = '000' AND public.get_my_profile_role() = 'admin')
    OR (public.get_my_organization_code() = '100' AND public.get_my_profile_role() IN ('manager', 'admin'))
    OR (public.get_my_organization_code() = '200' AND public.get_my_profile_role() IN ('worker', 'manager', 'admin'));
$$;

CREATE OR REPLACE FUNCTION public.can_access_harang_production_requests()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.can_access_harang_data();
$$;

ALTER TABLE public.harang_production_headers
  ADD COLUMN IF NOT EXISTS applied_to_request_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (applied_to_request_qty >= 0),
  ADD COLUMN IF NOT EXISTS overrun_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (overrun_qty >= 0);

CREATE OR REPLACE FUNCTION public.create_harang_production_from_request_line(
  p_production_date DATE,
  p_request_line_id UUID,
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
  v_req RECORD;
  v_remaining NUMERIC;
  v_applied NUMERIC;
  v_overrun NUMERIC;
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
    production_date, production_no, product_name, finished_qty, applied_to_request_qty, overrun_qty, note, created_by, request_id, request_line_id
  )
  VALUES (
    p_production_date, v_production_no, v_req.product_name, p_finished_qty, v_applied, v_overrun,
    NULLIF(trim(COALESCE(p_note, '')), ''), v_created_by, v_req.header_id, v_req.line_id
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
      header_id, material_category, material_id, material_code, material_name, bom_qty, unit, usage_qty, lot_dates_summary, sort_order
    )
    VALUES (
      v_header_id, v_material_category, v_material_id, v_material_code, v_material_name, v_bom_qty, trim(v_unit), v_usage_qty, NULL, v_sort_order
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
      IF v_lot.current_quantity < v_qty THEN
        RAISE EXCEPTION '재고가 부족합니다 (%): LOT %', v_material_name, v_lot_id;
      END IF;

      UPDATE public.harang_inventory_lots
      SET current_quantity = current_quantity - v_qty
      WHERE id = v_lot_id;

      INSERT INTO public.harang_production_line_lots (line_id, lot_id, quantity_used)
      VALUES (v_line_id, v_lot_id, v_qty);

      INSERT INTO public.harang_inventory_transactions (
        category, item_id, item_code, item_name, lot_id, tx_date, tx_type, reference_no, quantity_delta, unit, note
      )
      VALUES (
        v_material_category, v_material_id, v_lot.item_code, v_lot.item_name, v_lot_id,
        p_production_date, 'usage', v_req.request_no, -v_qty, v_lot.unit, '작업지시 생산입고'
      );
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

  RETURN v_header_id;
END;
$$;

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

  -- 1) LOT 재고 복구
  UPDATE public.harang_inventory_lots l
  SET current_quantity = l.current_quantity + x.qty
  FROM (
    SELECT pl.lot_id, SUM(pl.quantity_used)::NUMERIC(14,3) AS qty
    FROM public.harang_production_lines ln
    JOIN public.harang_production_line_lots pl ON pl.line_id = ln.id
    WHERE ln.header_id = p_header_id
    GROUP BY pl.lot_id
  ) x
  WHERE l.id = x.lot_id;

  -- 2) 재고 트랜잭션 삭제
  DELETE FROM public.harang_inventory_transactions
  WHERE reference_no = v_head.production_no
    AND tx_type = 'usage'
    AND note = '작업지시 생산입고';

  -- 3) 요청 반영수량 복구
  IF v_head.request_line_id IS NOT NULL THEN
    UPDATE public.harang_production_request_lines
    SET
      produced_qty = GREATEST(0, produced_qty - COALESCE(v_head.applied_to_request_qty, 0)),
      remaining_qty = remaining_qty + COALESCE(v_head.applied_to_request_qty, 0),
      updated_at = now()
    WHERE id = v_head.request_line_id;
  END IF;

  -- 4) 생산입고 삭제 (자식은 cascade)
  DELETE FROM public.harang_production_headers WHERE id = p_header_id;

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
  p_lines JSONB
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
    p_lines
  );

  RETURN v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_harang_production_from_request_line(DATE, UUID, NUMERIC, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_harang_production_with_usage(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_harang_production_from_request_line(UUID, DATE, UUID, NUMERIC, TEXT, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
