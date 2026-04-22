-- 하랑 완제품 출고 관리
-- - 생산입고(완제품 LOT) 잔량 기반 출고
-- - outbound headers / lines / line_lots

CREATE TABLE IF NOT EXISTS public.harang_finished_product_outbound_headers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbound_date DATE NOT NULL,
  outbound_no TEXT NOT NULL UNIQUE,
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.harang_finished_product_outbound_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  header_id UUID NOT NULL REFERENCES public.harang_finished_product_outbound_headers(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'EA',
  outbound_qty NUMERIC(14, 3) NOT NULL CHECK (outbound_qty > 0),
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.harang_finished_product_outbound_line_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id UUID NOT NULL REFERENCES public.harang_finished_product_outbound_lines(id) ON DELETE CASCADE,
  production_header_id UUID NOT NULL REFERENCES public.harang_production_headers(id) ON DELETE RESTRICT,
  quantity_used NUMERIC(14, 3) NOT NULL CHECK (quantity_used > 0),
  UNIQUE (line_id, production_header_id)
);

CREATE TABLE IF NOT EXISTS public.harang_outbound_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  manager_name TEXT,
  phone TEXT,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.harang_outbound_supplier_profile (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  name TEXT NOT NULL,
  manager_name TEXT,
  phone TEXT,
  address TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_harang_finished_outbound_headers_date
  ON public.harang_finished_product_outbound_headers (outbound_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_harang_finished_outbound_lines_header
  ON public.harang_finished_product_outbound_lines (header_id);
CREATE INDEX IF NOT EXISTS idx_harang_finished_outbound_line_lots_line
  ON public.harang_finished_product_outbound_line_lots (line_id);
CREATE INDEX IF NOT EXISTS idx_harang_finished_outbound_line_lots_production
  ON public.harang_finished_product_outbound_line_lots (production_header_id);
CREATE INDEX IF NOT EXISTS idx_harang_outbound_clients_active_order
  ON public.harang_outbound_clients (is_active DESC, sort_order ASC, name ASC);

DROP TRIGGER IF EXISTS set_harang_finished_product_outbound_headers_updated_at ON public.harang_finished_product_outbound_headers;
CREATE TRIGGER set_harang_finished_product_outbound_headers_updated_at
  BEFORE UPDATE ON public.harang_finished_product_outbound_headers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_harang_outbound_clients_updated_at ON public.harang_outbound_clients;
CREATE TRIGGER set_harang_outbound_clients_updated_at
  BEFORE UPDATE ON public.harang_outbound_clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_harang_outbound_supplier_profile_updated_at ON public.harang_outbound_supplier_profile;
CREATE TRIGGER set_harang_outbound_supplier_profile_updated_at
  BEFORE UPDATE ON public.harang_outbound_supplier_profile
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.harang_finished_product_outbound_headers
  ADD COLUMN IF NOT EXISTS outbound_manager_name TEXT,
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.harang_outbound_clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_name TEXT,
  ADD COLUMN IF NOT EXISTS client_manager_name TEXT,
  ADD COLUMN IF NOT EXISTS client_phone TEXT,
  ADD COLUMN IF NOT EXISTS client_address TEXT,
  ADD COLUMN IF NOT EXISTS supplier_name TEXT,
  ADD COLUMN IF NOT EXISTS supplier_manager_name TEXT,
  ADD COLUMN IF NOT EXISTS supplier_phone TEXT,
  ADD COLUMN IF NOT EXISTS supplier_address TEXT;

ALTER TABLE public.harang_finished_product_outbound_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_finished_product_outbound_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_finished_product_outbound_line_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_outbound_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_outbound_supplier_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "harang_finished_outbound_headers_select" ON public.harang_finished_product_outbound_headers;
DROP POLICY IF EXISTS "harang_finished_outbound_headers_write" ON public.harang_finished_product_outbound_headers;
CREATE POLICY "harang_finished_outbound_headers_select"
  ON public.harang_finished_product_outbound_headers FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_finished_outbound_headers_write"
  ON public.harang_finished_product_outbound_headers FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

DROP POLICY IF EXISTS "harang_finished_outbound_lines_select" ON public.harang_finished_product_outbound_lines;
DROP POLICY IF EXISTS "harang_finished_outbound_lines_write" ON public.harang_finished_product_outbound_lines;
CREATE POLICY "harang_finished_outbound_lines_select"
  ON public.harang_finished_product_outbound_lines FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_finished_outbound_lines_write"
  ON public.harang_finished_product_outbound_lines FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

DROP POLICY IF EXISTS "harang_finished_outbound_line_lots_select" ON public.harang_finished_product_outbound_line_lots;
DROP POLICY IF EXISTS "harang_finished_outbound_line_lots_write" ON public.harang_finished_product_outbound_line_lots;
CREATE POLICY "harang_finished_outbound_line_lots_select"
  ON public.harang_finished_product_outbound_line_lots FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_finished_outbound_line_lots_write"
  ON public.harang_finished_product_outbound_line_lots FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

DROP POLICY IF EXISTS "harang_outbound_clients_select" ON public.harang_outbound_clients;
DROP POLICY IF EXISTS "harang_outbound_clients_write" ON public.harang_outbound_clients;
CREATE POLICY "harang_outbound_clients_select"
  ON public.harang_outbound_clients FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_outbound_clients_write"
  ON public.harang_outbound_clients FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

DROP POLICY IF EXISTS "harang_outbound_supplier_profile_select" ON public.harang_outbound_supplier_profile;
DROP POLICY IF EXISTS "harang_outbound_supplier_profile_write" ON public.harang_outbound_supplier_profile;
CREATE POLICY "harang_outbound_supplier_profile_select"
  ON public.harang_outbound_supplier_profile FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_outbound_supplier_profile_write"
  ON public.harang_outbound_supplier_profile FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

CREATE OR REPLACE FUNCTION public.create_harang_finished_product_outbound(
  p_outbound_date DATE,
  p_note TEXT,
  p_outbound_manager_name TEXT,
  p_client_id UUID,
  p_client_name TEXT,
  p_client_manager_name TEXT,
  p_client_phone TEXT,
  p_client_address TEXT,
  p_supplier_name TEXT,
  p_supplier_manager_name TEXT,
  p_supplier_phone TEXT,
  p_supplier_address TEXT,
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
  v_outbound_no TEXT;
  v_line JSONB;
  v_line_id UUID;
  v_sort_order INT := 0;
  v_product_name TEXT;
  v_unit TEXT;
  v_outbound_qty NUMERIC;
  v_alloc JSONB;
  v_production_header_id UUID;
  v_qty NUMERIC;
  v_alloc_sum NUMERIC;
  v_prod RECORD;
  v_used NUMERIC;
  v_available NUMERIC;
BEGIN
  v_created_by := auth.uid();
  IF v_created_by IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  IF p_outbound_date IS NULL THEN
    RAISE EXCEPTION '출고일자가 필요합니다.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '출고 라인이 필요합니다.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('harang-finished-outbound-no-' || p_outbound_date::TEXT));
  SELECT COUNT(*) + 1
    INTO v_seq
  FROM public.harang_finished_product_outbound_headers
  WHERE outbound_date = p_outbound_date;

  v_outbound_no := to_char(p_outbound_date, 'YYYY/MM/DD') || '-OUT-' || v_seq::TEXT;

  INSERT INTO public.harang_finished_product_outbound_headers (
    outbound_date,
    outbound_no,
    note,
    outbound_manager_name,
    client_id,
    client_name,
    client_manager_name,
    client_phone,
    client_address,
    supplier_name,
    supplier_manager_name,
    supplier_phone,
    supplier_address,
    created_by
  )
  VALUES (
    p_outbound_date,
    v_outbound_no,
    NULLIF(trim(COALESCE(p_note, '')), ''),
    NULLIF(trim(COALESCE(p_outbound_manager_name, '')), ''),
    p_client_id,
    NULLIF(trim(COALESCE(p_client_name, '')), ''),
    NULLIF(trim(COALESCE(p_client_manager_name, '')), ''),
    NULLIF(trim(COALESCE(p_client_phone, '')), ''),
    NULLIF(trim(COALESCE(p_client_address, '')), ''),
    NULLIF(trim(COALESCE(p_supplier_name, '')), ''),
    NULLIF(trim(COALESCE(p_supplier_manager_name, '')), ''),
    NULLIF(trim(COALESCE(p_supplier_phone, '')), ''),
    NULLIF(trim(COALESCE(p_supplier_address, '')), ''),
    v_created_by
  )
  RETURNING id INTO v_header_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_sort_order := v_sort_order + 1;
    v_product_name := COALESCE(v_line->>'product_name', '');
    v_unit := COALESCE(NULLIF(v_line->>'unit', ''), 'EA');
    v_outbound_qty := COALESCE((v_line->>'outbound_qty')::NUMERIC, 0);
    v_alloc_sum := 0;

    IF v_product_name = '' THEN
      RAISE EXCEPTION '제품명이 필요합니다.';
    END IF;
    IF v_line->'allocations' IS NULL
      OR jsonb_typeof(v_line->'allocations') <> 'array'
      OR jsonb_array_length(v_line->'allocations') = 0 THEN
      RAISE EXCEPTION 'LOT 배분(allocations)이 필요합니다.';
    END IF;

    FOR v_alloc IN SELECT value FROM jsonb_array_elements(v_line->'allocations')
    LOOP
      v_production_header_id := NULLIF(v_alloc->>'production_header_id', '')::UUID;
      v_qty := COALESCE((v_alloc->>'quantity_used')::NUMERIC, 0);
      IF v_production_header_id IS NULL THEN
        RAISE EXCEPTION '생산 LOT 선택이 필요합니다.';
      END IF;
      IF v_qty <= 0 THEN
        RAISE EXCEPTION 'LOT별 출고수량은 0보다 커야 합니다.';
      END IF;

      SELECT id, product_name, finished_qty
        INTO v_prod
      FROM public.harang_production_headers
      WHERE id = v_production_header_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION '선택한 생산 LOT를 찾을 수 없습니다.';
      END IF;

      IF trim(COALESCE(v_prod.product_name, '')) <> trim(v_product_name) THEN
        RAISE EXCEPTION 'LOT 제품과 출고 제품이 일치하지 않습니다.';
      END IF;

      SELECT COALESCE(SUM(ll.quantity_used), 0)
        INTO v_used
      FROM public.harang_finished_product_outbound_line_lots ll
      JOIN public.harang_finished_product_outbound_lines ln ON ln.id = ll.line_id
      WHERE ll.production_header_id = v_production_header_id;

      v_available := GREATEST(COALESCE(v_prod.finished_qty, 0) - COALESCE(v_used, 0), 0);
      IF v_available < v_qty THEN
        RAISE EXCEPTION '가용 재고를 초과했습니다. (요청 %, 가용 %)', v_qty, v_available;
      END IF;

      v_alloc_sum := v_alloc_sum + v_qty;
    END LOOP;

    IF v_outbound_qty <= 0 THEN
      v_outbound_qty := v_alloc_sum;
    END IF;

    IF ABS(v_alloc_sum - v_outbound_qty) > 0.0005 THEN
      RAISE EXCEPTION 'LOT 배분 합계와 출고수량이 일치하지 않습니다.';
    END IF;

    INSERT INTO public.harang_finished_product_outbound_lines (
      header_id, product_name, unit, outbound_qty, sort_order
    )
    VALUES (
      v_header_id, trim(v_product_name), trim(v_unit), v_outbound_qty, v_sort_order
    )
    RETURNING id INTO v_line_id;

    FOR v_alloc IN SELECT value FROM jsonb_array_elements(v_line->'allocations')
    LOOP
      v_production_header_id := NULLIF(v_alloc->>'production_header_id', '')::UUID;
      v_qty := COALESCE((v_alloc->>'quantity_used')::NUMERIC, 0);
      INSERT INTO public.harang_finished_product_outbound_line_lots (
        line_id, production_header_id, quantity_used
      )
      VALUES (
        v_line_id, v_production_header_id, v_qty
      );
    END LOOP;
  END LOOP;

  RETURN v_header_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_harang_finished_product_outbound(
  p_header_id UUID,
  p_outbound_date DATE,
  p_note TEXT,
  p_outbound_manager_name TEXT,
  p_client_id UUID,
  p_client_name TEXT,
  p_client_manager_name TEXT,
  p_client_phone TEXT,
  p_client_address TEXT,
  p_supplier_name TEXT,
  p_supplier_manager_name TEXT,
  p_supplier_phone TEXT,
  p_supplier_address TEXT,
  p_lines JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by UUID;
  v_line JSONB;
  v_line_id UUID;
  v_sort_order INT := 0;
  v_product_name TEXT;
  v_unit TEXT;
  v_outbound_qty NUMERIC;
  v_alloc JSONB;
  v_production_header_id UUID;
  v_qty NUMERIC;
  v_alloc_sum NUMERIC;
  v_prod RECORD;
  v_used NUMERIC;
  v_available NUMERIC;
BEGIN
  v_created_by := auth.uid();
  IF v_created_by IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  IF p_header_id IS NULL THEN
    RAISE EXCEPTION '수정할 출고 내역 ID가 필요합니다.';
  END IF;
  IF p_outbound_date IS NULL THEN
    RAISE EXCEPTION '출고일자가 필요합니다.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '출고 라인이 필요합니다.';
  END IF;

  PERFORM 1
  FROM public.harang_finished_product_outbound_headers
  WHERE id = p_header_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '수정할 출고 내역을 찾을 수 없습니다.';
  END IF;

  UPDATE public.harang_finished_product_outbound_headers
  SET
    outbound_date = p_outbound_date,
    note = NULLIF(trim(COALESCE(p_note, '')), ''),
    outbound_manager_name = NULLIF(trim(COALESCE(p_outbound_manager_name, '')), ''),
    client_id = p_client_id,
    client_name = NULLIF(trim(COALESCE(p_client_name, '')), ''),
    client_manager_name = NULLIF(trim(COALESCE(p_client_manager_name, '')), ''),
    client_phone = NULLIF(trim(COALESCE(p_client_phone, '')), ''),
    client_address = NULLIF(trim(COALESCE(p_client_address, '')), ''),
    supplier_name = NULLIF(trim(COALESCE(p_supplier_name, '')), ''),
    supplier_manager_name = NULLIF(trim(COALESCE(p_supplier_manager_name, '')), ''),
    supplier_phone = NULLIF(trim(COALESCE(p_supplier_phone, '')), ''),
    supplier_address = NULLIF(trim(COALESCE(p_supplier_address, '')), '')
  WHERE id = p_header_id;

  DELETE FROM public.harang_finished_product_outbound_lines
  WHERE header_id = p_header_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_sort_order := v_sort_order + 1;
    v_product_name := COALESCE(v_line->>'product_name', '');
    v_unit := COALESCE(NULLIF(v_line->>'unit', ''), 'EA');
    v_outbound_qty := COALESCE((v_line->>'outbound_qty')::NUMERIC, 0);
    v_alloc_sum := 0;

    IF v_product_name = '' THEN
      RAISE EXCEPTION '제품명이 필요합니다.';
    END IF;
    IF v_line->'allocations' IS NULL
      OR jsonb_typeof(v_line->'allocations') <> 'array'
      OR jsonb_array_length(v_line->'allocations') = 0 THEN
      RAISE EXCEPTION 'LOT 배분(allocations)이 필요합니다.';
    END IF;

    FOR v_alloc IN SELECT value FROM jsonb_array_elements(v_line->'allocations')
    LOOP
      v_production_header_id := NULLIF(v_alloc->>'production_header_id', '')::UUID;
      v_qty := COALESCE((v_alloc->>'quantity_used')::NUMERIC, 0);
      IF v_production_header_id IS NULL THEN
        RAISE EXCEPTION '생산 LOT 선택이 필요합니다.';
      END IF;
      IF v_qty <= 0 THEN
        RAISE EXCEPTION 'LOT별 출고수량은 0보다 커야 합니다.';
      END IF;

      SELECT id, product_name, finished_qty
        INTO v_prod
      FROM public.harang_production_headers
      WHERE id = v_production_header_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION '선택한 생산 LOT를 찾을 수 없습니다.';
      END IF;

      IF trim(COALESCE(v_prod.product_name, '')) <> trim(v_product_name) THEN
        RAISE EXCEPTION 'LOT 제품과 출고 제품이 일치하지 않습니다.';
      END IF;

      SELECT COALESCE(SUM(ll.quantity_used), 0)
        INTO v_used
      FROM public.harang_finished_product_outbound_line_lots ll
      JOIN public.harang_finished_product_outbound_lines ln ON ln.id = ll.line_id
      WHERE ll.production_header_id = v_production_header_id
        AND ln.header_id <> p_header_id;

      v_available := GREATEST(COALESCE(v_prod.finished_qty, 0) - COALESCE(v_used, 0), 0);
      IF v_available < v_qty THEN
        RAISE EXCEPTION '가용 재고를 초과했습니다. (요청 %, 가용 %)', v_qty, v_available;
      END IF;

      v_alloc_sum := v_alloc_sum + v_qty;
    END LOOP;

    IF v_outbound_qty <= 0 THEN
      v_outbound_qty := v_alloc_sum;
    END IF;

    IF ABS(v_alloc_sum - v_outbound_qty) > 0.0005 THEN
      RAISE EXCEPTION 'LOT 배분 합계와 출고수량이 일치하지 않습니다.';
    END IF;

    INSERT INTO public.harang_finished_product_outbound_lines (
      header_id, product_name, unit, outbound_qty, sort_order
    )
    VALUES (
      p_header_id, trim(v_product_name), trim(v_unit), v_outbound_qty, v_sort_order
    )
    RETURNING id INTO v_line_id;

    FOR v_alloc IN SELECT value FROM jsonb_array_elements(v_line->'allocations')
    LOOP
      v_production_header_id := NULLIF(v_alloc->>'production_header_id', '')::UUID;
      v_qty := COALESCE((v_alloc->>'quantity_used')::NUMERIC, 0);
      INSERT INTO public.harang_finished_product_outbound_line_lots (
        line_id, production_header_id, quantity_used
      )
      VALUES (
        v_line_id, v_production_header_id, v_qty
      );
    END LOOP;
  END LOOP;

  RETURN p_header_id;
END;
$$;

INSERT INTO public.harang_outbound_clients (name, manager_name, phone, address, is_active, sort_order)
SELECT '(주)커텍트', NULL, NULL, NULL, TRUE, 0
WHERE NOT EXISTS (
  SELECT 1
  FROM public.harang_outbound_clients
  WHERE trim(name) = '(주)커텍트'
);

INSERT INTO public.harang_outbound_supplier_profile (id, name, manager_name, phone, address)
SELECT TRUE, '(주)하랑커뮤니티', NULL, NULL, '대전광역시 유성구 북용북로33번길 16-20'
WHERE NOT EXISTS (
  SELECT 1
  FROM public.harang_outbound_supplier_profile
  WHERE id = TRUE
);

GRANT EXECUTE ON FUNCTION public.create_harang_finished_product_outbound(
  DATE, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_harang_finished_product_outbound(
  UUID, DATE, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO authenticated;

NOTIFY pgrst, 'reload schema';
