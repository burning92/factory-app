-- ============================================================
-- profiles.hire_date: 입사일자(연월차 관리용)
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hire_date DATE;

COMMENT ON COLUMN public.profiles.hire_date IS '입사일자. 연월차 관리 화면에서 관리자 입력.';

NOTIFY pgrst, 'reload schema';
