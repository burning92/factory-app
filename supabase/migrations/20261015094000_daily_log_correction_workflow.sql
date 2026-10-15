-- HACCP 전자일지 승인 후 정정 절차 (20261015091000 선행 필요)
-- 1) 승인된 일지의 점검 항목(*_log_items) 추가·수정·삭제 차단
-- 2) request_daily_log_correction(): 관리자급이 사유를 남기고 승인을 취소해 재검토(반려 상태)로 되돌림
--    - 정정 전 머리글·항목 전체, 요청자, 서버 시각, 사유를 data_corrections(추가 전용)에 보존
--    - 이후 수정·재제출·재승인은 감사로그와 서버 시각으로 기록

ALTER TABLE public.data_corrections
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'direct_sql',
  ADD COLUMN IF NOT EXISTS requested_by UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'data_corrections_kind_check'
      AND conrelid = 'public.data_corrections'::regclass
  ) THEN
    ALTER TABLE public.data_corrections
      ADD CONSTRAINT data_corrections_kind_check CHECK (kind IN ('direct_sql', 'reopen'));
  END IF;
END
$$;

COMMENT ON COLUMN public.data_corrections.kind IS
  'direct_sql: SQL 직접 정정 요청서 | reopen: 앱에서 승인 취소 후 재검토(request_daily_log_correction)';
COMMENT ON COLUMN public.data_corrections.requested_by IS '요청자 profiles.id (앱 요청일 때)';

CREATE INDEX IF NOT EXISTS idx_data_corrections_target
  ON public.data_corrections USING gin (target_ids);

-- ---------------------------------------------------------------------------
-- 승인된 일지의 점검 항목 잠금
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_daily_log_item_parent_unlocked()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parent_table TEXT := regexp_replace(TG_TABLE_NAME, '_log_items$', '_logs');
  v_parents UUID[] := ARRAY[]::UUID[];
  v_parent UUID;
  v_status TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_parents := v_parents || OLD.log_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_parents := v_parents || NEW.log_id;
  END IF;

  FOREACH v_parent IN ARRAY v_parents LOOP
    CONTINUE WHEN v_parent IS NULL;
    EXECUTE format('SELECT status FROM public.%I WHERE id = $1', v_parent_table)
      INTO v_status
      USING v_parent;
    IF v_status = 'approved' AND NOT public.daily_log_correction_allows(v_parent_table, v_parent) THEN
      RAISE EXCEPTION '승인된 일지의 점검 항목은 수정할 수 없습니다. 정정 요청 후 재검토 절차로 수정하세요';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
  item_tables TEXT[] := ARRAY[
    'daily_hygiene_log_items',
    'daily_temp_humidity_log_items',
    'daily_sanitation_facility_log_items',
    'daily_worker_hygiene_log_items',
    'daily_cold_storage_hygiene_log_items',
    'daily_process_control_bread_log_items',
    'daily_material_storage_3f_log_items',
    'daily_manufacturing_equipment_log_items',
    'daily_air_conditioning_equipment_log_items',
    'daily_hoist_inspection_log_items',
    'daily_illumination_log_items',
    'daily_material_receiving_inspection_log_items'
  ];
