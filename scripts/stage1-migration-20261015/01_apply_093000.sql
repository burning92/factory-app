-- 01. 093000 적용: 감사로그 접근 권한 보완
-- 한 트랜잭션으로 실행합니다. 중간에 오류가 나면 아무것도 바뀌지 않습니다.
-- 잠금을 5초 넘게 기다리면 스스로 취소됩니다(현장 화면이 멈추지 않도록). 그 경우 잠시 뒤 다시 실행하세요.
-- 데이터(일지·감사로그 행)는 바꾸지 않고 권한·정책만 바꿉니다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 090000 이 없으면 감사 트리거가 로그인 사용자 INSERT 권한에 의존할 수 있으므로 중단
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.audit_log_row_change()') AND prosecdef AND prosrc LIKE '%direct_sql%')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.audit_logs'::regclass AND tgname = 'trg_audit_logs_append_only') THEN
    RAISE EXCEPTION '20261015090000 이 적용되지 않았습니다. 093000 을 적용하지 않고 중단합니다';
  END IF;
END
$$;

-- ===== supabase/migrations/20261015093000_audit_logs_access_hardening.sql =====
-- 감사로그 접근 권한 보완 (20261015090000 후속)
-- 1) 로그 삭제 함수는 pg_cron(소유자)만 실행. Supabase 기본 권한으로 anon / authenticated 에 부여된 EXECUTE 회수
-- 2) 감사로그 INSERT 는 트리거(SECURITY DEFINER)와 서버(service_role)만. 로그인 사용자의 직접 INSERT 차단

REVOKE EXECUTE ON FUNCTION public.purge_old_access_and_audit_logs() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "audit_logs_insert_own" ON public.audit_logs;
REVOKE INSERT ON public.audit_logs FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
-- ==========================================================================

COMMIT;
