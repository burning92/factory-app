-- ============================================================
-- Production planning board (semantic tables)
-- months / entries / notes / manpower / closings
-- ============================================================

CREATE TABLE IF NOT EXISTS public.production_plan_months (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_year INTEGER NOT NULL CHECK (plan_year BETWEEN 2000 AND 2100),
  plan_month INTEGER NOT NULL CHECK (plan_month BETWEEN 1 AND 12),
  version_type TEXT NOT NULL CHECK (version_type IN ('master', 'draft', 'end')),
  title TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  source_note TEXT,
  baseline_headcount NUMERIC(10, 2) NOT NULL DEFAULT 25,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_year, plan_month, version_type)
);

COMMENT ON TABLE public.production_plan_months IS 'Monthly planning header. version_type distinguishes editable and closing snapshots.';
COMMENT ON COLUMN public.production_plan_months.baseline_headcount IS 'Fallback baseline members for actual manpower calculation.';

CREATE INDEX IF NOT EXISTS idx_production_plan_months_year_month
  ON public.production_plan_months (plan_year DESC, plan_month DESC);

CREATE TABLE IF NOT EXISTS public.production_plan_entries (
  id BIGSERIAL PRIMARY KEY,
  month_id UUID NOT NULL REFERENCES public.production_plan_months(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  qty NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (qty >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.production_plan_entries IS 'Date/product production plan rows.';

CREATE INDEX IF NOT EXISTS idx_production_plan_entries_month_date
  ON public.production_plan_entries (month_id, plan_date);

CREATE TABLE IF NOT EXISTS public.production_plan_notes (
  id BIGSERIAL PRIMARY KEY,
  month_id UUID NOT NULL REFERENCES public.production_plan_months(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  note_text TEXT NOT NULL,
  note_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.production_plan_notes IS 'Per-date notes/memos. Multiple lines allowed.';

CREATE INDEX IF NOT EXISTS idx_production_plan_notes_month_date
  ON public.production_plan_notes (month_id, plan_date);

CREATE TABLE IF NOT EXISTS public.production_plan_manpower (
  id BIGSERIAL PRIMARY KEY,
  month_id UUID NOT NULL REFERENCES public.production_plan_months(id) ON DELETE CASCADE,
  plan_date DATE NOT NULL,
  annual_leave_count NUMERIC(10, 2) NOT NULL DEFAULT 0,
  half_day_count NUMERIC(10, 2) NOT NULL DEFAULT 0,
  other_count NUMERIC(10, 2) NOT NULL DEFAULT 0,
  actual_manpower NUMERIC(10, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (month_id, plan_date)
);

COMMENT ON TABLE public.production_plan_manpower IS 'Per-date manpower and leave counters.';

CREATE INDEX IF NOT EXISTS idx_production_plan_manpower_month_date
  ON public.production_plan_manpower (month_id, plan_date);

CREATE TABLE IF NOT EXISTS public.production_plan_month_closings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_month_id UUID NOT NULL REFERENCES public.production_plan_months(id) ON DELETE CASCADE,
  closed_month_id UUID NOT NULL REFERENCES public.production_plan_months(id) ON DELETE CASCADE,
  plan_year INTEGER NOT NULL,
  plan_month INTEGER NOT NULL,
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.production_plan_month_closings IS 'Closing logs for month snapshot from master to end.';

DROP TRIGGER IF EXISTS set_production_plan_months_updated_at ON public.production_plan_months;
CREATE TRIGGER set_production_plan_months_updated_at
  BEFORE UPDATE ON public.production_plan_months
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_production_plan_entries_updated_at ON public.production_plan_entries;
CREATE TRIGGER set_production_plan_entries_updated_at
  BEFORE UPDATE ON public.production_plan_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_production_plan_notes_updated_at ON public.production_plan_notes;
CREATE TRIGGER set_production_plan_notes_updated_at
  BEFORE UPDATE ON public.production_plan_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_production_plan_manpower_updated_at ON public.production_plan_manpower;
CREATE TRIGGER set_production_plan_manpower_updated_at
  BEFORE UPDATE ON public.production_plan_manpower
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.production_plan_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plan_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plan_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plan_manpower ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plan_month_closings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "production_plan_months_select_authenticated" ON public.production_plan_months;
DROP POLICY IF EXISTS "production_plan_entries_select_authenticated" ON public.production_plan_entries;
DROP POLICY IF EXISTS "production_plan_notes_select_authenticated" ON public.production_plan_notes;
DROP POLICY IF EXISTS "production_plan_manpower_select_authenticated" ON public.production_plan_manpower;
DROP POLICY IF EXISTS "production_plan_month_closings_select_authenticated" ON public.production_plan_month_closings;
DROP POLICY IF EXISTS "production_plan_months_write_manager_admin" ON public.production_plan_months;
DROP POLICY IF EXISTS "production_plan_entries_write_manager_admin" ON public.production_plan_entries;
DROP POLICY IF EXISTS "production_plan_notes_write_manager_admin" ON public.production_plan_notes;
DROP POLICY IF EXISTS "production_plan_manpower_write_manager_admin" ON public.production_plan_manpower;
DROP POLICY IF EXISTS "production_plan_month_closings_write_manager_admin" ON public.production_plan_month_closings;

CREATE POLICY "production_plan_months_select_authenticated"
  ON public.production_plan_months FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "production_plan_entries_select_authenticated"
  ON public.production_plan_entries FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "production_plan_notes_select_authenticated"
  ON public.production_plan_notes FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "production_plan_manpower_select_authenticated"
  ON public.production_plan_manpower FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "production_plan_month_closings_select_authenticated"
  ON public.production_plan_month_closings FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "production_plan_months_write_manager_admin"
  ON public.production_plan_months FOR ALL
  TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin'));

CREATE POLICY "production_plan_entries_write_manager_admin"
  ON public.production_plan_entries FOR ALL
  TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin'));

CREATE POLICY "production_plan_notes_write_manager_admin"
  ON public.production_plan_notes FOR ALL
  TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin'));

CREATE POLICY "production_plan_manpower_write_manager_admin"
  ON public.production_plan_manpower FOR ALL
  TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin'));

CREATE POLICY "production_plan_month_closings_write_manager_admin"
  ON public.production_plan_month_closings FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin'));

CREATE OR REPLACE VIEW public.production_plan_processed_v AS
SELECT
  e.plan_date,
  e.product_name_snapshot AS product_name,
  e.qty,
  COALESCE(m.actual_manpower, 0) AS manpower,
  COALESCE(string_agg(n.note_text, E'\n' ORDER BY n.note_order), '') AS notes,
  pm.plan_year,
  pm.plan_month,
  pm.version_type,
  pm.status,
  pm.id AS month_id
FROM public.production_plan_entries e
JOIN public.production_plan_months pm ON pm.id = e.month_id
LEFT JOIN public.production_plan_manpower m
  ON m.month_id = e.month_id AND m.plan_date = e.plan_date
LEFT JOIN public.production_plan_notes n
  ON n.month_id = e.month_id AND n.plan_date = e.plan_date
GROUP BY
  e.plan_date,
  e.product_name_snapshot,
  e.qty,
  m.actual_manpower,
  pm.plan_year,
  pm.plan_month,
  pm.version_type,
  pm.status,
  pm.id;

COMMENT ON VIEW public.production_plan_processed_v IS 'Processed view: date/product/qty/manpower/notes.';

NOTIFY pgrst, 'reload schema';