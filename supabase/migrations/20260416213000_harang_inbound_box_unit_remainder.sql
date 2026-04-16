-- 하랑 입고: 박스/낱개/잔량(g) 입력 지원

ALTER TABLE public.harang_inbound_items
  ADD COLUMN IF NOT EXISTS box_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (box_qty >= 0),
  ADD COLUMN IF NOT EXISTS unit_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (unit_qty >= 0),
  ADD COLUMN IF NOT EXISTS remainder_g NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (remainder_g >= 0);

ALTER TABLE public.harang_inventory_lots
  ADD COLUMN IF NOT EXISTS box_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (box_qty >= 0),
  ADD COLUMN IF NOT EXISTS unit_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (unit_qty >= 0),
  ADD COLUMN IF NOT EXISTS remainder_g NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (remainder_g >= 0);

CREATE OR REPLACE FUNCTION public.create_harang_inbound_with_items(
  p_inbound_date DATE,
  p_inbound_route TEXT,
  p_note TEXT,
  p_items JSONB
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
  v_box_qty NUMERIC(14, 3);
  v_unit_qty NUMERIC(14, 3);
  v_remainder_g NUMERIC(14, 3);
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

  PERFORM pg_advisory_xact_lock(hashtext('harang-inbound-no-' || p_inbound_date::TEXT));

  SELECT COUNT(*) + 1
    INTO v_seq
  FROM public.harang_inbound_headers
  WHERE inbound_date = p_inbound_date;

  v_inbound_no := to_char(p_inbound_date, 'YYYY/MM/DD') || '-' || v_seq::TEXT;

  INSERT INTO public.harang_inbound_headers (
    inbound_date, inbound_no, inbound_route, note, created_by
  )
  VALUES (
    p_inbound_date, v_inbound_no, p_inbound_route, NULLIF(trim(COALESCE(p_note, '')), ''), v_created_by
  )
  RETURNING id INTO v_header_id;

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
    v_box_qty := GREATEST(COALESCE((v_item->>'box_qty')::NUMERIC, 0), 0);
    v_unit_qty := GREATEST(COALESCE((v_item->>'unit_qty')::NUMERIC, 0), 0);
    v_remainder_g := GREATEST(COALESCE((v_item->>'remainder_g')::NUMERIC, 0), 0);

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
      box_qty,
      unit_qty,
      remainder_g,
      note
    )
    VALUES (
      v_header_id,
      v_category,
      v_item_id,
      v_item_code,
      v_item_name,
      v_lot_date,
      v_quantity,
      trim(v_unit),
      v_box_qty,
      v_unit_qty,
      v_remainder_g,
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
      box_qty,
      unit_qty,
      remainder_g,
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
      v_header_id,
      v_inbound_item_id,
      v_quantity,
      v_quantity,
      trim(v_unit),
      v_box_qty,
      v_unit_qty,
      v_remainder_g,
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

  RETURN v_header_id;
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
  v_box_qty NUMERIC(14, 3);
  v_unit_qty NUMERIC(14, 3);
  v_remainder_g NUMERIC(14, 3);
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
    v_box_qty := GREATEST(COALESCE((v_item->>'box_qty')::NUMERIC, 0), 0);
    v_unit_qty := GREATEST(COALESCE((v_item->>'unit_qty')::NUMERIC, 0), 0);
    v_remainder_g := GREATEST(COALESCE((v_item->>'remainder_g')::NUMERIC, 0), 0);

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
      box_qty,
      unit_qty,
      remainder_g,
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
      v_box_qty,
      v_unit_qty,
      v_remainder_g,
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
      box_qty,
      unit_qty,
      remainder_g,
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
      v_box_qty,
      v_unit_qty,
      v_remainder_g,
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

GRANT EXECUTE ON FUNCTION public.create_harang_inbound_with_items(DATE, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_harang_inbound_with_items(UUID, DATE, TEXT, TEXT, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
