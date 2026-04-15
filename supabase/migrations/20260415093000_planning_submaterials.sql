-- ============================================================
-- Planning-only submaterials
-- - Used only by monthly planning material/order calculations
-- - Must NOT affect existing bom consumers (outbound/history/dashboard)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.planning_submaterials (
  id BIGSERIAL PRIMARY KEY,
  product_name_snapshot TEXT NOT NULL,
  material_name TEXT NOT NULL,
  qty_g_per_ea NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (qty_g_per_ea >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_name_snapshot, material_name)
);

COMMENT ON TABLE public.planning_submaterials IS 'Planning-only submaterials for monthly planning material/order calculations.';
COMMENT ON COLUMN public.planning_submaterials.product_name_snapshot IS 'Snapshot key (same format as planning entry product_name_snapshot).';
COMMENT ON COLUMN public.planning_submaterials.qty_g_per_ea IS 'Required grams per EA for planning-only submaterial.';

CREATE INDEX IF NOT EXISTS idx_planning_submaterials_product
  ON public.planning_submaterials (product_name_snapshot);

CREATE INDEX IF NOT EXISTS idx_planning_submaterials_active
  ON public.planning_submaterials (active)
  WHERE active = true;

DROP TRIGGER IF EXISTS set_planning_submaterials_updated_at ON public.planning_submaterials;
CREATE TRIGGER set_planning_submaterials_updated_at
  BEFORE UPDATE ON public.planning_submaterials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.planning_submaterials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planning_submaterials_select_authenticated" ON public.planning_submaterials;
DROP POLICY IF EXISTS "planning_submaterials_write_manager_admin" ON public.planning_submaterials;

CREATE POLICY "planning_submaterials_select_authenticated"
  ON public.planning_submaterials FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "planning_submaterials_write_manager_admin"
  ON public.planning_submaterials FOR ALL
  TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin'));

NOTIFY pgrst, 'reload schema';
