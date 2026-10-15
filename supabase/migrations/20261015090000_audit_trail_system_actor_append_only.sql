-- HACCP/FSSC22000 감사 이력 보완
-- 1) 로그인 세션이 없는 변경(service_role, SQL Editor, 일괄 스크립트)도 기록
-- 2) audit_logs / data_corrections 를 추가 전용으로 고정 (UPDATE·DELETE·TRUNCATE 차단)
-- 3) audit_logs 7일 자동 삭제 중단 (access_logs 만 7일 보관 유지)
-- 4) 행 단위 해시 체인으로 중간 삭제·변조 탐지
-- 5) 운영 데이터 정정 요청서 테이블 data_corrections

-- ---------------------------------------------------------------------------
-- audit_logs 컬럼 보완
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ALTER COLUMN actor_user_id DROP NOT NULL;

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_source TEXT,
  ADD COLUMN IF NOT EXISTS db_session_user TEXT,
  ADD COLUMN IF NOT EXISTS db_role_setting TEXT,
  ADD COLUMN IF NOT EXISTS jwt_role TEXT,
  ADD COLUMN IF NOT EXISTS application_name TEXT,
  ADD COLUMN IF NOT EXISTS txid BIGINT,
  ADD COLUMN IF NOT EXISTS correction_id UUID,
  ADD COLUMN IF NOT EXISTS chain_seq BIGINT,
  ADD COLUMN IF NOT EXISTS prev_hash TEXT,
  ADD COLUMN IF NOT EXISTS row_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_logs_chain_seq
  ON public.audit_logs (chain_seq)
  WHERE chain_seq IS NOT NULL;

COMMENT ON COLUMN public.audit_logs.actor_user_id IS
  '로그인 사용자. service_role·SQL Editor 등 로그인 세션이 없는 변경은 NULL이며 actor_source로 구분한다.';
COMMENT ON COLUMN public.audit_logs.actor_source IS
  'app_user | service_role | api_<role> | direct_sql';
COMMENT ON COLUMN public.audit_logs.db_session_user IS 'session_user. PostgREST 경유는 authenticator, SQL Editor는 postgres 등.';
COMMENT ON COLUMN public.audit_logs.db_role_setting IS 'SET ROLE 값(current_setting(''role'')). PostgREST 경유 시 authenticated / service_role.';
COMMENT ON COLUMN public.audit_logs.jwt_role IS '요청 JWT의 role 클레임. 없으면 NULL.';
COMMENT ON COLUMN public.audit_logs.ip_address IS 'inet_client_addr(). 풀러·PostgREST 경유 시 최종 사용자 IP가 아니라 중계 서버 주소일 수 있다.';
COMMENT ON COLUMN public.audit_logs.correction_id IS '변경 당시 app.correction_id 설정값. data_corrections.id';
COMMENT ON COLUMN public.audit_logs.chain_seq IS '해시 체인 순번. 이 마이그레이션 이전 행은 NULL.';
COMMENT ON COLUMN public.audit_logs.row_hash IS 'sha256(직전 row_hash + 이 행 내용). 체인이 끊기면 삭제·변조를 의심한다.';

-- ---------------------------------------------------------------------------
-- 운영 데이터 정정 요청서
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.data_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_table TEXT NOT NULL,
  target_ids UUID[] NOT NULL,
  target_columns TEXT[] NOT NULL,
  reason TEXT NOT NULL,
  before_snapshot JSONB NOT NULL,
  planned_sql TEXT NOT NULL,
  requested_by_name TEXT NOT NULL,
  approved_by_name TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.data_corrections IS
  '운영 데이터 직접 정정 요청서. 정정 SQL 실행 전에 먼저 INSERT하고, 실행 세션에서 SET LOCAL app.correction_id = id 를 설정한다. 추가 전용.';

ALTER TABLE public.data_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "data_corrections_select_admin" ON public.data_corrections;
CREATE POLICY "data_corrections_select_admin"
  ON public.data_corrections FOR SELECT TO authenticated
  USING (public.is_admin_like());

-- ---------------------------------------------------------------------------
-- 감사 트리거 함수: 로그인 세션이 없어도 기록
-- ---------------------------------------------------------------------------
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
  v_jwt_role TEXT;
  v_role_setting TEXT;
  v_source TEXT;
  v_correction UUID;
  before_row JSONB;
  after_row JSONB;
  action_name TEXT;
  target_id_text TEXT;
  target_label_text TEXT;
