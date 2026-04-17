-- ============================================================
-- 하랑 생산요청 (본사 등록 전용, 품목 단위 예약, BOM 스냅샷)
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_headquarters_organization()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.get_my_organization_code() = '100';
$$;

GRANT EXECUTE ON FUNCTION public.is_headquarters_organization() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_harang_organization()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.get_my_organization_code() = '200';
$$;

GRANT EXECUTE ON FUNCTION public.is_harang_organization() TO authenticated;

CREATE TABLE IF NOT EXISTS public.harang_production_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no TEXT NOT NULL UNIQUE,
  request_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  due_date DATE NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'shortage', 'in_progress', 'completed', 'cancelled')),
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.harang_production_request_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  header_id UUID NOT NULL REFERENCES public.harang_production_requests(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  requested_qty NUMERIC(14, 3) NOT NULL CHECK (requested_qty > 0),
  produced_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (produced_qty >= 0),
  remaining_qty NUMERIC(14, 3) NOT NULL CHECK (remaining_qty >= 0),
  material_shortage_flag BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_harang_pr_line_qty CHECK (ABS((remaining_qty + produced_qty) - requested_qty) < 0.001)
);

CREATE TABLE IF NOT EXISTS public.harang_production_request_line_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_line_id UUID NOT NULL REFERENCES public.harang_production_request_lines(id) ON DELETE CASCADE,
  material_category TEXT NOT NULL CHECK (material_category IN ('raw_material', 'packaging_material')),
  material_id UUID NOT NULL,
  material_code TEXT NOT NULL,
  material_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  bom_qty_per_unit NUMERIC(14, 6) NOT NULL CHECK (bom_qty_per_unit >= 0),
  snapshot_required_total NUMERIC(14, 3) NOT NULL CHECK (snapshot_required_total >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_line_id, material_category, material_id)
);

CREATE TABLE IF NOT EXISTS public.harang_production_request_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_line_id UUID NOT NULL REFERENCES public.harang_production_request_lines(id) ON DELETE CASCADE,
  material_category TEXT NOT NULL CHECK (material_category IN ('raw_material', 'packaging_material')),
  material_id UUID NOT NULL,
  reserved_qty NUMERIC(14, 3) NOT NULL CHECK (reserved_qty >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_line_id, material_category, material_id)
);

CREATE INDEX IF NOT EXISTS idx_harang_pr_lines_header ON public.harang_production_request_lines (header_id);
CREATE INDEX IF NOT EXISTS idx_harang_pr_line_materials_line ON public.harang_production_request_line_materials (request_line_id);
CREATE INDEX IF NOT EXISTS idx_harang_pr_reservations_mat ON public.harang_production_request_reservations (material_category, material_id);
CREATE INDEX IF NOT EXISTS idx_harang_pr_requests_status ON public.harang_production_requests (status, due_date DESC);

DROP TRIGGER IF EXISTS set_harang_production_requests_updated_at ON public.harang_production_requests;
CREATE TRIGGER set_harang_production_requests_updated_at
  BEFORE UPDATE ON public.harang_production_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_harang_production_request_lines_updated_at ON public.harang_production_request_lines;
CREATE TRIGGER set_harang_production_request_lines_updated_at
  BEFORE UPDATE ON public.harang_production_request_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.harang_current_stock_by_material(
  p_category TEXT,
  p_item_id UUID
) RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(l.current_quantity), 0)::NUMERIC(14, 3)
  FROM public.harang_inventory_lots l
  WHERE l.category = p_category AND l.item_id = p_item_id;
$$;

CREATE OR REPLACE FUNCTION public.harang_total_reserved_qty(
  p_category TEXT,
  p_item_id UUID
) RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(r.reserved_qty), 0)::NUMERIC(14, 3)
  FROM public.harang_production_request_reservations r
  JOIN public.harang_production_request_lines ln ON ln.id = r.request_line_id
  JOIN public.harang_production_requests h ON h.id = ln.header_id
  WHERE r.material_category = p_category
    AND r.material_id = p_item_id
    AND h.status NOT IN ('completed', 'cancelled')
    AND ln.remaining_qty > 0;
