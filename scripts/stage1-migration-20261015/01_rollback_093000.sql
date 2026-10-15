-- 01-되돌리기. 093000 이전 권한으로 복원 (데이터·감사로그 행은 건드리지 않음)
-- 093000 적용 후 앱에서 감사로그 관련 오류가 날 때만 실행합니다.
-- 아래 GRANT 대상은 00 사전 점검 13~16행(적용 전 기록)과 같아야 합니다. 다르면 실행 전에 알려 주세요.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

GRANT EXECUTE ON FUNCTION public.purge_old_access_and_audit_logs() TO anon, authenticated;
-- 사전 점검 14행 ACL 에 '=X/' (PUBLIC 실행 권한)가 있었을 때만 아래 줄의 주석을 풀고 실행합니다.
-- GRANT EXECUTE ON FUNCTION public.purge_old_access_and_audit_logs() TO PUBLIC;
GRANT INSERT ON public.audit_logs TO anon, authenticated;
DROP POLICY IF EXISTS "audit_logs_insert_own" ON public.audit_logs;
CREATE POLICY "audit_logs_insert_own"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = actor_user_id);

COMMIT;

NOTIFY pgrst, 'reload schema';
