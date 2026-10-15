-- 20261015096000_daily_log_edit_permissions.sql 되돌리기
-- 작성자·상태별 권한 트리거만 제거한다. 승인 후 잠금(091000)·항목 잠금(094000)·회사 범위 RLS(095000)는 그대로 남는다.
-- daily_illumination_logs.author_user_id 컬럼은 지우지 않는다(적용 이후 기록된 작성자 정보를 보존).

BEGIN;

DO $$
DECLARE
  headers TEXT[] := ARRAY[
    'daily_hygiene_logs', 'daily_temp_humidity_logs', 'daily_sanitation_facility_logs',
    'daily_worker_hygiene_logs', 'daily_cold_storage_hygiene_logs', 'daily_process_control_bread_logs',
    'daily_material_storage_3f_logs', 'daily_manufacturing_equipment_logs',
    'daily_air_conditioning_equipment_logs', 'daily_hoist_inspection_logs', 'daily_illumination_logs',
    'daily_material_receiving_inspection_logs', 'daily_raw_thawing_logs'
  ];
  h TEXT;
BEGIN
  FOREACH h IN ARRAY headers LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_daily_log_edit_rights ON public.%I', h);
    CONTINUE WHEN h = 'daily_raw_thawing_logs';
    EXECUTE format('DROP TRIGGER IF EXISTS trg_daily_log_item_edit_rights ON public.%I', replace(h, '_logs', '_log_items'));
  END LOOP;
END
$$;

DROP FUNCTION IF EXISTS public.enforce_daily_log_edit_rights();
DROP FUNCTION IF EXISTS public.enforce_daily_log_item_edit_rights();
DROP FUNCTION IF EXISTS public.daily_log_workflow_columns();

COMMIT;
