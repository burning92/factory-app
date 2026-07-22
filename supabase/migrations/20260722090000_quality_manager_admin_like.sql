-- 품질팀장(quality_manager)을 admin급으로 취급
-- 앱의 isAdminLikeRole() 과 동일하게 RLS·헬퍼 함수를 맞춤

CREATE OR REPLACE FUNCTION public.is_admin_like()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.get_my_profile_role() IN ('admin', 'quality_manager');
$$;

COMMENT ON FUNCTION public.is_admin_like() IS
  'admin 또는 quality_manager(품질팀장). 관리자급 권한 검사.';

GRANT EXECUTE ON FUNCTION public.is_admin_like() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_like() TO anon;

-- ---------- profiles / organizations / UI settings ----------
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;

CREATE POLICY "profiles_select_admin"
  ON public.profiles FOR SELECT
  USING (public.is_admin_like());

CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  USING (public.is_admin_like())
  WITH CHECK (true);

DROP POLICY IF EXISTS "organizations_all_admin" ON public.organizations;
CREATE POLICY "organizations_all_admin"
  ON public.organizations FOR ALL
  USING (public.is_admin_like())
  WITH CHECK (true);

DROP POLICY IF EXISTS "organization_ui_settings_all_admin" ON public.organization_ui_settings;
CREATE POLICY "organization_ui_settings_all_admin"
  ON public.organization_ui_settings FOR ALL
  USING (public.is_admin_like())
  WITH CHECK (true);

-- ---------- access / audit logs ----------
DROP POLICY IF EXISTS "access_logs_select_admin" ON public.access_logs;
CREATE POLICY "access_logs_select_admin"
  ON public.access_logs FOR SELECT TO authenticated
  USING (public.is_admin_like());

DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_select_admin"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_admin_like());

-- ---------- leave ----------
DROP POLICY IF EXISTS "leave_annual_totals_select_own_or_admin" ON public.leave_annual_totals;
DROP POLICY IF EXISTS "leave_annual_totals_insert_admin" ON public.leave_annual_totals;
DROP POLICY IF EXISTS "leave_annual_totals_update_admin" ON public.leave_annual_totals;
DROP POLICY IF EXISTS "leave_annual_totals_delete_admin" ON public.leave_annual_totals;

CREATE POLICY "leave_annual_totals_select_own_or_admin"
  ON public.leave_annual_totals FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin_like());

CREATE POLICY "leave_annual_totals_insert_admin"
  ON public.leave_annual_totals FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_like());

CREATE POLICY "leave_annual_totals_update_admin"
  ON public.leave_annual_totals FOR UPDATE TO authenticated
  USING (public.is_admin_like())
  WITH CHECK (public.is_admin_like());

CREATE POLICY "leave_annual_totals_delete_admin"
  ON public.leave_annual_totals FOR DELETE TO authenticated
  USING (public.is_admin_like());

DROP POLICY IF EXISTS "leave_deductions_select_own_or_admin" ON public.leave_deductions;
DROP POLICY IF EXISTS "leave_deductions_insert_admin" ON public.leave_deductions;
DROP POLICY IF EXISTS "leave_deductions_update_admin" ON public.leave_deductions;
DROP POLICY IF EXISTS "leave_deductions_delete_admin" ON public.leave_deductions;

CREATE POLICY "leave_deductions_select_own_or_admin"
  ON public.leave_deductions FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin_like());

CREATE POLICY "leave_deductions_insert_admin"
  ON public.leave_deductions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_like());

CREATE POLICY "leave_deductions_update_admin"
  ON public.leave_deductions FOR UPDATE TO authenticated
  USING (public.is_admin_like())
  WITH CHECK (public.is_admin_like());

CREATE POLICY "leave_deductions_delete_admin"
  ON public.leave_deductions FOR DELETE TO authenticated
  USING (public.is_admin_like());

DROP POLICY IF EXISTS "leave_adjustments_select_own_or_admin" ON public.leave_adjustments;
DROP POLICY IF EXISTS "leave_adjustments_insert_admin" ON public.leave_adjustments;
DROP POLICY IF EXISTS "leave_adjustments_update_admin" ON public.leave_adjustments;
DROP POLICY IF EXISTS "leave_adjustments_delete_admin" ON public.leave_adjustments;

CREATE POLICY "leave_adjustments_select_own_or_admin"
  ON public.leave_adjustments FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin_like());

CREATE POLICY "leave_adjustments_insert_admin"
  ON public.leave_adjustments FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_like());

