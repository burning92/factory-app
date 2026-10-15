-- HACCP 전자일지 13종: 작성자·상태별 수정·제출·삭제 권한 (로그인 앱 사용자 대상)
-- 선행: 20261015091000(승인시각·승인 후 잠금), 20261015094000(항목 잠금·정정 요청)
-- 회사 범위는 20261015095000 RLS, 승인·반려 권한과 승인 후 잠금은 091000 이 그대로 담당한다.
-- 여기서는 "누가" 고칠 수 있는지만 더한다. 위반 시 조용히 0건 처리하지 않고 오류를 낸다.
--
--   상태        내용·항목 수정            제출/재제출   제출 회수(→draft)   삭제
--   draft       작성자, 관리자급          작성자, 관리자급  -                제출 이력 없을 때 작성자, 관리자급
--   submitted   불가(회수·반려 후 수정)   작성자, 관리자급  작성자, 관리자급   불가
--   rejected    작성자, 관리자급          작성자, 관리자급  -                불가
--   approved    불가(정정 요청, 094000)   불가             불가               불가(091000)
--
-- 작성자 = author_user_id, 없으면 submitted_by. 관리자급 = is_admin_like() (admin, quality_manager)
-- service_role·SQL 직접 실행(auth.uid() 없음)은 대상 아님. 승인 후 잠금(091000)과 감사로그로 통제한다.
-- 기존 행은 다시 검사하지 않는다. 되돌리기: scripts/rollback-daily-log-edit-permissions-20261015.sql

-- 조도 일지에는 작성자 컬럼이 없었다. 기존 6건은 NULL 로 두고(작성자 판단은 submitted_by), 이후 작성분부터 채운다.
ALTER TABLE public.daily_illumination_logs
  ADD COLUMN IF NOT EXISTS author_user_id UUID;

COMMENT ON COLUMN public.daily_illumination_logs.author_user_id IS
  '작성자 profiles.id. 20261015096000 이후 작성분부터 트리거가 로그인 사용자로 채운다.';

CREATE OR REPLACE FUNCTION public.daily_log_workflow_columns()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'status', 'submitted_at', 'submitted_by',
    'approved_at', 'approved_by', 'approved_by_name',
    'rejected_at', 'rejected_by', 'reject_reason', 'updated_at'
  ];
$$;

