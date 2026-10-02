-- 연월차 관리 권한을 관리자급 외 지정 사용자(매니저 등)에게 개별 부여
-- - profiles.can_manage_leave = true 인 사용자는 "자기 조직" 직원의 연월차만 조회·수정
-- - admin / quality_manager 는 기존대로 전체

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_manage_leave BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.can_manage_leave IS
  '연월차 관리 권한(자기 조직 한정). admin/quality_manager 는 이 값과 무관하게 전체 권한.';

CREATE OR REPLACE FUNCTION public.is_leave_manager()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.is_admin_like()
    OR COALESCE(
      (SELECT p.can_manage_leave AND p.is_active FROM public.profiles p WHERE p.id = auth.uid()),
      false
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_leave_manager() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_manage_leave_of(target_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.is_admin_like()
    OR (
      public.is_leave_manager()
      AND EXISTS (
        SELECT 1 FROM public.profiles t
        WHERE t.id = target_profile_id
          AND t.organization_id = public.get_my_organization_id()
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_leave_of(UUID) TO authenticated;

-- profiles_update_own 정책으로 본인 행 수정이 가능하므로, 관리자급이 아니면 권한 관련 컬럼 변경 차단
-- (service_role 등 auth.uid() 가 없는 서버 호출은 통과)
CREATE OR REPLACE FUNCTION public.guard_profiles_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin_like() THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION '권한(role)은 관리자만 변경할 수 있습니다.' USING ERRCODE = '42501';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION '소속 조직은 관리자만 변경할 수 있습니다.' USING ERRCODE = '42501';
  END IF;
  IF NEW.can_manage_leave IS DISTINCT FROM OLD.can_manage_leave THEN
    RAISE EXCEPTION '연월차 관리 권한은 관리자만 변경할 수 있습니다.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profiles_privileged_columns ON public.profiles;
CREATE TRIGGER guard_profiles_privileged_columns
  BEFORE UPDATE OF role, organization_id, can_manage_leave ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profiles_privileged_columns();

-- 입사일자: profiles UPDATE 를 열지 않고 전용 RPC 로만 수정
CREATE OR REPLACE FUNCTION public.set_profile_hire_date(target_profile_id UUID, new_hire_date DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_leave_of(target_profile_id) THEN
    RAISE EXCEPTION '권한이 없습니다.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles SET hire_date = new_hire_date WHERE id = target_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_profile_hire_date(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profile_hire_date(UUID, DATE) TO authenticated;

-- ---------- leave_annual_totals ----------
DROP POLICY IF EXISTS "leave_annual_totals_select_own_or_admin" ON public.leave_annual_totals;
DROP POLICY IF EXISTS "leave_annual_totals_insert_admin" ON public.leave_annual_totals;
DROP POLICY IF EXISTS "leave_annual_totals_update_admin" ON public.leave_annual_totals;
DROP POLICY IF EXISTS "leave_annual_totals_delete_admin" ON public.leave_annual_totals;

CREATE POLICY "leave_annual_totals_select_own_or_admin"
  ON public.leave_annual_totals FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.can_manage_leave_of(profile_id));

CREATE POLICY "leave_annual_totals_insert_admin"
  ON public.leave_annual_totals FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_leave_of(profile_id));

CREATE POLICY "leave_annual_totals_update_admin"
  ON public.leave_annual_totals FOR UPDATE TO authenticated
  USING (public.can_manage_leave_of(profile_id))
  WITH CHECK (public.can_manage_leave_of(profile_id));

CREATE POLICY "leave_annual_totals_delete_admin"
  ON public.leave_annual_totals FOR DELETE TO authenticated
  USING (public.can_manage_leave_of(profile_id));

-- ---------- leave_deductions ----------
DROP POLICY IF EXISTS "leave_deductions_select_own_or_admin" ON public.leave_deductions;
DROP POLICY IF EXISTS "leave_deductions_insert_admin" ON public.leave_deductions;
DROP POLICY IF EXISTS "leave_deductions_update_admin" ON public.leave_deductions;
DROP POLICY IF EXISTS "leave_deductions_delete_admin" ON public.leave_deductions;

CREATE POLICY "leave_deductions_select_own_or_admin"
  ON public.leave_deductions FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.can_manage_leave_of(profile_id));

CREATE POLICY "leave_deductions_insert_admin"
  ON public.leave_deductions FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_leave_of(profile_id));

CREATE POLICY "leave_deductions_update_admin"
  ON public.leave_deductions FOR UPDATE TO authenticated
  USING (public.can_manage_leave_of(profile_id))
  WITH CHECK (public.can_manage_leave_of(profile_id));

CREATE POLICY "leave_deductions_delete_admin"
  ON public.leave_deductions FOR DELETE TO authenticated
  USING (public.can_manage_leave_of(profile_id));

-- ---------- leave_adjustments ----------
DROP POLICY IF EXISTS "leave_adjustments_select_own_or_admin" ON public.leave_adjustments;
DROP POLICY IF EXISTS "leave_adjustments_insert_admin" ON public.leave_adjustments;
DROP POLICY IF EXISTS "leave_adjustments_update_admin" ON public.leave_adjustments;
DROP POLICY IF EXISTS "leave_adjustments_delete_admin" ON public.leave_adjustments;

CREATE POLICY "leave_adjustments_select_own_or_admin"
  ON public.leave_adjustments FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.can_manage_leave_of(profile_id));

CREATE POLICY "leave_adjustments_insert_admin"
  ON public.leave_adjustments FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_leave_of(profile_id));

CREATE POLICY "leave_adjustments_update_admin"
  ON public.leave_adjustments FOR UPDATE TO authenticated
  USING (public.can_manage_leave_of(profile_id))
  WITH CHECK (public.can_manage_leave_of(profile_id));

CREATE POLICY "leave_adjustments_delete_admin"
  ON public.leave_adjustments FOR DELETE TO authenticated
  USING (public.can_manage_leave_of(profile_id));

NOTIFY pgrst, 'reload schema';
