-- ============================================================
-- production_plan_rows: 월/버전/원본시트 메타 추가 (다중 월 조회 지원)
-- ============================================================

ALTER TABLE public.production_plan_rows
  ADD COLUMN IF NOT EXISTS plan_year INTEGER,
  ADD COLUMN IF NOT EXISTS plan_month INTEGER,
  ADD COLUMN IF NOT EXISTS plan_version TEXT,
  ADD COLUMN IF NOT EXISTS source_sheet_name TEXT;

UPDATE public.production_plan_rows
SET
  plan_year = COALESCE(plan_year, EXTRACT(YEAR FROM plan_date)::INTEGER),
  plan_month = COALESCE(plan_month, EXTRACT(MONTH FROM plan_date)::INTEGER),
  plan_version = COALESCE(NULLIF(plan_version, ''), 'master')
WHERE plan_year IS NULL
   OR plan_month IS NULL
   OR plan_version IS NULL
   OR plan_version = '';

ALTER TABLE public.production_plan_rows
  ALTER COLUMN plan_year SET NOT NULL,
  ALTER COLUMN plan_month SET NOT NULL,
  ALTER COLUMN plan_version SET NOT NULL;

ALTER TABLE public.production_plan_rows
  ALTER COLUMN plan_version SET DEFAULT 'master';

CREATE INDEX IF NOT EXISTS idx_production_plan_rows_year_month
  ON public.production_plan_rows (plan_year DESC, plan_month DESC);

CREATE INDEX IF NOT EXISTS idx_production_plan_rows_version
  ON public.production_plan_rows (plan_version);

NOTIFY pgrst, 'reload schema';
