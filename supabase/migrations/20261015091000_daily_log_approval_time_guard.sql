-- HACCP 전자일지 13종 헤더: 작성 ≤ 제출 ≤ 승인 시각과 상태 전이 강제
-- - 제출·승인·반려 시각은 클라이언트 값 대신 서버 now() 로 기록
-- - 승인·반려는 관리자급(is_admin_like)만. service_role·SQL 직접 실행은 감사로그로 구분
-- - 승인 완료 후 내용·상태·제출/승인 정보 변경 및 삭제 금지 → 정정 요청(request_daily_log_correction) 후 재검토
-- - created_at 변경 금지
-- - 기존 행은 다시 검사하지 않음. 이후 INSERT / UPDATE / DELETE 만 검사
-- - 운영 데이터 정정은 data_corrections 요청서 + SET LOCAL app.correction_id 로만 우회
--   (20261015090000_audit_trail_system_actor_append_only.sql 선행 필요)

CREATE OR REPLACE FUNCTION public.daily_log_correction_allows(p_table TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_correction UUID;
BEGIN
  BEGIN
    v_correction := NULLIF(current_setting('app.correction_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'app.correction_id 형식이 올바르지 않습니다';
  END;

  IF v_correction IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.data_corrections c
    WHERE c.id = v_correction
      AND c.target_table = p_table
      AND p_id = ANY (c.target_ids)
      AND c.created_at = now()
  ) THEN
    RAISE EXCEPTION '정정 요청서 %에 %.% 이(가) 없거나, 같은 트랜잭션에서 등록한 요청서가 아닙니다', v_correction, p_table, p_id;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.daily_log_correction_allows(TEXT, UUID) IS
  'app.correction_id 가 같은 트랜잭션에서 등록한 data_corrections 요청서를 가리키고 대상 행이 범위에 있으면 true. 요청서 재사용 불가.';

CREATE OR REPLACE FUNCTION public.enforce_daily_log_approval_times()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_name TEXT;
BEGIN
  IF public.daily_log_correction_allows(TG_TABLE_NAME, CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'approved' THEN
      RAISE EXCEPTION '승인된 일지는 삭제할 수 없습니다';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();

    IF NEW.status IS NULL OR NEW.status NOT IN ('draft', 'submitted') THEN
      RAISE EXCEPTION '새 일지는 작성 중(draft) 또는 제출(submitted) 상태로만 만들 수 있습니다. 요청 상태: %', NEW.status;
    END IF;

    IF NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL OR NEW.approved_by_name IS NOT NULL THEN
      RAISE EXCEPTION '새 일지에 승인 정보를 함께 저장할 수 없습니다';
    END IF;

    IF NEW.status = 'submitted' THEN
      NEW.submitted_at := now();
    ELSE
      NEW.submitted_at := NULL;
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'created_at 은 변경할 수 없습니다';
  END IF;

  IF OLD.status = 'approved' THEN
    IF NEW.status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION '승인된 일지의 상태는 바꿀 수 없습니다. 정정 요청 후 재검토 절차를 이용하세요';
    END IF;
    IF NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_by_name IS DISTINCT FROM OLD.approved_by_name
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
      RAISE EXCEPTION '승인된 일지의 제출·승인 정보는 바꿀 수 없습니다';
    END IF;
    IF (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
      RAISE EXCEPTION '승인된 일지는 수정할 수 없습니다. 정정 요청 후 재검토 절차로 수정하세요';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('approved', 'rejected')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND v_uid IS NOT NULL
     AND NOT COALESCE(public.is_admin_like(), false) THEN
    RAISE EXCEPTION '승인·반려는 관리자급 사용자만 할 수 있습니다';
  END IF;

  IF NEW.status = 'submitted' THEN
    IF OLD.status IS DISTINCT FROM 'submitted' THEN
      NEW.submitted_at := now();
      NEW.approved_at := NULL;
      NEW.approved_by := NULL;
      NEW.approved_by_name := NULL;
    ELSE
      IF NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
        NEW.submitted_at := now();
      END IF;
      IF NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL THEN
        RAISE EXCEPTION '제출 상태 일지에 승인 정보를 저장할 수 없습니다. 승인은 상태를 approved 로 바꿔야 합니다';
      END IF;
    END IF;

  ELSIF NEW.status = 'approved' THEN
    IF OLD.status IS DISTINCT FROM 'submitted' THEN
      RAISE EXCEPTION '제출된 일지만 승인할 수 있습니다. 현재 상태: %', OLD.status;
    END IF;
    IF OLD.submitted_at IS NULL THEN
      RAISE EXCEPTION '제출시각이 없는 일지는 승인할 수 없습니다';
    END IF;
    NEW.submitted_at := OLD.submitted_at;
    NEW.approved_at := now();
    NEW.approved_by := COALESCE(v_uid, NEW.approved_by);
    IF NEW.approved_by IS NULL THEN
      RAISE EXCEPTION '승인자 계정을 확인할 수 없습니다';
    END IF;
    IF v_uid IS NOT NULL THEN
      SELECT COALESCE(NULLIF(btrim(p.display_name), ''), p.login_id)
        INTO v_name
      FROM public.profiles p
      WHERE p.id = v_uid;
      NEW.approved_by_name := COALESCE(v_name, NEW.approved_by_name);
    END IF;
    IF NEW.approved_at < NEW.submitted_at THEN
      RAISE EXCEPTION '승인시각(%)이 제출시각(%)보다 이릅니다', NEW.approved_at, NEW.submitted_at;
    END IF;

  ELSIF NEW.status IN ('draft', 'rejected') THEN
    IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
      IF OLD.status IS DISTINCT FROM 'submitted' THEN
        RAISE EXCEPTION '제출된 일지만 반려할 수 있습니다. 현재 상태: %', OLD.status;
      END IF;
      NEW.rejected_at := now();
      NEW.rejected_by := COALESCE(v_uid, NEW.rejected_by);
    END IF;
    IF NEW.approved_at IS NOT NULL OR NEW.approved_by IS NOT NULL OR NEW.approved_by_name IS NOT NULL THEN
      RAISE EXCEPTION '작성 중·반려 상태 일지에 승인 정보를 저장할 수 없습니다';
    END IF;

  ELSE
    RAISE EXCEPTION '알 수 없는 상태입니다: %', NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_daily_log_approval_times() IS
  'HACCP 전자일지 헤더의 작성 ≤ 제출 ≤ 승인 시각, 상태 전이, 승인 후 잠금을 강제한다. 제출·승인·반려 시각은 서버 now().';

DO $$
DECLARE
  t TEXT;
  missing TEXT[];
  required TEXT[] := ARRAY[
    'id', 'status', 'created_at', 'submitted_at',
    'approved_at', 'approved_by', 'approved_by_name',
    'rejected_at', 'rejected_by'
  ];
  target_tables TEXT[] := ARRAY[
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
  ];
BEGIN
  IF to_regclass('public.data_corrections') IS NULL THEN
    RAISE EXCEPTION 'public.data_corrections 가 없습니다. 20261015090000 마이그레이션을 먼저 적용하세요';
  END IF;

  FOREACH t IN ARRAY target_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'public.% 테이블이 없습니다', t;
    END IF;

    SELECT array_agg(col)
      INTO missing
    FROM unnest(required) AS col
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = t
        AND c.column_name = col
    );

    IF missing IS NOT NULL THEN
      RAISE EXCEPTION 'public.% 에 필요한 컬럼이 없습니다: %', t, missing;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS trg_daily_log_approval_times ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_daily_log_approval_times
         BEFORE INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW
         EXECUTE FUNCTION public.enforce_daily_log_approval_times()',
      t
    );
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
