-- 재고조정 draft/확정 쓰기: 본사(100) 매니저·하랑(200) assistant_manager 포함
-- 기존: is_harang_organization OR admin 만 → 본사 매니저 임시저장 RLS 거부

CREATE OR REPLACE FUNCTION public.can_write_harang_stock_adjustment()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    (public.get_my_organization_code() = '000' AND public.get_my_profile_role() = 'admin')
    OR (public.get_my_organization_code() = '100' AND public.get_my_profile_role() IN ('manager', 'admin'))
    OR (
      public.get_my_organization_code() = '200'
      AND public.get_my_profile_role() IN ('worker', 'manager', 'assistant_manager', 'admin')
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_write_harang_stock_adjustment() TO authenticated;

NOTIFY pgrst, 'reload schema';
