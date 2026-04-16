-- 입고 삭제·수정 (LOT 미사용 시에만). SECURITY DEFINER RPC.

CREATE OR REPLACE FUNCTION public._harang_inbound_assert_no_lot_usage(p_header_id UUID)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.harang_inventory_lots l
    INNER JOIN public.harang_inventory_transactions t
      ON t.lot_id = l.id AND t.tx_type = 'usage'
    WHERE l.source_header_id = p_header_id
  ) THEN
    RAISE EXCEPTION '생산 등으로 LOT가 사용된 입고는 수정·삭제할 수 없습니다.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.harang_inventory_lots l
    WHERE l.source_header_id = p_header_id
      AND l.current_quantity < l.initial_quantity
  ) THEN
    RAISE EXCEPTION '재고가 일부 소진된 입고는 수정·삭제할 수 없습니다.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_harang_inbound(p_header_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by UUID;
  v_inbound_no TEXT;
BEGIN
  v_created_by := auth.uid();
  IF v_created_by IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('harang-inbound-edit-' || p_header_id::TEXT));

  SELECT inbound_no INTO v_inbound_no
  FROM public.harang_inbound_headers
  WHERE id = p_header_id
  FOR UPDATE;

  IF v_inbound_no IS NULL THEN
    RAISE EXCEPTION '입고 내역을 찾을 수 없습니다.';
  END IF;

  PERFORM public._harang_inbound_assert_no_lot_usage(p_header_id);

  DELETE FROM public.harang_inventory_transactions
  WHERE reference_no = v_inbound_no AND tx_type = 'inbound';

  DELETE FROM public.harang_inventory_lots
  WHERE source_header_id = p_header_id;

  DELETE FROM public.harang_inbound_headers
  WHERE id = p_header_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_harang_inbound_with_items(
  p_header_id UUID,
  p_inbound_date DATE,
  p_inbound_route TEXT,
  p_note TEXT,
  p_items JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by UUID;
  v_inbound_no TEXT;
  v_item JSONB;
  v_item_id UUID;
  v_category TEXT;
  v_item_code TEXT;
  v_item_name TEXT;
  v_lot_date DATE;
  v_quantity NUMERIC(14, 3);
  v_unit TEXT;
  v_item_note TEXT;
  v_inbound_item_id UUID;
  v_lot_id UUID;
BEGIN
  v_created_by := auth.uid();
  IF v_created_by IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  IF p_inbound_route NOT IN ('AF발송', '하랑직입고') THEN
    RAISE EXCEPTION '입고경로가 올바르지 않습니다.';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '입고 상세라인이 필요합니다.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('harang-inbound-edit-' || p_header_id::TEXT));

  SELECT inbound_no INTO v_inbound_no
  FROM public.harang_inbound_headers
  WHERE id = p_header_id
  FOR UPDATE;

  IF v_inbound_no IS NULL THEN
    RAISE EXCEPTION '입고 내역을 찾을 수 없습니다.';
  END IF;

  PERFORM public._harang_inbound_assert_no_lot_usage(p_header_id);

  DELETE FROM public.harang_inventory_transactions
  WHERE reference_no = v_inbound_no AND tx_type = 'inbound';

  DELETE FROM public.harang_inventory_lots
  WHERE source_header_id = p_header_id;

  DELETE FROM public.harang_inbound_items
  WHERE header_id = p_header_id;

  UPDATE public.harang_inbound_headers
  SET
    inbound_date = p_inbound_date,
    inbound_route = p_inbound_route,
    note = NULLIF(trim(COALESCE(p_note, '')), ''),
    updated_at = now()
  WHERE id = p_header_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_category := COALESCE(v_item->>'category', '');
    v_item_id := NULLIF(v_item->>'item_id', '')::UUID;
    v_item_code := COALESCE(v_item->>'item_code', '');
    v_item_name := COALESCE(v_item->>'item_name', '');
    v_lot_date := NULLIF(v_item->>'lot_date', '')::DATE;
    v_quantity := COALESCE((v_item->>'quantity')::NUMERIC, 0);
    v_unit := COALESCE(v_item->>'unit', '');
    v_item_note := NULLIF(trim(COALESCE(v_item->>'note', '')), '');

    IF v_category NOT IN ('raw_material', 'packaging_material') THEN
      RAISE EXCEPTION '분류(category)가 올바르지 않습니다.';
    END IF;
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION '품목 ID가 필요합니다.';
    END IF;
    IF v_item_code = '' OR v_item_name = '' THEN
      RAISE EXCEPTION '품목 코드/명은 필수입니다.';
    END IF;
    IF v_lot_date IS NULL THEN
      RAISE EXCEPTION 'LOT 날짜는 필수입니다.';
    END IF;
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION '수량은 0보다 커야 합니다.';
    END IF;
    IF trim(v_unit) = '' THEN
      RAISE EXCEPTION '단위는 필수입니다.';
    END IF;

    INSERT INTO public.harang_inbound_items (
      header_id,
      category,
      item_id,
      item_code,
      item_name,
      lot_date,
      quantity,
      unit,
      note
    )
    VALUES (
      p_header_id,
      v_category,
      v_item_id,
      v_item_code,
      v_item_name,
      v_lot_date,
      v_quantity,
      trim(v_unit),
      v_item_note
    )
    RETURNING id INTO v_inbound_item_id;

    INSERT INTO public.harang_inventory_lots (
      category,
      item_id,
      item_code,
      item_name,
      lot_date,
      inbound_date,
      inbound_route,
      source_header_id,
      source_item_id,
      initial_quantity,
      current_quantity,
      unit,
      note
    )
    VALUES (
      v_category,
      v_item_id,
      v_item_code,
      v_item_name,
      v_lot_date,
      p_inbound_date,
      p_inbound_route,
      p_header_id,
      v_inbound_item_id,
      v_quantity,
      v_quantity,
      trim(v_unit),
      v_item_note
    )
    RETURNING id INTO v_lot_id;

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
    VALUES (
      v_category,
      v_item_id,
      v_item_code,
      v_item_name,
      v_lot_id,
      p_inbound_date,
      'inbound',
      v_inbound_no,
      v_quantity,
      trim(v_unit),
      v_item_note
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_harang_inbound(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_harang_inbound_with_items(UUID, DATE, TEXT, TEXT, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
