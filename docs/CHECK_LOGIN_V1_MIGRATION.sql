-- 운영 Supabase SQL Editor에서 실행: 로그인 v1 마이그레이션 적용 여부 검사
-- 결과: 3개 테이블 존재 + organizations에 000/100/200 있으면 적용된 것으로 판단

SELECT
  (SELECT count(*) FROM information_schema.tables t WHERE t.table_schema = 'public' AND t.table_name = 'organizations') AS has_organizations,
  (SELECT count(*) FROM information_schema.tables t WHERE t.table_schema = 'public' AND t.table_name = 'profiles') AS has_profiles,
  (SELECT count(*) FROM information_schema.tables t WHERE t.table_schema = 'public' AND t.table_name = 'organization_ui_settings') AS has_org_ui_settings,
  (SELECT count(*) FROM public.organizations WHERE organization_code IN ('000','100','200')) AS org_codes_000_100_200;

-- 위 결과가 has_organizations=1, has_profiles=1, has_org_ui_settings=1, org_codes_000_100_200>=2 이면 로그인 v1 적용된 상태로 봐도 됨.
