-- ============================================================
-- Planning leave options + leave adjustments ledger
-- ============================================================

ALTER TABLE public.production_plan_leaves
  ADD COLUMN IF NOT EXISTS deduct_from_leave BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS grant_days NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (grant_days >= 0);

COMMENT ON COLUMN public.production_plan_leaves.deduct_from_leave IS 'true면 leave_deductions(차감)에 반영';
COMMENT ON COLUMN public.production_plan_leaves.grant_days IS '추가연차 가산 일수(예: 주말 특근 보상 +1)';

CREATE TABLE IF NOT EXISTS public.leave_adjustments (
  id BIGSERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year SMALLINT NOT NULL CHECK (year >= 2000 AND year <= 2100),
  usage_date DATE NOT NULL,
  adjust_days NUMERIC(10,2) NOT NULL CHECK (adjust_days <> 0),
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'planning_board_grant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_leave_adjustments_profile_year
  ON public.leave_adjustments (profile_id, year);

CREATE INDEX IF NOT EXISTS idx_leave_adjustments_source
  ON public.leave_adjustments (source);

ALTER TABLE public.leave_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leave_adjustments_select_own_or_admin" ON public.leave_adjustments;
DROP POLICY IF EXISTS "leave_adjustments_insert_admin" ON public.leave_adjustments;
DROP POLICY IF EXISTS "leave_adjustments_update_admin" ON public.leave_adjustments;
DROP POLICY IF EXISTS "leave_adjustments_delete_admin" ON public.leave_adjustments;

CREATE POLICY "leave_adjustments_select_own_or_admin"
  ON public.leave_adjustments FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid() OR public.get_my_profile_role() = 'admin');

CREATE POLICY "leave_adjustments_insert_admin"
  ON public.leave_adjustments FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_profile_role() = 'admin');

CREATE POLICY "leave_adjustments_update_admin"
  ON public.leave_adjustments FOR UPDATE
  TO authenticated
  USING (public.get_my_profile_role() = 'admin')
  WITH CHECK (public.get_my_profile_role() = 'admin');

CREATE POLICY "leave_adjustments_delete_admin"
  ON public.leave_adjustments FOR DELETE
  TO authenticated
  USING (public.get_my_profile_role() = 'admin');

NOTIFY pgrst, 'reload schema';
