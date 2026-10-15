-- 21-되돌리기. 091000 제거 (데이터·감사로그 행은 건드리지 않음)
-- 094000·096000 이 남아 있으면 그 기능이 이 함수에 의존하므로 중단합니다. 되돌리기 순서: 31 → 22 → 21
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_daily_log_item_parent_unlocked', 'trg_daily_log_edit_rights', 'trg_daily_log_item_edit_rights'))
     OR to_regprocedure('public.request_daily_log_correction(text, uuid, text)') IS NOT NULL THEN
    RAISE EXCEPTION '094000·096000 을 먼저 되돌리세요(31 → 22 → 21 순서)';
  END IF;
END
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['daily_hygiene_logs', 'daily_temp_humidity_logs', 'daily_sanitation_facility_logs', 'daily_worker_hygiene_logs', 'daily_cold_storage_hygiene_logs', 'daily_process_control_bread_logs', 'daily_material_storage_3f_logs', 'daily_manufacturing_equipment_logs', 'daily_air_conditioning_equipment_logs', 'daily_hoist_inspection_logs', 'daily_illumination_logs', 'daily_material_receiving_inspection_logs', 'daily_raw_thawing_logs']::text[] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_daily_log_approval_times ON public.%I', t);
  END LOOP;
END
$$;

DROP FUNCTION IF EXISTS public.enforce_daily_log_approval_times();
DROP FUNCTION IF EXISTS public.daily_log_correction_allows(TEXT, UUID);

COMMIT;

NOTIFY pgrst, 'reload schema';