CREATE POLICY "leave_adjustments_update_admin"
  ON public.leave_adjustments FOR UPDATE TO authenticated
  USING (public.is_admin_like())
  WITH CHECK (public.is_admin_like());

CREATE POLICY "leave_adjustments_delete_admin"
  ON public.leave_adjustments FOR DELETE TO authenticated
  USING (public.is_admin_like());

-- ---------- equipment master / options / history ----------
DROP POLICY IF EXISTS "equipment_master_insert" ON public.equipment_master;
DROP POLICY IF EXISTS "equipment_master_update" ON public.equipment_master;
DROP POLICY IF EXISTS "equipment_master_delete" ON public.equipment_master;

CREATE POLICY "equipment_master_insert"
  ON public.equipment_master FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_like());

CREATE POLICY "equipment_master_update"
  ON public.equipment_master FOR UPDATE TO authenticated
  USING (public.is_admin_like())
  WITH CHECK (public.is_admin_like());

CREATE POLICY "equipment_master_delete"
  ON public.equipment_master FOR DELETE TO authenticated
  USING (public.is_admin_like());

DROP POLICY IF EXISTS "equipment_type_options_insert" ON public.equipment_type_options;
DROP POLICY IF EXISTS "equipment_type_options_update" ON public.equipment_type_options;
DROP POLICY IF EXISTS "equipment_type_options_delete" ON public.equipment_type_options;

CREATE POLICY "equipment_type_options_insert"
  ON public.equipment_type_options FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_like());
CREATE POLICY "equipment_type_options_update"
  ON public.equipment_type_options FOR UPDATE TO authenticated
  USING (public.is_admin_like())
  WITH CHECK (public.is_admin_like());
CREATE POLICY "equipment_type_options_delete"
  ON public.equipment_type_options FOR DELETE TO authenticated
  USING (public.is_admin_like());

DROP POLICY IF EXISTS "equipment_dashboard_group_options_insert" ON public.equipment_dashboard_group_options;
DROP POLICY IF EXISTS "equipment_dashboard_group_options_update" ON public.equipment_dashboard_group_options;
DROP POLICY IF EXISTS "equipment_dashboard_group_options_delete" ON public.equipment_dashboard_group_options;

CREATE POLICY "equipment_dashboard_group_options_insert"
  ON public.equipment_dashboard_group_options FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_like());
CREATE POLICY "equipment_dashboard_group_options_update"
  ON public.equipment_dashboard_group_options FOR UPDATE TO authenticated
  USING (public.is_admin_like())
  WITH CHECK (public.is_admin_like());
CREATE POLICY "equipment_dashboard_group_options_delete"
  ON public.equipment_dashboard_group_options FOR DELETE TO authenticated
  USING (public.is_admin_like());

DROP POLICY IF EXISTS "equipment_history_records_insert" ON public.equipment_history_records;
DROP POLICY IF EXISTS "equipment_history_records_update" ON public.equipment_history_records;
DROP POLICY IF EXISTS "equipment_history_records_delete" ON public.equipment_history_records;

CREATE POLICY "equipment_history_records_insert"
  ON public.equipment_history_records FOR INSERT TO authenticated
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

CREATE POLICY "equipment_history_records_update"
  ON public.equipment_history_records FOR UPDATE TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

CREATE POLICY "equipment_history_records_delete"
  ON public.equipment_history_records FOR DELETE TO authenticated
  USING (public.is_admin_like());

DROP POLICY IF EXISTS "equipment_history_updates_insert" ON public.equipment_history_updates;
DROP POLICY IF EXISTS "equipment_history_updates_update" ON public.equipment_history_updates;
DROP POLICY IF EXISTS "equipment_history_updates_delete" ON public.equipment_history_updates;

CREATE POLICY "equipment_history_updates_insert"
  ON public.equipment_history_updates FOR INSERT TO authenticated
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

CREATE POLICY "equipment_history_updates_update"
  ON public.equipment_history_updates FOR UPDATE TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

CREATE POLICY "equipment_history_updates_delete"
  ON public.equipment_history_updates FOR DELETE TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

-- ---------- planning ----------
DROP POLICY IF EXISTS "production_plan_months_write_manager_admin" ON public.production_plan_months;
CREATE POLICY "production_plan_months_write_manager_admin"
  ON public.production_plan_months FOR ALL TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

