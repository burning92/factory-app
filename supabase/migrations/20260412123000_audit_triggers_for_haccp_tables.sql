-- HACCP/FSSC22000 핵심 입력 테이블 감사로그 자동 적재 트리거
-- 대상: 데일리 전 일지 + 원부자재/생산(원료사용량, 반죽사용량, 출고입력 기반 production_logs)

CREATE OR REPLACE FUNCTION public.audit_pick_target_label(row_data JSONB)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  out_label TEXT;
BEGIN
  out_label := COALESCE(
    NULLIF(row_data->>'inspection_date', ''),
    NULLIF(row_data->>'received_at', ''),
    NULLIF(row_data->>'thawing_date', ''),
    NULLIF(row_data->>'production_date', ''),
    NULLIF(row_data->>'usage_date', ''),
    NULLIF(row_data->>'record_date', ''),
    NULLIF(row_data->>'issue_summary', ''),
    NULLIF(row_data->>'material_name', ''),
    NULLIF(row_data->>'item_name', ''),
    NULLIF(row_data->>'id', '')
  );
  RETURN out_label;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_log_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  actor_org_id UUID;
  actor_login_id TEXT;
  actor_display_name TEXT;
  actor_role TEXT;
  before_row JSONB;
  after_row JSONB;
  action_name TEXT;
  target_id_text TEXT;
  target_label_text TEXT;
BEGIN
  IF TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME IN ('access_logs', 'audit_logs') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  actor_id := auth.uid();
  IF actor_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT p.organization_id, p.login_id, p.display_name, p.role
    INTO actor_org_id, actor_login_id, actor_display_name, actor_role
  FROM public.profiles p
  WHERE p.id = actor_id
  LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    before_row := NULL;
    after_row := to_jsonb(NEW);
    action_name := 'create';
  ELSIF TG_OP = 'UPDATE' THEN
    before_row := to_jsonb(OLD);
    after_row := to_jsonb(NEW);
    action_name := 'update';
  ELSE
    before_row := to_jsonb(OLD);
    after_row := NULL;
    action_name := 'delete';
  END IF;

  target_id_text := COALESCE(after_row->>'id', before_row->>'id');
  target_label_text := COALESCE(
    public.audit_pick_target_label(after_row),
    public.audit_pick_target_label(before_row)
  );

  INSERT INTO public.audit_logs (
    actor_user_id,
    organization_id,
    actor_login_id,
    actor_display_name,
    actor_role,
    action,
    target_table,
    target_id,
    target_label,
    before_data,
    after_data,
    meta
  ) VALUES (
    actor_id,
    actor_org_id,
    actor_login_id,
    actor_display_name,
    actor_role,
    action_name,
    TG_TABLE_NAME,
    target_id_text,
    target_label_text,
    before_row,
    after_row,
    jsonb_build_object(
      'source', 'db_trigger',
      'schema', TG_TABLE_SCHEMA
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
  target_tables TEXT[] := ARRAY[
    'daily_hygiene_logs',
    'daily_hygiene_log_items',
    'daily_temp_humidity_logs',
    'daily_temp_humidity_log_items',
    'daily_sanitation_facility_logs',
    'daily_sanitation_facility_log_items',
    'daily_worker_hygiene_logs',
    'daily_worker_hygiene_log_items',
    'daily_cold_storage_hygiene_logs',
    'daily_cold_storage_hygiene_log_items',
    'daily_process_control_bread_logs',
    'daily_process_control_bread_log_items',
    'daily_illumination_logs',
    'daily_illumination_log_items',
    'daily_material_storage_3f_logs',
    'daily_material_storage_3f_log_items',
    'daily_manufacturing_equipment_logs',
    'daily_manufacturing_equipment_log_items',
    'daily_air_conditioning_equipment_logs',
    'daily_air_conditioning_equipment_log_items',
    'daily_hoist_inspection_logs',
    'daily_hoist_inspection_log_items',
    'daily_material_receiving_inspection_logs',
    'daily_material_receiving_inspection_log_items',
    'daily_raw_thawing_logs',
    'production_logs',
    'usage_calculations',
    'dough_logs'
  ];
BEGIN
  FOREACH t IN ARRAY target_tables LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row_change ON public.%I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_audit_row_change
           AFTER INSERT OR UPDATE OR DELETE ON public.%I
           FOR EACH ROW
           EXECUTE FUNCTION public.audit_log_row_change()',
        t
      );
    END IF;
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
