-- 하랑 입고관리/생산입력 목록에서 등록자명 표시용
-- 같은 조직(authenticated) 사용자에 한해 profiles SELECT 허용

CREATE OR REPLACE FUNCTION public.get_my_organization_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_organization_id() TO authenticated;

DROP POLICY IF EXISTS "profiles_select_same_org" ON public.profiles;
CREATE POLICY "profiles_select_same_org"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    organization_id = public.get_my_organization_id()
  );

NOTIFY pgrst, 'reload schema';