DROP POLICY IF EXISTS "production_plan_entries_write_manager_admin" ON public.production_plan_entries;
CREATE POLICY "production_plan_entries_write_manager_admin"
  ON public.production_plan_entries FOR ALL TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

DROP POLICY IF EXISTS "production_plan_notes_write_manager_admin" ON public.production_plan_notes;
CREATE POLICY "production_plan_notes_write_manager_admin"
  ON public.production_plan_notes FOR ALL TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

DROP POLICY IF EXISTS "production_plan_manpower_write_manager_admin" ON public.production_plan_manpower;
CREATE POLICY "production_plan_manpower_write_manager_admin"
  ON public.production_plan_manpower FOR ALL TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

DROP POLICY IF EXISTS "production_plan_month_closings_write_manager_admin" ON public.production_plan_month_closings;
CREATE POLICY "production_plan_month_closings_write_manager_admin"
  ON public.production_plan_month_closings FOR INSERT TO authenticated
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

DROP POLICY IF EXISTS "production_plan_leaves_write_manager_admin" ON public.production_plan_leaves;
CREATE POLICY "production_plan_leaves_write_manager_admin"
  ON public.production_plan_leaves FOR ALL TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

DROP POLICY IF EXISTS "planning_submaterials_write_manager_admin" ON public.planning_submaterials;
CREATE POLICY "planning_submaterials_write_manager_admin"
  ON public.planning_submaterials FOR ALL TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

DROP POLICY IF EXISTS "planning_submaterial_items_write_manager_admin" ON public.planning_submaterial_items;
CREATE POLICY "planning_submaterial_items_write_manager_admin"
  ON public.planning_submaterial_items FOR ALL TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

DROP POLICY IF EXISTS "planning_range_entries_write_manager_admin" ON public.planning_range_entries;
CREATE POLICY "planning_range_entries_write_manager_admin"
  ON public.planning_range_entries FOR ALL TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

-- ---------- vacuum bag ----------
DROP POLICY IF EXISTS "vacuum_bag_balances_write_manager_admin" ON public.vacuum_bag_balances;
CREATE POLICY "vacuum_bag_balances_write_manager_admin"
  ON public.vacuum_bag_balances FOR ALL TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

DROP POLICY IF EXISTS "vacuum_bag_movements_write_manager_admin" ON public.vacuum_bag_movements;
CREATE POLICY "vacuum_bag_movements_write_manager_admin"
  ON public.vacuum_bag_movements FOR INSERT TO authenticated
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'));

-- ---------- Harang helper functions ----------
CREATE OR REPLACE FUNCTION public.can_manage_harang_master()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.is_admin_like();
$$;

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
      AND public.is_admin_like()
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_harang_data()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    (public.get_my_organization_code() = '000' AND public.is_admin_like())
    OR (public.get_my_organization_code() = '100' AND public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
    OR (public.get_my_organization_code() = '200' AND public.get_my_profile_role() IN ('worker', 'manager', 'admin', 'quality_manager', 'assistant_manager'));
$$;

CREATE OR REPLACE FUNCTION public.can_write_harang_ops()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    (public.get_my_organization_code() = '000' AND public.is_admin_like())
    OR (public.get_my_organization_code() = '100' AND public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
    OR (public.get_my_organization_code() = '200' AND public.get_my_profile_role() IN ('worker', 'manager', 'admin', 'quality_manager', 'assistant_manager'));
$$;

CREATE OR REPLACE FUNCTION public.can_access_harang_production_requests()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.can_access_harang_data();
$$;

CREATE OR REPLACE FUNCTION public.can_write_harang_stock_adjustment()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    (public.get_my_organization_code() = '000' AND public.is_admin_like())
    OR (public.get_my_organization_code() = '100' AND public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
    OR (
      public.get_my_organization_code() = '200'
      AND public.get_my_profile_role() IN ('worker', 'manager', 'assistant_manager', 'admin', 'quality_manager')
    );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_harang_request_ops()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    (public.get_my_organization_code() = '100' AND public.get_my_profile_role() IN ('manager', 'admin', 'quality_manager', 'headquarters'))
    OR (public.get_my_organization_code() = '000' AND public.is_admin_like());
$$;

-- equipment incidents: manager/admin → quality_manager·headquarters 포함
DROP POLICY IF EXISTS "equipment_incidents_insert" ON public.equipment_incidents;
CREATE POLICY "equipment_incidents_insert" ON public.equipment_incidents FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('manager', 'admin', 'quality_manager', 'headquarters')
  )
);

NOTIFY pgrst, 'reload schema';
