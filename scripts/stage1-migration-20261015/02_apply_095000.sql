-- 02. 095000 적용: 전자일지 13종 로그인 필수 + 회사 범위 제한
-- 093000 검증과 지문 비교가 끝난 뒤 실행합니다. 한 트랜잭션으로 실행하며 오류 시 아무것도 바뀌지 않습니다.
-- 예상 밖 정책이 있으면 스스로 중단합니다. 잠금을 5초 넘게 기다리면 취소되니 잠시 뒤 다시 실행하세요.
-- 데이터(일지·항목·감사로그 행)는 바꾸지 않고 정책·권한·함수만 바꿉니다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ===== supabase/migrations/20261015095000_daily_logs_require_login.sql =====
-- HACCP 전자일지 13종 헤더·항목: 로그인한 활성 사용자가 접근 가능한 회사 기록만 허용
-- 기존 정책은 역할 지정 없는 USING (true) 여서 공개 anon 키만으로 조회·변경·삭제가 가능했다.
-- 접근 가능한 organization_code 는 AuthContext 의 보기 조직 규칙과 같다.
--   - 본인 소속 회사 코드
--   - manager·headquarters·admin·quality_manager 이고 소속이 하랑(200)이 아니면 100·200 추가
-- service_role(서버, HACCP 엑셀 내보내기)은 BYPASSRLS 라 영향 없음. anon 키 자체는 그대로 둔다.
-- 되돌리기: scripts/rollback-daily-logs-require-login-20261015.sql

CREATE OR REPLACE FUNCTION public.daily_log_org_codes()
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN p.role IN ('admin', 'quality_manager', 'manager', 'headquarters') AND o.organization_code <> '200'
        THEN ARRAY(SELECT DISTINCT c FROM unnest(ARRAY[o.organization_code, '100', '200']) AS c)
      ELSE ARRAY[o.organization_code]
    END
    FROM public.profiles p
    JOIN public.organizations o ON o.id = p.organization_id
    WHERE p.id = auth.uid() AND p.is_active
    LIMIT 1
  ), ARRAY[]::TEXT[]);
$$;

COMMENT ON FUNCTION public.daily_log_org_codes() IS
  '로그인 사용자가 조회·작성할 수 있는 전자일지 organization_code 목록. 비로그인·비활성은 빈 배열.';

REVOKE EXECUTE ON FUNCTION public.daily_log_org_codes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_log_org_codes() TO authenticated, service_role;

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
  unexpected TEXT;
BEGIN
  -- 되돌리기 스크립트가 원래 상태를 정확히 복원할 수 있도록, 예상한 기존 정책 외의 것이 있으면 중단
  SELECT string_agg(tablename || '.' || policyname, ', ')
    INTO unexpected
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (SELECT unnest(headers) UNION SELECT replace(unnest(headers), '_logs', '_log_items'))
    AND policyname NOT IN (
      tablename || '_select', tablename || '_insert', tablename || '_update', tablename || '_delete',
      tablename || '_org_access'
    );
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION '예상하지 못한 기존 정책이 있어 중단합니다: %', unexpected;
  END IF;

  FOREACH h IN ARRAY headers LOOP
    IF to_regclass('public.' || h) IS NULL THEN
      RAISE EXCEPTION 'public.% 테이블이 없습니다', h;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', h);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', h || '_select', h);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', h || '_insert', h);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', h || '_update', h);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', h || '_delete', h);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', h || '_org_access', h);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (organization_code = ANY ((SELECT public.daily_log_org_codes())::text[]))
         WITH CHECK (organization_code = ANY ((SELECT public.daily_log_org_codes())::text[]))',
      h || '_org_access', h
    );
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', h);

    IF h = 'daily_raw_thawing_logs' THEN
      CONTINUE;
    END IF;
    t := replace(h, '_logs', '_log_items');
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'public.% 테이블이 없습니다', t;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_org_access', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (EXISTS (SELECT 1 FROM public.%I h
                        WHERE h.id = log_id
                          AND h.organization_code = ANY ((SELECT public.daily_log_org_codes())::text[])))
         WITH CHECK (EXISTS (SELECT 1 FROM public.%I h
                             WHERE h.id = log_id
                               AND h.organization_code = ANY ((SELECT public.daily_log_org_codes())::text[])))',
      t || '_org_access', t, h, h
    );
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
-- ==========================================================================

COMMIT;
