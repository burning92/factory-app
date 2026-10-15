-- 22-되돌리기. 094000 의 항목 잠금 트리거와 정정 요청 함수 제거
-- data_corrections 의 kind·requested_by 컬럼, 제약, 인덱스는 남깁니다(그 사이 기록된 정정 이력 보존).
-- 096000 이 남아 있으면 중단합니다. 되돌리기 순서: 31 → 22 → 21
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_daily_log_edit_rights', 'trg_daily_log_item_edit_rights')) THEN
    RAISE EXCEPTION '096000 을 먼저 되돌리세요(31 → 22 → 21 순서)';
  END IF;
END
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['daily_hygiene_log_items', 'daily_temp_humidity_log_items', 'daily_sanitation_facility_log_items', 'daily_worker_hygiene_log_items', 'daily_cold_storage_hygiene_log_items', 'daily_process_control_bread_log_items', 'daily_material_storage_3f_log_items', 'daily_manufacturing_equipment_log_items', 'daily_air_conditioning_equipment_log_items', 'daily_hoist_inspection_log_items', 'daily_illumination_log_items', 'daily_material_receiving_inspection_log_items']::text[] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_daily_log_item_parent_unlocked ON public.%I', t);
  END LOOP;
END
$$;

DROP FUNCTION IF EXISTS public.enforce_daily_log_item_parent_unlocked();
DROP FUNCTION IF EXISTS public.request_daily_log_correction(TEXT, UUID, TEXT);

COMMIT;

NOTIFY pgrst, 'reload schema';