BEGIN
  FOREACH t IN ARRAY item_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'public.% 테이블이 없습니다', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = t AND c.column_name = 'log_id'
    ) THEN
      RAISE EXCEPTION 'public.% 에 log_id 컬럼이 없습니다', t;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS trg_daily_log_item_parent_unlocked ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_daily_log_item_parent_unlocked
         BEFORE INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW
         EXECUTE FUNCTION public.enforce_daily_log_item_parent_unlocked()',
      t
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 정정 요청: 승인 취소 → 반려(재검토) 상태
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_daily_log_correction(
  p_table TEXT,
  p_log_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_name TEXT;
  v_header JSONB;
  v_items JSONB;
  v_items_table TEXT := regexp_replace(p_table, '_logs$', '_log_items');
  v_id UUID;
  v_my_org TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '로그인한 사용자만 정정 요청을 할 수 있습니다';
  END IF;
  IF NOT COALESCE(public.is_admin_like(), false) THEN
    RAISE EXCEPTION '정정 요청(승인 취소 후 재검토)은 관리자급 사용자만 할 수 있습니다';
  END IF;
  IF p_table NOT IN (
    'daily_hygiene_logs',
    'daily_temp_humidity_logs',
    'daily_sanitation_facility_logs',
    'daily_worker_hygiene_logs',
    'daily_cold_storage_hygiene_logs',
    'daily_process_control_bread_logs',
    'daily_material_storage_3f_logs',
    'daily_manufacturing_equipment_logs',
    'daily_air_conditioning_equipment_logs',
    'daily_hoist_inspection_logs',
    'daily_illumination_logs',
    'daily_material_receiving_inspection_logs',
    'daily_raw_thawing_logs'
  ) THEN
    RAISE EXCEPTION '정정 요청 대상 일지가 아닙니다: %', p_table;
  END IF;
  IF char_length(v_reason) < 5 THEN
    RAISE EXCEPTION '정정 사유를 5자 이상 입력하세요';
  END IF;

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1 FOR UPDATE', p_table)
    INTO v_header
    USING p_log_id;
  IF v_header IS NULL THEN
    RAISE EXCEPTION '일지를 찾을 수 없습니다';
  END IF;
  v_my_org := public.get_my_organization_code();
  IF NOT (
    v_header->>'organization_code' = v_my_org
    OR (v_my_org IS DISTINCT FROM '200' AND v_header->>'organization_code' IN ('100', '200'))
  ) THEN
    RAISE EXCEPTION '다른 회사의 일지는 정정 요청할 수 없습니다';
  END IF;
  IF v_header->>'status' IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION '승인 완료된 일지만 정정 요청할 수 있습니다. 현재 상태: %', v_header->>'status';
  END IF;

  IF to_regclass('public.' || v_items_table) IS NOT NULL THEN
    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id), ''[]''::jsonb) FROM public.%I i WHERE i.log_id = $1',
      v_items_table
    )
      INTO v_items
      USING p_log_id;
  ELSE
    v_items_table := NULL;
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), p.login_id)
    INTO v_name
  FROM public.profiles p
  WHERE p.id = v_uid;

  INSERT INTO public.data_corrections (
    kind,
    target_table,
    target_ids,
    target_columns,
    reason,
    before_snapshot,
    planned_sql,
    requested_by,
    requested_by_name,
    approved_by_name,
    approved_at
  ) VALUES (
    'reopen',
    p_table,
    ARRAY[p_log_id],
    ARRAY['status', 'approved_at', 'approved_by', 'approved_by_name', 'rejected_at', 'rejected_by', 'reject_reason'],
    v_reason,
    jsonb_build_object('header', v_header, 'items', v_items, 'items_table', v_items_table),
    'request_daily_log_correction: approved → rejected (승인 취소 후 재작성·재제출·재승인)',
    v_uid,
    COALESCE(v_name, v_uid::text),
    COALESCE(v_name, v_uid::text),
    now()
  )
  RETURNING id INTO v_id;

  PERFORM set_config('app.correction_id', v_id::text, true);
  EXECUTE format(
    'UPDATE public.%I
        SET status = ''rejected'',
            approved_at = NULL,
            approved_by = NULL,
            approved_by_name = NULL,
            rejected_at = now(),
            rejected_by = $2,
            reject_reason = $3,
            updated_at = now()
      WHERE id = $1',
    p_table
  )
    USING p_log_id, v_uid, '[정정 요청] ' || v_reason;
  PERFORM set_config('app.correction_id', '', true);

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.request_daily_log_correction(TEXT, UUID, TEXT) IS
  '승인된 HACCP 일지를 정정 사유와 함께 재검토(반려) 상태로 되돌린다. 정정 전 전체 기록은 data_corrections 에 보존.';

REVOKE EXECUTE ON FUNCTION public.request_daily_log_correction(TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_daily_log_correction(TEXT, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
