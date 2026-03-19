-- ============================================================
-- 영업장환경위생점검일지: 작성 → 제출 → 승인/반려 구조 확장
-- HACCP/FSSC22000 대응, 계정 기반 승인 이력, 승인 후 수정 잠금
-- ============================================================

ALTER TABLE public.daily_hygiene_logs
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected'));

ALTER TABLE public.daily_hygiene_logs
  ADD COLUMN IF NOT EXISTS author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.daily_hygiene_logs
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.daily_hygiene_logs
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_by_name TEXT;

ALTER TABLE public.daily_hygiene_logs
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reject_reason TEXT;

COMMENT ON COLUMN public.daily_hygiene_logs.status IS 'draft=작성중, submitted=제출됨, approved=승인완료(수정잠금), rejected=반려';
COMMENT ON COLUMN public.daily_hygiene_logs.author_user_id IS '작성자 계정(auth.users.id).';
COMMENT ON COLUMN public.daily_hygiene_logs.submitted_by IS '제출한 사용자 계정.';
COMMENT ON COLUMN public.daily_hygiene_logs.approved_by IS '승인한 사용자 계정.';
COMMENT ON COLUMN public.daily_hygiene_logs.approved_by_name IS '승인자 이름 스냅샷.';
COMMENT ON COLUMN public.daily_hygiene_logs.rejected_by IS '반려한 사용자 계정.';
COMMENT ON COLUMN public.daily_hygiene_logs.reject_reason IS '반려 사유(선택).';

CREATE INDEX IF NOT EXISTS idx_daily_hygiene_logs_status ON public.daily_hygiene_logs (organization_code, status);

NOTIFY pgrst, 'reload schema';
