-- ============================================================
-- Planning submaterial master
-- - independent from public.materials
-- - used by planning-only submaterial registration and stock mapping
-- ============================================================

CREATE TABLE IF NOT EXISTS public.planning_submaterial_items (
  id BIGSERIAL PRIMARY KEY,
  submaterial_name TEXT NOT NULL UNIQUE,
  box_weight_g NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (box_weight_g >= 0),
  unit_weight_g NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_weight_g >= 0),
  inventory_item_code TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.planning_submaterial_items IS 'Planning-only submaterial master with optional ecount item code mapping.';
COMMENT ON COLUMN public.planning_submaterial_items.submaterial_name IS 'Display name used in planning_submaterials.material_name.';

CREATE INDEX IF NOT EXISTS idx_planning_submaterial_items_active
  ON public.planning_submaterial_items (active)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_planning_submaterial_items_item_code
  ON public.planning_submaterial_items (inventory_item_code);

DROP TRIGGER IF EXISTS set_planning_submaterial_items_updated_at ON public.planning_submaterial_items;
CREATE TRIGGER set_planning_submaterial_items_updated_at
  BEFORE UPDATE ON public.planning_submaterial_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.planning_submaterial_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planning_submaterial_items_select_authenticated" ON public.planning_submaterial_items;
DROP POLICY IF EXISTS "planning_submaterial_items_write_manager_admin" ON public.planning_submaterial_items;

CREATE POLICY "planning_submaterial_items_select_authenticated"
  ON public.planning_submaterial_items FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "planning_submaterial_items_write_manager_admin"
  ON public.planning_submaterial_items FOR ALL
  TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin'));

NOTIFY pgrst, 'reload schema';
