-- 하랑 불량처리(폐기) — 이카운트 불량처리 유사
-- 헤더: 일자, 담당자, 처리방법 / 라인: 품목·소비기한 LOT·수량·불량유형
-- 원장 tx_type = disposal, LOT current_quantity = 원장 합산

ALTER TABLE public.harang_inventory_transactions
  DROP CONSTRAINT IF EXISTS harang_inventory_transactions_tx_type_check;

ALTER TABLE public.harang_inventory_transactions
  ADD CONSTRAINT harang_inventory_transactions_tx_type_check
  CHECK (tx_type IN ('inbound', 'usage', 'adjustment', 'disposal'));

CREATE TABLE IF NOT EXISTS public.harang_defect_disposal_headers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disposal_date DATE NOT NULL,
  disposal_no TEXT NOT NULL UNIQUE,
  processing_method TEXT NOT NULL DEFAULT '폐기',
  handler_name TEXT,
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT harang_defect_disposal_processing_method_chk CHECK (
    trim(processing_method) <> ''
  )
);

CREATE TABLE IF NOT EXISTS public.harang_defect_disposal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  header_id UUID NOT NULL REFERENCES public.harang_defect_disposal_headers(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('raw_material', 'packaging_material')),
  item_id UUID NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  lot_id UUID NOT NULL REFERENCES public.harang_inventory_lots(id) ON DELETE RESTRICT,
  lot_date DATE NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  defect_type TEXT NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT harang_defect_disposal_defect_type_chk CHECK (trim(defect_type) <> '')
);

