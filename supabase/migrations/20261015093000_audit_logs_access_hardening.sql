-- 감사로그 접근 권한 보완 (20261015090000 후속)
-- 1) 로그 삭제 함수는 pg_cron(소유자)만 실행. Supabase 기본 권한으로 anon / authenticated 에 부여된 EXECUTE 회수
-- 2) 감사로그 INSERT 는 트리거(SECURITY DEFINER)와 서버(service_role)만. 로그인 사용자의 직접 INSERT 차단

REVOKE EXECUTE ON FUNCTION public.purge_old_access_and_audit_logs() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "audit_logs_insert_own" ON public.audit_logs;
REVOKE INSERT ON public.audit_logs FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
