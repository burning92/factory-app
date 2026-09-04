-- ============================================================
-- profiles.include_in_field_headcount
-- 월간 플래닝·인력 KPI «현장 인원 집계»를 역할이 아니라 계정별 지정으로 계산
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS include_in_field_headcount BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.include_in_field_headcount IS
  '월간 플래닝·인력 KPI 현장 총원(참고) 집계에 포함할지. 관리 화면에서 계정별로 지정.';

-- 기존 집계 규칙과 동일하게 백필: 100~199 조직 + 워커·준매니저·매니저, test·admin 로그인 제외
UPDATE public.profiles AS p
SET include_in_field_headcount = true
FROM public.organizations AS o
WHERE p.organization_id = o.id
  AND p.role IN ('worker', 'assistant_manager', 'manager')
  AND o.organization_code ~ '^\d{3}$'
  AND o.organization_code::integer BETWEEN 100 AND 199
  AND lower(btrim(COALESCE(p.login_id, ''))) <> 'admin'
  AND lower(btrim(COALESCE(p.login_id, ''))) NOT LIKE 'test%';

NOTIFY pgrst, 'reload schema';
