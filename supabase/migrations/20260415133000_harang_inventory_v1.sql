-- ============================================================
-- Harang inventory v1
-- - Harang-only masters (raw/packaging/BOM)
-- - Inbound header/items
-- - Inventory lots / transactions
-- - RPC: create_harang_inbound_with_items
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_organization_code()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT o.organization_code
  FROM public.profiles p
  JOIN public.organizations o ON o.id = p.organization_id
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_organization_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_organization_code() TO anon;

CREATE OR REPLACE FUNCTION public.can_access_harang_data()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT (public.get_my_organization_code() = '200') OR (public.get_my_profile_role() = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.can_write_harang_ops()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.can_access_harang_data() AND public.get_my_profile_role() IN ('manager', 'admin');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_harang_master()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.can_access_harang_data() AND public.get_my_profile_role() = 'admin';
$$;

GRANT EXECUTE ON FUNCTION public.can_access_harang_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_harang_data() TO anon;
GRANT EXECUTE ON FUNCTION public.can_write_harang_ops() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_harang_master() TO authenticated;

CREATE TABLE IF NOT EXISTS public.harang_raw_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code TEXT NOT NULL UNIQUE,
  item_name TEXT NOT NULL,
  default_unit TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.harang_packaging_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code TEXT NOT NULL UNIQUE,
  item_name TEXT NOT NULL,
  default_unit TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.harang_product_bom (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name TEXT NOT NULL,
  material_id UUID NOT NULL REFERENCES public.harang_raw_materials(id) ON DELETE RESTRICT,
  material_code TEXT NOT NULL,
  material_name TEXT NOT NULL,
  bom_qty NUMERIC(14, 3) NOT NULL CHECK (bom_qty >= 0),
  unit TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_name, material_id)
);

CREATE TABLE IF NOT EXISTS public.harang_inbound_headers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_date DATE NOT NULL,
  inbound_no TEXT NOT NULL UNIQUE,
  inbound_route TEXT NOT NULL CHECK (inbound_route IN ('AF발송', '하랑직입고')),
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.harang_inbound_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  header_id UUID NOT NULL REFERENCES public.harang_inbound_headers(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('raw_material', 'packaging_material')),
  item_id UUID NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  lot_date DATE NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.harang_inventory_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (category IN ('raw_material', 'packaging_material')),
  item_id UUID NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  lot_date DATE NOT NULL,
  inbound_date DATE NOT NULL,
  inbound_route TEXT NOT NULL CHECK (inbound_route IN ('AF발송', '하랑직입고')),
  source_header_id UUID NOT NULL REFERENCES public.harang_inbound_headers(id) ON DELETE RESTRICT,
  source_item_id UUID NOT NULL REFERENCES public.harang_inbound_items(id) ON DELETE RESTRICT UNIQUE,
  initial_quantity NUMERIC(14, 3) NOT NULL CHECK (initial_quantity >= 0),
  current_quantity NUMERIC(14, 3) NOT NULL CHECK (current_quantity >= 0),
  unit TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.harang_inventory_transactions (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('raw_material', 'packaging_material')),
  item_id UUID NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  lot_id UUID REFERENCES public.harang_inventory_lots(id) ON DELETE SET NULL,
  tx_date DATE NOT NULL,
  tx_type TEXT NOT NULL CHECK (tx_type IN ('inbound', 'usage', 'adjustment')),
  reference_no TEXT,
  quantity_delta NUMERIC(14, 3) NOT NULL,
  unit TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_harang_raw_materials_name
  ON public.harang_raw_materials (item_name);
CREATE INDEX IF NOT EXISTS idx_harang_packaging_materials_name
  ON public.harang_packaging_materials (item_name);
CREATE INDEX IF NOT EXISTS idx_harang_product_bom_product
  ON public.harang_product_bom (product_name, is_active);
