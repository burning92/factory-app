-- access_logs / audit_logs: 7일 초과 데이터 삭제
-- 보관: created_at 기준 7일 이내만 유지. 삭제 작업은 매일 1회 실행(실질적 7일 보관).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

CREATE OR REPLACE FUNCTION public.purge_old_access_and_audit_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.access_logs
  WHERE created_at < (now() - interval '7 days');

  DELETE FROM public.audit_logs
  WHERE created_at < (now() - interval '7 days');
END;
$$;

COMMENT ON FUNCTION public.purge_old_access_and_audit_logs() IS
  '7일보다 오래된 access_logs, audit_logs 행 삭제. pg_cron에서 호출.';

REVOKE ALL ON FUNCTION public.purge_old_access_and_audit_logs() FROM PUBLIC;

DO $$
DECLARE
  j RECORD;
BEGIN
  FOR j IN (SELECT jobid FROM cron.job WHERE jobname = 'purge_access_audit_logs_7d') LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END
$$;

SELECT cron.schedule(
  'purge_access_audit_logs_7d',
  '15 3 * * *',
  $$ SELECT public.purge_old_access_and_audit_logs(); $$
);

NOTIFY pgrst, 'reload schema';
