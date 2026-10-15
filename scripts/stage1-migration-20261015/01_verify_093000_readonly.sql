-- 01-검증. 093000 적용 직후 (조회 전용). 모든 ok 가 true 여야 합니다.
SELECT no, item, actual, expected, actual IS NOT DISTINCT FROM expected AS ok
FROM (VALUES
    (1, '로그 삭제 함수 실행 권한 anon', has_function_privilege('anon', 'public.purge_old_access_and_audit_logs()', 'EXECUTE')::text, 'false'),
    (2, '로그 삭제 함수 실행 권한 authenticated', has_function_privilege('authenticated', 'public.purge_old_access_and_audit_logs()', 'EXECUTE')::text, 'false'),
    (3, '로그 삭제 함수 소유자 실행 가능(예약 작업용)', has_function_privilege((SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = to_regprocedure('public.purge_old_access_and_audit_logs()')), 'public.purge_old_access_and_audit_logs()', 'EXECUTE')::text, 'true'),
    (4, '로그 정리 예약 작업(pg_cron) 활성', (SELECT count(*)::text FROM cron.job WHERE command ILIKE '%purge_old_access_and_audit_logs%' AND active), '1'),
    (5, 'audit_logs INSERT 권한 anon', has_table_privilege('anon', 'public.audit_logs', 'INSERT')::text, 'false'),
    (6, 'audit_logs INSERT 권한 authenticated', has_table_privilege('authenticated', 'public.audit_logs', 'INSERT')::text, 'false'),
    (7, 'audit_logs INSERT 권한 service_role(서버 기록용 유지)', has_table_privilege('service_role', 'public.audit_logs', 'INSERT')::text, 'true'),
    (8, 'audit_logs_insert_own 정책 제거', (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_logs' AND policyname = 'audit_logs_insert_own'), '0'),
    (9, '관리자 감사로그 조회 정책 유지', (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_logs' AND cmd = 'SELECT'), '1'),
    (10, '감사 트리거 함수는 소유자 권한으로 실행(SECURITY DEFINER)', (SELECT prosecdef::text FROM pg_proc WHERE oid = to_regprocedure('public.audit_log_row_change()')), 'true'),
    (11, 'audit_logs 트리거 3종 유지', (SELECT count(*)::text FROM pg_trigger WHERE tgrelid = 'public.audit_logs'::regclass AND tgname IN ('trg_audit_logs_chain_hash','trg_audit_logs_append_only','trg_audit_logs_no_truncate')), '3')
) AS v(no, item, actual, expected)
ORDER BY no;
