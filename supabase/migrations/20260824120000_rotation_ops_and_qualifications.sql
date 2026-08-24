ALTER TABLE public.rotation_workers
  ADD COLUMN IF NOT EXISTS constraints JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.rotation_workers.constraints IS
  '인원별 배치 조건 JSON. lockPreferred, stayFloor, doughCore, excluded, fieldBackup, qualifications.{threeSidePacker}';

CREATE TABLE IF NOT EXISTS public.rotation_ops (
  organization_code text PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rotation_ops IS
  '로테이션 운영 설정. payload.dough.minStaff, payload.dough.rotationPolicy=CURRENT_LUNCH_BACKUP|FIXED_DOUGH';
