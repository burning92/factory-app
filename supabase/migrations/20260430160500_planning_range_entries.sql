CREATE TABLE IF NOT EXISTS public.planning_range_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_name TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('annual', 'half', 'other')),
  reason TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  apply_mode TEXT NOT NULL DEFAULT 'all_days' CHECK (apply_mode IN ('all_days', 'weekdays_only')),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_planning_range_entries_period
  ON public.planning_range_entries (start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_planning_range_entries_person
  ON public.planning_range_entries (person_name, start_date);

DROP TRIGGER IF EXISTS set_planning_range_entries_updated_at ON public.planning_range_entries;
CREATE TRIGGER set_planning_range_entries_updated_at
  BEFORE UPDATE ON public.planning_range_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.planning_range_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planning_range_entries_select_authenticated" ON public.planning_range_entries;
DROP POLICY IF EXISTS "planning_range_entries_write_manager_admin" ON public.planning_range_entries;

CREATE POLICY "planning_range_entries_select_authenticated"
  ON public.planning_range_entries FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "planning_range_entries_write_manager_admin"
  ON public.planning_range_entries FOR ALL
  TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'headquarters'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'headquarters'));

NOTIFY pgrst, 'reload schema';
