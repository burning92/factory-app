-- ============================================================
-- 영업장 조도 점검일지: 점검일자(date) 컬럼 추가
-- 기존 inspected_at(timestamp) 데이터에서 점검일자를 백필
-- ============================================================

ALTER TABLE public.daily_illumination_logs
  ADD COLUMN IF NOT EXISTS inspection_date DATE;

UPDATE public.daily_illumination_logs
SET inspection_date = inspected_at::date
WHERE inspection_date IS NULL
  AND inspected_at IS NOT NULL;

ALTER TABLE public.daily_illumination_logs
  ALTER COLUMN inspection_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_illumination_logs_org_inspection_date
  ON public.daily_illumination_logs (organization_code, inspection_date DESC);

COMMENT ON COLUMN public.daily_illumination_logs.inspection_date IS '점검일자(로컬 기준 일자 기록)';

NOTIFY pgrst, 'reload schema';