CREATE INDEX IF NOT EXISTS idx_harang_inbound_headers_date
  ON public.harang_inbound_headers (inbound_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_harang_inbound_headers_route
  ON public.harang_inbound_headers (inbound_route);
CREATE INDEX IF NOT EXISTS idx_harang_inbound_items_header
  ON public.harang_inbound_items (header_id);
CREATE INDEX IF NOT EXISTS idx_harang_inbound_items_item
  ON public.harang_inbound_items (category, item_id, lot_date);
CREATE INDEX IF NOT EXISTS idx_harang_inventory_lots_item
  ON public.harang_inventory_lots (category, item_id, current_quantity DESC);
CREATE INDEX IF NOT EXISTS idx_harang_inventory_lots_lot_date
  ON public.harang_inventory_lots (lot_date, inbound_date);
CREATE INDEX IF NOT EXISTS idx_harang_inventory_transactions_item_date
  ON public.harang_inventory_transactions (category, item_id, tx_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_harang_inventory_transactions_lot
  ON public.harang_inventory_transactions (lot_id, created_at DESC);

DROP TRIGGER IF EXISTS set_harang_raw_materials_updated_at ON public.harang_raw_materials;
CREATE TRIGGER set_harang_raw_materials_updated_at
  BEFORE UPDATE ON public.harang_raw_materials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_harang_packaging_materials_updated_at ON public.harang_packaging_materials;
CREATE TRIGGER set_harang_packaging_materials_updated_at
  BEFORE UPDATE ON public.harang_packaging_materials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_harang_product_bom_updated_at ON public.harang_product_bom;
CREATE TRIGGER set_harang_product_bom_updated_at
  BEFORE UPDATE ON public.harang_product_bom
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_harang_inbound_headers_updated_at ON public.harang_inbound_headers;
CREATE TRIGGER set_harang_inbound_headers_updated_at
  BEFORE UPDATE ON public.harang_inbound_headers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_harang_inbound_items_updated_at ON public.harang_inbound_items;
CREATE TRIGGER set_harang_inbound_items_updated_at
  BEFORE UPDATE ON public.harang_inbound_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_harang_inventory_lots_updated_at ON public.harang_inventory_lots;
CREATE TRIGGER set_harang_inventory_lots_updated_at
  BEFORE UPDATE ON public.harang_inventory_lots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.harang_raw_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_packaging_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_product_bom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_inbound_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_inbound_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_inventory_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "harang_raw_materials_select" ON public.harang_raw_materials;
DROP POLICY IF EXISTS "harang_raw_materials_write_admin" ON public.harang_raw_materials;
CREATE POLICY "harang_raw_materials_select"
  ON public.harang_raw_materials FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_raw_materials_write_admin"
  ON public.harang_raw_materials FOR ALL TO authenticated
  USING (public.can_manage_harang_master())
  WITH CHECK (public.can_manage_harang_master());

DROP POLICY IF EXISTS "harang_packaging_materials_select" ON public.harang_packaging_materials;
DROP POLICY IF EXISTS "harang_packaging_materials_write_admin" ON public.harang_packaging_materials;
CREATE POLICY "harang_packaging_materials_select"
  ON public.harang_packaging_materials FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_packaging_materials_write_admin"
  ON public.harang_packaging_materials FOR ALL TO authenticated
  USING (public.can_manage_harang_master())
  WITH CHECK (public.can_manage_harang_master());

DROP POLICY IF EXISTS "harang_product_bom_select" ON public.harang_product_bom;
DROP POLICY IF EXISTS "harang_product_bom_write_admin" ON public.harang_product_bom;
CREATE POLICY "harang_product_bom_select"
  ON public.harang_product_bom FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_product_bom_write_admin"
  ON public.harang_product_bom FOR ALL TO authenticated
  USING (public.can_manage_harang_master())
  WITH CHECK (public.can_manage_harang_master());

DROP POLICY IF EXISTS "harang_inbound_headers_select" ON public.harang_inbound_headers;
DROP POLICY IF EXISTS "harang_inbound_headers_write" ON public.harang_inbound_headers;
CREATE POLICY "harang_inbound_headers_select"
  ON public.harang_inbound_headers FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_inbound_headers_write"
  ON public.harang_inbound_headers FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

DROP POLICY IF EXISTS "harang_inbound_items_select" ON public.harang_inbound_items;
DROP POLICY IF EXISTS "harang_inbound_items_write" ON public.harang_inbound_items;
CREATE POLICY "harang_inbound_items_select"
  ON public.harang_inbound_items FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_inbound_items_write"
  ON public.harang_inbound_items FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

DROP POLICY IF EXISTS "harang_inventory_lots_select" ON public.harang_inventory_lots;
DROP POLICY IF EXISTS "harang_inventory_lots_write" ON public.harang_inventory_lots;
CREATE POLICY "harang_inventory_lots_select"
  ON public.harang_inventory_lots FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_inventory_lots_write"
  ON public.harang_inventory_lots FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

DROP POLICY IF EXISTS "harang_inventory_transactions_select" ON public.harang_inventory_transactions;
DROP POLICY IF EXISTS "harang_inventory_transactions_write" ON public.harang_inventory_transactions;
CREATE POLICY "harang_inventory_transactions_select"
  ON public.harang_inventory_transactions FOR SELECT TO authenticated
  USING (public.can_access_harang_data());
CREATE POLICY "harang_inventory_transactions_write"
  ON public.harang_inventory_transactions FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

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
      v_header_id,
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
      v_header_id,
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

  RETURN v_header_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_harang_inbound_with_items(DATE, TEXT, TEXT, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
