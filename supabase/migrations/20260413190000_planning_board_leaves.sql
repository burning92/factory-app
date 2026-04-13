-- ============================================================
-- Planning board leave names (annual / half) + leave_deductions source extension
-- ============================================================

CREATE TABLE IF NOT EXISTS public.production_plan_leaves (
  id BIGSERIAL PRIMARY KEY,
  month_id UUID NOT NULL REFERENCES public.production_plan_months(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('annual', 'half')),
  person_name TEXT NOT NULL,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_production_plan_leaves_month_date
  ON public.production_plan_leaves (month_id, plan_date);

DROP TRIGGER IF EXISTS set_production_plan_leaves_updated_at ON public.production_plan_leaves;
CREATE TRIGGER set_production_plan_leaves_updated_at
  BEFORE UPDATE ON public.production_plan_leaves
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.production_plan_leaves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "production_plan_leaves_select_authenticated" ON public.production_plan_leaves;
DROP POLICY IF EXISTS "production_plan_leaves_write_manager_admin" ON public.production_plan_leaves;

CREATE POLICY "production_plan_leaves_select_authenticated"
  ON public.production_plan_leaves FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "production_plan_leaves_write_manager_admin"
  ON public.production_plan_leaves FOR ALL
  TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin'));

-- leave_deductions.source: planning_board 허용
ALTER TABLE public.leave_deductions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE public.leave_deductions
  DROP CONSTRAINT IF EXISTS leave_deductions_source_check;

ALTER TABLE public.leave_deductions
  ADD CONSTRAINT leave_deductions_source_check
  CHECK (source IN ('manual', 'production_plan', 'planning_board'));

NOTIFY pgrst, 'reload schema';
