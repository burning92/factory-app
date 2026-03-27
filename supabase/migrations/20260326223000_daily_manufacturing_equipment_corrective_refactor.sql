-- ============================================================
-- 제조설비 점검표 개선조치 리팩터링
-- - 항목별 nonconformity_note 강제 제거
-- - 헤더에 개선조치 필드 추가(기존 daily 패턴 정렬)
-- ============================================================

ALTER TABLE public.daily_manufacturing_equipment_logs
  ADD COLUMN IF NOT EXISTS corrective_datetime TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS corrective_deviation TEXT,
  ADD COLUMN IF NOT EXISTS corrective_detail TEXT,
  ADD COLUMN IF NOT EXISTS corrective_remarks TEXT,
  ADD COLUMN IF NOT EXISTS corrective_actor TEXT;

COMMENT ON COLUMN public.daily_manufacturing_equipment_logs.corrective_deviation IS '이탈 내용';
COMMENT ON COLUMN public.daily_manufacturing_equipment_logs.corrective_detail IS '개선조치내용';
COMMENT ON COLUMN public.daily_manufacturing_equipment_logs.corrective_remarks IS '비고';

ALTER TABLE public.daily_manufacturing_equipment_log_items
  DROP CONSTRAINT IF EXISTS daily_manufacturing_equipment_nonconformity_check;

COMMENT ON COLUMN public.daily_manufacturing_equipment_log_items.nonconformity_note IS
  '현재 미사용(기존 데이터 호환용).';

NOTIFY pgrst, 'reload schema';