CREATE INDEX IF NOT EXISTS idx_harang_defect_disposal_headers_date
  ON public.harang_defect_disposal_headers (disposal_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_harang_defect_disposal_lines_header
  ON public.harang_defect_disposal_lines (header_id, sort_order);

DROP TRIGGER IF EXISTS set_harang_defect_disposal_headers_updated_at
  ON public.harang_defect_disposal_headers;
CREATE TRIGGER set_harang_defect_disposal_headers_updated_at
  BEFORE UPDATE ON public.harang_defect_disposal_headers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.harang_defect_disposal_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_defect_disposal_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "harang_defect_disposal_headers_select" ON public.harang_defect_disposal_headers;
DROP POLICY IF EXISTS "harang_defect_disposal_headers_write" ON public.harang_defect_disposal_headers;
CREATE POLICY "harang_defect_disposal_headers_select"
  ON public.harang_defect_disposal_headers FOR SELECT TO authenticated
  USING (public.can_access_harang_data() OR public.is_headquarters_organization());
CREATE POLICY "harang_defect_disposal_headers_write"
  ON public.harang_defect_disposal_headers FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

DROP POLICY IF EXISTS "harang_defect_disposal_lines_select" ON public.harang_defect_disposal_lines;
DROP POLICY IF EXISTS "harang_defect_disposal_lines_write" ON public.harang_defect_disposal_lines;
CREATE POLICY "harang_defect_disposal_lines_select"
  ON public.harang_defect_disposal_lines FOR SELECT TO authenticated
  USING (public.can_access_harang_data() OR public.is_headquarters_organization());
CREATE POLICY "harang_defect_disposal_lines_write"
  ON public.harang_defect_disposal_lines FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

CREATE OR REPLACE FUNCTION public.create_harang_defect_disposal(
  p_disposal_date DATE,
  p_handler_name TEXT,
  p_processing_method TEXT,
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
  v_disposal_no TEXT;
  v_line JSONB;
  v_line_idx INTEGER := 0;
  v_category TEXT;
  v_item_id UUID;
  v_lot_date DATE;
  v_qty NUMERIC(14, 3);
  v_defect_type TEXT;
  v_lot RECORD;
  v_alloc NUMERIC(14, 3);
  v_as_of NUMERIC(14, 3);
  v_lot_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  v_created_by := auth.uid();
  IF v_created_by IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  IF p_disposal_date IS NULL THEN
    RAISE EXCEPTION '일자가 필요합니다.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '불량 품목이 1건 이상 필요합니다.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('harang-defect-disposal-no-' || p_disposal_date::TEXT));

  SELECT COUNT(*) + 1 INTO v_seq
  FROM public.harang_defect_disposal_headers
  WHERE disposal_date = p_disposal_date;

  v_disposal_no := to_char(p_disposal_date, 'YYYY/MM/DD') || '-' || v_seq::TEXT;

  INSERT INTO public.harang_defect_disposal_headers (
    disposal_date, disposal_no, processing_method, handler_name, note, created_by
  )
  VALUES (
    p_disposal_date,
    v_disposal_no,
    COALESCE(NULLIF(trim(p_processing_method), ''), '폐기'),
    NULLIF(trim(COALESCE(p_handler_name, '')), ''),
    NULLIF(trim(COALESCE(p_note, '')), ''),
    v_created_by
  )
  RETURNING id INTO v_header_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_idx := v_line_idx + 1;
    v_category := trim(v_line->>'category');
    v_item_id := (v_line->>'item_id')::UUID;
    v_lot_date := (v_line->>'lot_date')::DATE;
    v_qty := (v_line->>'quantity')::NUMERIC(14, 3);
    v_defect_type := trim(COALESCE(v_line->>'defect_type', ''));

    IF v_category NOT IN ('raw_material', 'packaging_material') THEN
      RAISE EXCEPTION '품목 분류가 올바르지 않습니다.';
    END IF;
    IF v_item_id IS NULL OR v_lot_date IS NULL THEN
      RAISE EXCEPTION '품목·소비기한이 필요합니다.';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION '수량은 0보다 커야 합니다.';
    END IF;
    IF v_defect_type = '' THEN
      RAISE EXCEPTION '불량유형/사유를 입력하세요.';
    END IF;

    v_alloc := v_qty;

    FOR v_lot IN
      SELECT
        l.id,
        l.category,
        l.item_id,
        l.item_code,
        l.item_name,
        l.lot_date,
        l.unit,
        COALESCE(s.stock_qty, 0)::NUMERIC(14, 3) AS as_of_qty
      FROM public.harang_inventory_lots l
      LEFT JOIN public.harang_inventory_stock_as_of_lot(p_disposal_date) s ON s.lot_id = l.id
      WHERE l.category = v_category
        AND l.item_id = v_item_id
        AND l.lot_date = v_lot_date
        AND l.inbound_date <= p_disposal_date
      ORDER BY l.inbound_date, l.id
      FOR UPDATE OF l
    LOOP
      IF v_alloc <= 0.0005 THEN
        EXIT;
      END IF;
      IF v_lot.as_of_qty <= 0.0005 THEN
        CONTINUE;
      END IF;

      v_as_of := LEAST(v_alloc, v_lot.as_of_qty);

      INSERT INTO public.harang_defect_disposal_lines (
        header_id, category, item_id, item_code, item_name,
        lot_id, lot_date, quantity, unit, defect_type, sort_order
      )
      VALUES (
        v_header_id,
        v_lot.category,
        v_lot.item_id,
        v_lot.item_code,
        v_lot.item_name,
        v_lot.id,
        v_lot.lot_date,
        v_as_of,
        v_lot.unit,
        v_defect_type,
        v_line_idx
      );

      INSERT INTO public.harang_inventory_transactions (
        category, item_id, item_code, item_name, lot_id,
        tx_date, tx_type, reference_no, quantity_delta, unit, note
      )
      VALUES (
        v_lot.category,
        v_lot.item_id,
        v_lot.item_code,
        v_lot.item_name,
        v_lot.id,
        p_disposal_date,
        'disposal',
        v_disposal_no,
        -v_as_of,
        v_lot.unit,
        v_defect_type
      );

      v_lot_ids := array_append(v_lot_ids, v_lot.id);
      v_alloc := v_alloc - v_as_of;
    END LOOP;

    IF v_alloc > 0.0005 THEN
      RAISE EXCEPTION '기준일 재고가 부족합니다: % / %', v_line->>'item_name', v_lot_date;
    END IF;
  END LOOP;

  UPDATE public.harang_inventory_lots l
  SET current_quantity = GREATEST(0, COALESCE((
    SELECT SUM(t.quantity_delta)::NUMERIC(14, 3)
    FROM public.harang_inventory_transactions t
    WHERE t.lot_id = l.id
  ), 0))
  WHERE l.id = ANY(v_lot_ids);

  RETURN v_header_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_harang_defect_disposal(p_header_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hdr RECORD;
  v_lot_ids UUID[];
BEGIN
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  SELECT * INTO v_hdr
  FROM public.harang_defect_disposal_headers
  WHERE id = p_header_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '불량처리 전표를 찾을 수 없습니다.';
  END IF;

  SELECT array_agg(DISTINCT ln.lot_id) INTO v_lot_ids
  FROM public.harang_defect_disposal_lines ln
  WHERE ln.header_id = p_header_id;

  DELETE FROM public.harang_inventory_transactions
  WHERE reference_no = v_hdr.disposal_no
    AND tx_type = 'disposal';

  DELETE FROM public.harang_defect_disposal_headers
  WHERE id = p_header_id;

  IF v_lot_ids IS NOT NULL THEN
    UPDATE public.harang_inventory_lots l
    SET current_quantity = GREATEST(0, COALESCE((
      SELECT SUM(t.quantity_delta)::NUMERIC(14, 3)
      FROM public.harang_inventory_transactions t
      WHERE t.lot_id = l.id
    ), 0))
    WHERE l.id = ANY(v_lot_ids);
  END IF;

  RETURN p_header_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_harang_defect_disposal(DATE, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_harang_defect_disposal(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
