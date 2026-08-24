ALTER TABLE public.rotation_workers
  ADD COLUMN IF NOT EXISTS constraints JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.rotation_workers.constraints IS
  '인원별 배치 조건. lockPreferred=주공정만, stayFloor=층이동금지, doughCore=반죽고정조, excluded=배치제외';
