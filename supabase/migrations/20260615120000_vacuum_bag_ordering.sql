-- 진공봉투 발주 판단: 종류·잔량·입출고 이력

CREATE TABLE IF NOT EXISTS public.vacuum_bag_kinds (
  kind_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  planning_material_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vacuum_bag_kinds IS '진공봉투 종류. planning_submaterials.material_name 과 매칭.';
COMMENT ON COLUMN public.vacuum_bag_kinds.planning_material_name IS '생산계획 부자재 BOM material_name 과 동일해야 필요량 집계됨.';

INSERT INTO public.vacuum_bag_kinds (kind_key, label, planning_material_name, sort_order)
VALUES
  ('pizza', '피자진공봉투', '피자진공봉투', 1),
  ('mini', '미니진공봉투', '미니진공봉투', 2)
ON CONFLICT (kind_key) DO UPDATE SET
  label = EXCLUDED.label,
  planning_material_name = EXCLUDED.planning_material_name,
  sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS public.vacuum_bag_balances (
  kind_key TEXT PRIMARY KEY REFERENCES public.vacuum_bag_kinds(kind_key) ON DELETE CASCADE,
  current_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (current_qty >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.vacuum_bag_balances IS '진공봉투 종류별 현재고(입고·사용·재고설정 반영).';

INSERT INTO public.vacuum_bag_balances (kind_key, current_qty)
SELECT kind_key, 0 FROM public.vacuum_bag_kinds
ON CONFLICT (kind_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.vacuum_bag_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind_key TEXT NOT NULL REFERENCES public.vacuum_bag_kinds(kind_key) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('stock_set', 'receipt', 'usage')),
  qty NUMERIC(14, 3) NOT NULL CHECK (qty > 0),
  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  memo TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.vacuum_bag_movements IS '진공봉투 입고·사용·재고설정 이력. stock_set 은 절대 재고로 설정.';
COMMENT ON COLUMN public.vacuum_bag_movements.movement_type IS 'receipt=입고, usage=사용, stock_set=재고 설정(절대값).';

CREATE INDEX IF NOT EXISTS idx_vacuum_bag_movements_kind_created
  ON public.vacuum_bag_movements (kind_key, created_at DESC);

ALTER TABLE public.vacuum_bag_kinds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacuum_bag_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacuum_bag_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vacuum_bag_kinds_select_authenticated" ON public.vacuum_bag_kinds;
CREATE POLICY "vacuum_bag_kinds_select_authenticated"
  ON public.vacuum_bag_kinds FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "vacuum_bag_balances_select_authenticated" ON public.vacuum_bag_balances;
CREATE POLICY "vacuum_bag_balances_select_authenticated"
  ON public.vacuum_bag_balances FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "vacuum_bag_balances_write_manager_admin" ON public.vacuum_bag_balances;
CREATE POLICY "vacuum_bag_balances_write_manager_admin"
  ON public.vacuum_bag_balances FOR ALL
  TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'headquarters'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'headquarters'));

DROP POLICY IF EXISTS "vacuum_bag_movements_select_authenticated" ON public.vacuum_bag_movements;
CREATE POLICY "vacuum_bag_movements_select_authenticated"
  ON public.vacuum_bag_movements FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "vacuum_bag_movements_write_manager_admin" ON public.vacuum_bag_movements;
CREATE POLICY "vacuum_bag_movements_write_manager_admin"
  ON public.vacuum_bag_movements FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'headquarters'));

NOTIFY pgrst, 'reload schema';