BEGIN
  IF TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME IN ('access_logs', 'audit_logs', 'data_corrections') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  actor_id := auth.uid();

  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_jwt_role IS NULL THEN
    BEGIN
      v_jwt_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    EXCEPTION WHEN others THEN
      v_jwt_role := NULL;
    END;
  END IF;

  v_role_setting := NULLIF(current_setting('role', true), '');

  BEGIN
    v_correction := NULLIF(current_setting('app.correction_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_correction := NULL;
  END;

  v_source := CASE
    WHEN actor_id IS NOT NULL THEN 'app_user'
    WHEN v_jwt_role = 'service_role' THEN 'service_role'
    WHEN v_jwt_role IS NOT NULL THEN 'api_' || v_jwt_role
    ELSE 'direct_sql'
  END;

  IF actor_id IS NOT NULL THEN
    SELECT p.organization_id, p.login_id, p.display_name, p.role
      INTO actor_org_id, actor_login_id, actor_display_name, actor_role
    FROM public.profiles p
    WHERE p.id = actor_id
    LIMIT 1;
  END IF;

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
    meta,
    ip_address,
    actor_source,
    db_session_user,
    db_role_setting,
    jwt_role,
    application_name,
    txid,
    correction_id
  ) VALUES (
    actor_id,
    actor_org_id,
    actor_login_id,
    actor_display_name,
    COALESCE(actor_role, v_jwt_role, v_role_setting, session_user::text),
    action_name,
    TG_TABLE_NAME,
    target_id_text,
    target_label_text,
    before_row,
    after_row,
    jsonb_build_object(
      'source', 'db_trigger',
      'schema', TG_TABLE_SCHEMA,
      'actor_source', v_source
    ),
    inet_client_addr(),
    v_source,
    session_user::text,
    v_role_setting,
    v_jwt_role,
    NULLIF(current_setting('application_name', true), ''),
    txid_current(),
    v_correction
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 해시 체인
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_logs_chain_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_seq BIGINT;
  v_prev_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.audit_logs.chain'));

  SELECT a.chain_seq, a.row_hash
    INTO v_prev_seq, v_prev_hash
  FROM public.audit_logs a
  WHERE a.chain_seq IS NOT NULL
  ORDER BY a.chain_seq DESC
  LIMIT 1;

  NEW.chain_seq := COALESCE(v_prev_seq, 0) + 1;
  NEW.prev_hash := v_prev_hash;
  NEW.row_hash := encode(
    sha256(convert_to(concat_ws('|',
      NEW.chain_seq::text,
      COALESCE(v_prev_hash, ''),
      NEW.id::text,
      NEW.created_at::text,
      COALESCE(NEW.actor_user_id::text, ''),
      COALESCE(NEW.actor_source, ''),
      COALESCE(NEW.db_session_user, ''),
      NEW.action,
      NEW.target_table,
      COALESCE(NEW.target_id, ''),
      COALESCE(NEW.before_data::text, ''),
      COALESCE(NEW.after_data::text, ''),
      COALESCE(NEW.correction_id::text, '')
    ), 'UTF8')),
    'hex'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_chain_hash ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_chain_hash
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_logs_chain_hash();

-- ---------------------------------------------------------------------------
-- 추가 전용: UPDATE / DELETE / TRUNCATE 차단
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_append_only_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '%.% 는 추가 전용입니다. % 은(는) 허용되지 않습니다.', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.block_append_only_change();

DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_no_truncate
  BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.block_append_only_change();

DROP TRIGGER IF EXISTS trg_data_corrections_append_only ON public.data_corrections;
CREATE TRIGGER trg_data_corrections_append_only
  BEFORE UPDATE OR DELETE ON public.data_corrections
  FOR EACH ROW
  EXECUTE FUNCTION public.block_append_only_change();

DROP TRIGGER IF EXISTS trg_data_corrections_no_truncate ON public.data_corrections;
CREATE TRIGGER trg_data_corrections_no_truncate
  BEFORE TRUNCATE ON public.data_corrections
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.block_append_only_change();

REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.data_corrections FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.data_corrections FROM service_role;

-- ---------------------------------------------------------------------------
-- 보관: audit_logs 자동 삭제 중단, access_logs 는 7일 유지
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_old_access_and_audit_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.access_logs
  WHERE created_at < (now() - interval '7 days');
END;
$$;

COMMENT ON FUNCTION public.purge_old_access_and_audit_logs() IS
  'access_logs 7일 초과분 삭제. audit_logs 는 HACCP 기록 추적용으로 삭제하지 않는다.';

-- ---------------------------------------------------------------------------
-- 감사 트리거 재부착 (기존과 동일 대상)
-- ---------------------------------------------------------------------------
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
    ELSE
      RAISE NOTICE 'audit trigger skipped: public.% not found', t;
    END IF;
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
