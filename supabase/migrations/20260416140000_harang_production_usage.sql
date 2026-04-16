-- ============================================================
-- Harang production (생산입고): headers, BOM lines, LOT allocations
-- + RPC: create_harang_production_with_usage (inventory 차감 + usage 트랜잭션)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.harang_production_headers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_date DATE NOT NULL,
  production_no TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  finished_qty NUMERIC(14, 3) NOT NULL CHECK (finished_qty > 0),
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.harang_production_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  header_id UUID NOT NULL REFERENCES public.harang_production_headers(id) ON DELETE CASCADE,
  material_category TEXT NOT NULL CHECK (material_category IN ('raw_material', 'packaging_material')),
  material_id UUID NOT NULL,
  material_code TEXT NOT NULL,
  material_name TEXT NOT NULL,
  bom_qty NUMERIC(14, 3) NOT NULL CHECK (bom_qty >= 0),
  unit TEXT NOT NULL,
  usage_qty NUMERIC(14, 3) NOT NULL CHECK (usage_qty >= 0),
  lot_dates_summary TEXT,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.harang_production_line_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id UUID NOT NULL REFERENCES public.harang_production_lines(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES public.harang_inventory_lots(id) ON DELETE RESTRICT,
  quantity_used NUMERIC(14, 3) NOT NULL CHECK (quantity_used > 0),
  UNIQUE (line_id, lot_id)
);

CREATE INDEX IF NOT EXISTS idx_harang_production_headers_date
  ON public.harang_production_headers (production_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_harang_production_lines_header
  ON public.harang_production_lines (header_id);
CREATE INDEX IF NOT EXISTS idx_harang_production_line_lots_line
  ON public.harang_production_line_lots (line_id);
CREATE INDEX IF NOT EXISTS idx_harang_production_line_lots_lot
  ON public.harang_production_line_lots (lot_id);

DROP TRIGGER IF EXISTS set_harang_production_headers_updated_at ON public.harang_production_headers;
CREATE TRIGGER set_harang_production_headers_updated_at
  BEFORE UPDATE ON public.harang_production_headers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.harang_production_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_production_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_production_line_lots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "harang_production_headers_select" ON public.harang_production_headers;
DROP POLICY IF EXISTS "harang_production_headers_write" ON public.harang_production_headers;
CREATE POLICY "harang_production_headers_select"
  ON public.harang_production_headers FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_production_headers_write"
  ON public.harang_production_headers FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

DROP POLICY IF EXISTS "harang_production_lines_select" ON public.harang_production_lines;
DROP POLICY IF EXISTS "harang_production_lines_write" ON public.harang_production_lines;
CREATE POLICY "harang_production_lines_select"
  ON public.harang_production_lines FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_production_lines_write"
  ON public.harang_production_lines FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

DROP POLICY IF EXISTS "harang_production_line_lots_select" ON public.harang_production_line_lots;
DROP POLICY IF EXISTS "harang_production_line_lots_write" ON public.harang_production_line_lots;
CREATE POLICY "harang_production_line_lots_select"
  ON public.harang_production_line_lots FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_production_line_lots_write"
  ON public.harang_production_line_lots FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

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
  v_alloc_sum NUMERIC;
  v_sum_check NUMERIC;
  v_lot_summary TEXT;
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

  SELECT COUNT(*) + 1
    INTO v_seq
  FROM public.harang_production_headers
  WHERE production_date = p_production_date;

  v_production_no := to_char(p_production_date, 'YYYY/MM/DD') || '-' || v_seq::TEXT;

  INSERT INTO public.harang_production_headers (
    production_date, production_no, product_name, finished_qty, note, created_by
  )
  VALUES (
    p_production_date,
    v_production_no,
    trim(p_product_name),
    p_finished_qty,
    NULLIF(trim(COALESCE(p_note, '')), ''),
    v_created_by
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
    IF v_usage_qty = 0 AND (
      COALESCE(jsonb_array_length(v_line->'allocations'), 0) > 0
    ) THEN
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
      header_id,
      material_category,
      material_id,
      material_code,
      material_name,
      bom_qty,
      unit,
      usage_qty,
      lot_dates_summary,
      sort_order
    )
    VALUES (
      v_header_id,
      v_material_category,
      v_material_id,
      v_material_code,
      v_material_name,
      v_bom_qty,
      trim(v_unit),
      v_usage_qty,
      NULL,
      v_sort_order
    )
    RETURNING id INTO v_line_id;

    v_alloc_sum := 0;

    FOR v_alloc IN SELECT value FROM jsonb_array_elements(COALESCE(v_line->'allocations', '[]'::jsonb))
    LOOP
      v_lot_id := NULLIF(v_alloc->>'lot_id', '')::UUID;
      v_qty := COALESCE((v_alloc->>'quantity_used')::NUMERIC, 0);
      IF v_lot_id IS NULL THEN
        RAISE EXCEPTION 'LOT ID가 필요합니다.';
      END IF;
      IF v_qty <= 0 THEN
        RAISE EXCEPTION 'LOT별 사용량은 0보다 커야 합니다.';
      END IF;

      SELECT *
        INTO v_lot
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
        v_material_category,
        v_material_id,
        v_lot.item_code,
        v_lot.item_name,
        v_lot_id,
        p_production_date,
        'usage',
        v_production_no,
        -v_qty,
        v_lot.unit,
        '생산입고'
      );

      v_alloc_sum := v_alloc_sum + v_qty;
    END LOOP;

    IF v_usage_qty > 0 THEN
      SELECT COALESCE(SUM(quantity_used), 0)
        INTO v_sum_check
      FROM public.harang_production_line_lots
      WHERE line_id = v_line_id;

      IF ABS(v_sum_check - v_usage_qty) > 0.0005 THEN
        RAISE EXCEPTION 'LOT 배분 합계가 사용량과 일치하지 않습니다: %', v_material_name;
      END IF;
    END IF;

    SELECT string_agg(d, ' · ' ORDER BY d)
      INTO v_lot_summary
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

  RETURN v_header_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_harang_production_with_usage(DATE, TEXT, NUMERIC, TEXT, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
