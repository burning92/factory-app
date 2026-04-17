-- ============================================================
-- Allow 000 admin for headquarters-only Harang request operations
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_headquarters_organization()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    public.get_my_organization_code() = '100'
    OR (
      public.get_my_organization_code() = '000'
      AND public.get_my_profile_role() = 'admin'
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_headquarters_organization() TO authenticated;

NOTIFY pgrst, 'reload schema';
