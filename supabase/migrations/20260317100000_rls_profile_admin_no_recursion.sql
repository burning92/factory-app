-- ============================================================
-- RLS: admin 정책에서 profiles 재조회 제거 (재귀 방지)
-- get_my_profile_role() SECURITY DEFINER로 본인 role만 조회 후 정책에서 사용
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_profile_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_my_profile_role() IS 'RLS 정책용: 현재 사용자 role 반환. SECURITY DEFINER로 profiles 재귀 조회 방지.';

GRANT EXECUTE ON FUNCTION public.get_my_profile_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_profile_role() TO anon;

-- profiles: 재귀 정책 제거 후 함수 사용
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;

CREATE POLICY "profiles_select_admin"
  ON public.profiles FOR SELECT
  USING (public.get_my_profile_role() = 'admin');

CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  USING (public.get_my_profile_role() = 'admin')
  WITH CHECK (true);

-- organizations: 동일
DROP POLICY IF EXISTS "organizations_all_admin" ON public.organizations;

CREATE POLICY "organizations_all_admin"
  ON public.organizations FOR ALL
  USING (public.get_my_profile_role() = 'admin')
  WITH CHECK (true);

-- organization_ui_settings: 동일
DROP POLICY IF EXISTS "organization_ui_settings_all_admin" ON public.organization_ui_settings;

CREATE POLICY "organization_ui_settings_all_admin"
  ON public.organization_ui_settings FOR ALL
  USING (public.get_my_profile_role() = 'admin')
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
