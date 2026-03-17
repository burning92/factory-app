-- ============================================================
-- v1 확정: 숫자형 회사코드(100,200), role은 admin(전체권한) / manager / worker
-- ============================================================

-- 조직 코드: 문자형 → 숫자형 (내부는 organization_id, 입력/표시는 organization_code)
UPDATE public.organizations SET organization_code = '100' WHERE organization_code = 'armored';

INSERT INTO public.organizations (organization_code, name)
VALUES ('200', '하랑')
ON CONFLICT (organization_code) DO NOTHING;

-- master 조직은 시스템 관리용으로 유지 (admin 계정 소속)
-- organization_code = 'master' 그대로 둠

-- role: master → admin (v1에서 전체 권한은 admin 1명)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('worker', 'manager', 'admin'));

UPDATE public.profiles SET role = 'admin' WHERE role = 'master';

-- RLS: 기존 master 정책 제거 후 admin 정책으로 재생성
DROP POLICY IF EXISTS "profiles_select_master" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_master" ON public.profiles;
DROP POLICY IF EXISTS "organizations_all_master" ON public.organizations;
DROP POLICY IF EXISTS "organization_ui_settings_all_master" ON public.organization_ui_settings;

CREATE POLICY "profiles_select_admin"
  ON public.profiles FOR SELECT
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (true);

CREATE POLICY "organizations_all_admin"
  ON public.organizations FOR ALL
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (true);

CREATE POLICY "organization_ui_settings_all_admin"
  ON public.organization_ui_settings FOR ALL
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (true);

COMMENT ON COLUMN public.organizations.organization_code IS '사람 입력/표시용 코드. 숫자형(100,200) 또는 시스템(master).';

NOTIFY pgrst, 'reload schema';
