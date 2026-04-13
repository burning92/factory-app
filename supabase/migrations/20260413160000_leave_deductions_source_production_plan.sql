-- ============================================================
-- leave_deductions.source: manual vs 생산계획 시트 동기화 자동 반영
-- ============================================================

ALTER TABLE public.leave_deductions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'production_plan'));

COMMENT ON COLUMN public.leave_deductions.source IS 'manual=관리 화면 등록, production_plan=생산계획 시트 동기화 시 재생성';

CREATE INDEX IF NOT EXISTS idx_leave_deductions_source ON public.leave_deductions (source);

NOTIFY pgrst, 'reload schema';