CREATE OR REPLACE FUNCTION public.enforce_daily_log_edit_rights()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_admin BOOLEAN;
  v_owner UUID;
  v_is_owner BOOLEAN;
  v_content_changed BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF public.daily_log_correction_allows(TG_TABLE_NAME, CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_admin := COALESCE(public.is_admin_like(), false);

  IF TG_OP = 'INSERT' THEN
    IF NEW.author_user_id IS NULL THEN
      NEW.author_user_id := v_uid;
    ELSIF NEW.author_user_id <> v_uid AND NOT v_admin THEN
      RAISE EXCEPTION '다른 사람 명의로 일지를 작성할 수 없습니다';
    END IF;
    RETURN NEW;
  END IF;

  v_owner := COALESCE(OLD.author_user_id, OLD.submitted_by);
  v_is_owner := v_owner IS NOT DISTINCT FROM v_uid;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'approved' THEN
      RETURN OLD;  -- 091000 이 오류를 낸다
    END IF;
    IF OLD.status <> 'draft' OR OLD.submitted_at IS NOT NULL THEN
      RAISE EXCEPTION '제출 이력이 있는 일지는 삭제할 수 없습니다. 반려·정정 절차로 기록을 남기세요';
    END IF;
    IF NOT (v_is_owner OR v_admin) THEN
      RAISE EXCEPTION '다른 사람이 작성한 일지는 삭제할 수 없습니다';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.status = 'approved' THEN
    RETURN NEW;  -- 승인 후 잠금은 091000
  END IF;

  IF NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
     AND NOT (OLD.author_user_id IS NULL AND NEW.author_user_id = v_uid AND v_is_owner) THEN
    RAISE EXCEPTION '일지 작성자는 바꿀 수 없습니다';
  END IF;

  -- 승인·반려 권한은 091000 이 검사한다(관리자급만, 제출 상태에서만)
  IF NEW.status IN ('approved', 'rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_content_changed :=
    (to_jsonb(NEW) - public.daily_log_workflow_columns()) IS DISTINCT FROM
    (to_jsonb(OLD) - public.daily_log_workflow_columns());

  IF OLD.status = 'submitted' AND v_content_changed THEN
    RAISE EXCEPTION '제출된 일지는 수정할 수 없습니다. 작성자가 제출을 회수하거나 관리자가 반려한 뒤 수정하세요';
  END IF;

  IF NOT (v_is_owner OR v_admin) THEN
    IF OLD.status = 'submitted' AND NEW.status = 'submitted' AND NOT v_content_changed
       AND NEW.submitted_at IS NOT DISTINCT FROM OLD.submitted_at
       AND NEW.submitted_by IS NOT DISTINCT FROM OLD.submitted_by THEN
      RETURN NEW;  -- updated_at 만 바뀌는 요청
    END IF;
    RAISE EXCEPTION '다른 사람이 작성한 일지는 수정·제출할 수 없습니다';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_daily_log_edit_rights() IS
  'HACCP 일지 헤더: 작성자·관리자급만 작성 중/반려 일지 수정·제출, 제출 후 내용 수정 금지, 제출 이력 있는 일지 삭제 금지.';

CREATE OR REPLACE FUNCTION public.enforce_daily_log_item_edit_rights()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_parent_table TEXT := regexp_replace(TG_TABLE_NAME, '_log_items$', '_logs');
  v_parents UUID[] := ARRAY[]::UUID[];
  v_parent UUID;
  v_status TEXT;
  v_owner UUID;
  v_admin BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_parents := v_parents || OLD.log_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_parents := v_parents || NEW.log_id;
  END IF;
  v_admin := COALESCE(public.is_admin_like(), false);

  FOREACH v_parent IN ARRAY v_parents LOOP
    CONTINUE WHEN v_parent IS NULL;
    EXECUTE format('SELECT status, COALESCE(author_user_id, submitted_by) FROM public.%I WHERE id = $1', v_parent_table)
      INTO v_status, v_owner
      USING v_parent;
    -- 머리글 삭제에 따른 연쇄 삭제는 머리글 단계에서 이미 검사했다
    CONTINUE WHEN v_status IS NULL;
    CONTINUE WHEN v_status = 'approved';  -- 094000 이 검사
    CONTINUE WHEN public.daily_log_correction_allows(v_parent_table, v_parent);
    IF v_status = 'submitted' THEN
      RAISE EXCEPTION '제출된 일지의 점검 항목은 수정할 수 없습니다. 작성자가 제출을 회수하거나 관리자가 반려한 뒤 수정하세요';
    END IF;
    IF NOT (v_owner IS NOT DISTINCT FROM v_uid OR v_admin) THEN
      RAISE EXCEPTION '다른 사람이 작성한 일지의 점검 항목은 수정할 수 없습니다';
    END IF;
  END LOOP;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

COMMENT ON FUNCTION public.enforce_daily_log_item_edit_rights() IS
  'HACCP 일지 항목: 머리글이 작성 중/반려이고 작성자·관리자급일 때만 추가·수정·삭제.';

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
  t TEXT;
BEGIN
  IF to_regprocedure('public.daily_log_correction_allows(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'daily_log_correction_allows 가 없습니다. 20261015091000 을 먼저 적용하세요';
  END IF;
  IF to_regprocedure('public.enforce_daily_log_item_parent_unlocked()') IS NULL THEN
    RAISE EXCEPTION '항목 잠금 트리거 함수가 없습니다. 20261015094000 을 먼저 적용하세요';
  END IF;

  FOREACH h IN ARRAY headers LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = h AND column_name IN ('author_user_id')
    ) OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = h AND column_name IN ('submitted_by')
    ) THEN
      RAISE EXCEPTION 'public.% 에 author_user_id 또는 submitted_by 컬럼이 없습니다', h;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_daily_log_edit_rights ON public.%I', h);
    EXECUTE format(
      'CREATE TRIGGER trg_daily_log_edit_rights
         BEFORE INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.enforce_daily_log_edit_rights()',
      h
    );

    CONTINUE WHEN h = 'daily_raw_thawing_logs';
    t := replace(h, '_logs', '_log_items');
    EXECUTE format('DROP TRIGGER IF EXISTS trg_daily_log_item_edit_rights ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_daily_log_item_edit_rights
         BEFORE INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.enforce_daily_log_item_edit_rights()',
      t
    );
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
