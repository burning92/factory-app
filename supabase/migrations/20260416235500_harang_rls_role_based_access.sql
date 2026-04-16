-- Harang RLS 접근 기준 정리
-- - 조회/운영: manager, admin
-- - 마스터관리: admin 전용

CREATE OR REPLACE FUNCTION public.can_access_harang_data()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.get_my_profile_role() IN ('manager', 'admin');
$$;

CREATE OR REPLACE FUNCTION public.can_write_harang_ops()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.get_my_profile_role() IN ('manager', 'admin');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_harang_master()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.get_my_profile_role() = 'admin';
$$;

GRANT EXECUTE ON FUNCTION public.can_access_harang_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_harang_data() TO anon;
GRANT EXECUTE ON FUNCTION public.can_write_harang_ops() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_harang_master() TO authenticated;

NOTIFY pgrst, 'reload schema';