$$;

CREATE OR REPLACE FUNCTION public.next_harang_production_request_no()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  d TEXT := to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::DATE, 'YYYYMMDD');
  n INT;
BEGIN
  SELECT COALESCE(MAX((regexp_match(request_no, '^HRP-' || d || '-(\d+)$'))[1]::INT), 0) + 1
  INTO n
  FROM public.harang_production_requests
  WHERE request_no ~ ('^HRP-' || d || '-\d+$');

  RETURN 'HRP-' || d || '-' || lpad(n::TEXT, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_harang_request_line_reservations(p_line_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rem NUMERIC;
BEGIN
  SELECT remaining_qty INTO rem FROM public.harang_production_request_lines WHERE id = p_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'line not found';
  END IF;

  DELETE FROM public.harang_production_request_reservations WHERE request_line_id = p_line_id;

  IF rem <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.harang_production_request_reservations (
    request_line_id, material_category, material_id, reserved_qty
  )
  SELECT
    p_line_id,
    m.material_category,
    m.material_id,
    ROUND((m.bom_qty_per_unit * rem)::NUMERIC, 3)
  FROM public.harang_production_request_line_materials m
  WHERE m.request_line_id = p_line_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_harang_request_line_shortage_flags(p_line_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rem NUMERIC;
  any_short BOOLEAN := false;
  r RECORD;
  s NUMERIC;
  rsum NUMERIC;
  need NUMERIC;
  rother NUMERIC;
  avail_other NUMERIC;
BEGIN
  SELECT remaining_qty INTO rem FROM public.harang_production_request_lines WHERE id = p_line_id;
  IF rem <= 0 THEN
    UPDATE public.harang_production_request_lines SET material_shortage_flag = false WHERE id = p_line_id;
    RETURN;
  END IF;

  FOR r IN
    SELECT material_category, material_id, bom_qty_per_unit
    FROM public.harang_production_request_line_materials
    WHERE request_line_id = p_line_id
  LOOP
    need := ROUND((r.bom_qty_per_unit * rem)::NUMERIC, 3);
    s := public.harang_current_stock_by_material(r.material_category, r.material_id);
    rsum := public.harang_total_reserved_qty(r.material_category, r.material_id);
    rother := rsum - need;
    avail_other := s - rother;
    IF need > GREATEST(avail_other, 0) THEN
      any_short := true;
      EXIT;
    END IF;
  END LOOP;

  UPDATE public.harang_production_request_lines
  SET material_shortage_flag = any_short, updated_at = now()
  WHERE id = p_line_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_harang_all_open_shortage_flags()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT ln.id AS line_id
    FROM public.harang_production_request_lines ln
    JOIN public.harang_production_requests h ON h.id = ln.header_id
    WHERE h.status NOT IN ('completed', 'cancelled')
      AND ln.remaining_qty > 0
  LOOP
    PERFORM public.refresh_harang_request_line_shortage_flags(r.line_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_every_harang_request_header_status()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.harang_production_requests WHERE status <> 'cancelled'
  LOOP
    PERFORM public.refresh_harang_request_header_status(r.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_harang_request_header_status(p_header_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  st TEXT;
  cur_st TEXT;
  has_short BOOLEAN;
  has_prog BOOLEAN;
  all_done BOOLEAN;
  line_count INT;
BEGIN
  SELECT status INTO cur_st FROM public.harang_production_requests WHERE id = p_header_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF cur_st = 'cancelled' THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO line_count FROM public.harang_production_request_lines WHERE header_id = p_header_id;

  IF line_count = 0 THEN
    has_short := false;
    has_prog := false;
    all_done := false;
  ELSE
    SELECT
      COALESCE(BOOL_OR(ln.material_shortage_flag AND ln.remaining_qty > 0), false),
      COALESCE(BOOL_OR(ln.produced_qty > 0), false),
      COALESCE(BOOL_AND(ln.remaining_qty <= 0), false)
    INTO has_short, has_prog, all_done
    FROM public.harang_production_request_lines ln
    WHERE ln.header_id = p_header_id;
  END IF;

  IF line_count = 0 THEN
    st := 'pending';
  ELSIF all_done THEN
    st := 'completed';
  ELSIF has_short THEN
    st := 'shortage';
  ELSIF has_prog THEN
    st := 'in_progress';
  ELSE
    st := 'pending';
  END IF;

  UPDATE public.harang_production_requests SET status = st, updated_at = now() WHERE id = p_header_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_harang_production_request(
  p_request_date DATE,
  p_due_date DATE,
  p_priority INTEGER,
  p_note TEXT,
  p_lines JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  hid UUID;
  rno TEXT;
  new_line_id UUID;
  sort_i INT := 0;
  bom_rec RECORD;
  req_total NUMERIC;
  line_obj JSONB;
  i INT;
  n_lines INT;
  pname TEXT;
  rqty NUMERIC;
  bom_count INT;
BEGIN
  IF NOT public.is_headquarters_organization() THEN
    RAISE EXCEPTION '생산요청 등록은 본사(조직 100)만 가능합니다.';
  END IF;
  IF public.get_my_profile_role() NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION '요청 라인이 필요합니다.';
  END IF;

  n_lines := jsonb_array_length(p_lines);
  rno := public.next_harang_production_request_no();

  INSERT INTO public.harang_production_requests (
    request_no, request_date, due_date, priority, status, note, created_by
  ) VALUES (
    rno,
    COALESCE(p_request_date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::DATE),
    p_due_date,
    COALESCE(p_priority, 0),
    'pending',
    NULLIF(trim(p_note), ''),
    v_uid
  ) RETURNING id INTO hid;

  FOR i IN 0..n_lines - 1
  LOOP
    line_obj := p_lines->i;
    sort_i := sort_i + 1;
    pname := trim(COALESCE(line_obj->>'product_name', ''));
    rqty := (line_obj->>'requested_qty')::NUMERIC;
    IF pname = '' OR rqty IS NULL OR rqty <= 0 THEN
      RAISE EXCEPTION '제품명과 요청수량이 올바르지 않습니다.';
    END IF;

    INSERT INTO public.harang_production_request_lines (
      header_id, product_name, requested_qty, produced_qty, remaining_qty, sort_order, note
    ) VALUES (
      hid,
      pname,
      rqty,
      0,
      rqty,
      sort_i,
      NULLIF(trim(COALESCE(line_obj->>'note', '')), '')
    ) RETURNING id INTO new_line_id;

    SELECT COUNT(*) INTO bom_count
    FROM public.harang_product_bom b
    WHERE b.product_name = pname AND b.is_active = true;

    IF bom_count = 0 THEN
      RAISE EXCEPTION '제품 BOM이 없습니다: %', pname;
    END IF;

    FOR bom_rec IN
      SELECT b.material_category, b.material_id, b.material_code, b.material_name, b.bom_qty, b.unit
      FROM public.harang_product_bom b
      WHERE b.product_name = pname AND b.is_active = true
      ORDER BY b.material_category, b.material_name
    LOOP
      req_total := ROUND((bom_rec.bom_qty * rqty)::NUMERIC, 3);
      INSERT INTO public.harang_production_request_line_materials (
        request_line_id, material_category, material_id, material_code, material_name, unit,
        bom_qty_per_unit, snapshot_required_total, sort_order
      ) VALUES (
        new_line_id,
        bom_rec.material_category,
        bom_rec.material_id,
        bom_rec.material_code,
        bom_rec.material_name,
        bom_rec.unit,
        bom_rec.bom_qty,
        req_total,
        0
      );
    END LOOP;

    PERFORM public.refresh_harang_request_line_reservations(new_line_id);
  END LOOP;

  PERFORM public.refresh_harang_all_open_shortage_flags();
  PERFORM public.refresh_every_harang_request_header_status();
  RETURN hid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_harang_production_request(DATE, DATE, INTEGER, TEXT, JSONB) TO authenticated;

-- 하랑(200)만 생산 반영 (본사는 별도 테스트용으로 열지 않음)
CREATE OR REPLACE FUNCTION public.apply_harang_request_line_production(
  p_line_id UUID,
  p_produced_qty NUMERIC
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rem NUMERIC;
  hid UUID;
BEGIN
  IF NOT public.is_harang_organization() THEN
    RAISE EXCEPTION '생산 반영은 하랑(조직 200)만 가능합니다.';
  END IF;
  IF public.get_my_profile_role() NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  IF p_produced_qty IS NULL OR p_produced_qty <= 0 THEN
    RAISE EXCEPTION '생산수량은 0보다 커야 합니다.';
  END IF;

  SELECT remaining_qty, header_id
  INTO rem, hid
  FROM public.harang_production_request_lines
  WHERE id = p_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '요청 라인을 찾을 수 없습니다.';
  END IF;

  IF (SELECT status FROM public.harang_production_requests WHERE id = hid) IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION '완료되었거나 취소된 요청입니다.';
  END IF;

  IF p_produced_qty > rem THEN
    RAISE EXCEPTION '생산수량이 잔여수량을 초과합니다.';
  END IF;

  UPDATE public.harang_production_request_lines
  SET
    produced_qty = produced_qty + p_produced_qty,
    remaining_qty = remaining_qty - p_produced_qty,
    updated_at = now()
  WHERE id = p_line_id;

  PERFORM public.refresh_harang_request_line_reservations(p_line_id);
  PERFORM public.refresh_harang_all_open_shortage_flags();
  PERFORM public.refresh_every_harang_request_header_status();
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_harang_request_line_production(UUID, NUMERIC) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_harang_production_request(p_header_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_headquarters_organization() THEN
    RAISE EXCEPTION '취소는 본사만 가능합니다.';
  END IF;
  IF public.get_my_profile_role() NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  IF (SELECT status FROM public.harang_production_requests WHERE id = p_header_id) = 'completed' THEN
    RAISE EXCEPTION '완료된 요청은 취소할 수 없습니다.';
  END IF;

  UPDATE public.harang_production_request_lines
  SET produced_qty = requested_qty, remaining_qty = 0, updated_at = now()
  WHERE header_id = p_header_id;

  DELETE FROM public.harang_production_request_reservations
  WHERE request_line_id IN (SELECT id FROM public.harang_production_request_lines WHERE header_id = p_header_id);

  UPDATE public.harang_production_requests
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_header_id;

  PERFORM public.refresh_harang_all_open_shortage_flags();
  PERFORM public.refresh_every_harang_request_header_status();
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_harang_production_request(UUID) TO authenticated;

ALTER TABLE public.harang_production_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_production_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_production_request_line_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_production_request_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "harang_pr_requests_select" ON public.harang_production_requests;
CREATE POLICY "harang_pr_requests_select"
  ON public.harang_production_requests FOR SELECT TO authenticated
  USING (public.can_access_harang_data());

DROP POLICY IF EXISTS "harang_pr_lines_select" ON public.harang_production_request_lines;
CREATE POLICY "harang_pr_lines_select"
  ON public.harang_production_request_lines FOR SELECT TO authenticated
  USING (public.can_access_harang_data());

DROP POLICY IF EXISTS "harang_pr_line_materials_select" ON public.harang_production_request_line_materials;
CREATE POLICY "harang_pr_line_materials_select"
  ON public.harang_production_request_line_materials FOR SELECT TO authenticated
  USING (public.can_access_harang_data());

DROP POLICY IF EXISTS "harang_pr_reservations_select" ON public.harang_production_request_reservations;
CREATE POLICY "harang_pr_reservations_select"
  ON public.harang_production_request_reservations FOR SELECT TO authenticated
  USING (public.can_access_harang_data());

GRANT SELECT ON public.harang_production_requests TO authenticated;
GRANT SELECT ON public.harang_production_request_lines TO authenticated;
GRANT SELECT ON public.harang_production_request_line_materials TO authenticated;
GRANT SELECT ON public.harang_production_request_reservations TO authenticated;

NOTIFY pgrst, 'reload schema';
