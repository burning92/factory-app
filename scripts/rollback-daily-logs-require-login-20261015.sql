-- 20261015095000_daily_logs_require_login.sql 되돌리기
-- 전자일지 13종 헤더·항목 정책을 적용 전 상태(역할 지정 없는 USING (true) 4종 + anon 전체 권한)로 복원한다.
-- 데이터·감사로그는 건드리지 않는다. 복원하면 공개 anon 키로 다시 조회·변경·삭제가 가능해지므로
-- 장애 대응 등 불가피한 경우에만, 한 트랜잭션으로 실행한다.

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
  tables TEXT[] := ARRAY[]::TEXT[];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY headers LOOP
    tables := tables || t;
    IF t <> 'daily_raw_thawing_logs' THEN
      tables := tables || replace(t, '_logs', '_log_items');
    END IF;
  END LOOP;

  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_org_access', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (true)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (true)', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (true) WITH CHECK (true)', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (true)', t || '_delete', t);
    EXECUTE format('GRANT ALL ON public.%I TO anon', t);
  END LOOP;
END
$$;

DROP FUNCTION IF EXISTS public.daily_log_org_codes();

COMMIT;

NOTIFY pgrst, 'reload schema';
