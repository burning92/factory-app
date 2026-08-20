-- 로테이션 포지션별 시간대 최소·최대 인원 (가열·R&D 제외)

ALTER TABLE public.rotation_positions
  ADD COLUMN IF NOT EXISTS min_by_period JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.rotation_positions
  ADD COLUMN IF NOT EXISTS max_by_period JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.rotation_positions.min_by_period IS
  '시간대별 최소 인원 {start,lunch1,lunch2,after}. 가열·R&D는 비움.';
COMMENT ON COLUMN public.rotation_positions.max_by_period IS
  '시간대별 최대 인원 {start,lunch1,lunch2,after}. 가열·R&D는 비움.';

NOTIFY pgrst, 'reload schema';
