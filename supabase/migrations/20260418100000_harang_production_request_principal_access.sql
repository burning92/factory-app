-- ============================================================
-- 생산요청 접근: 본사(100) manager·admin 조회/등록, 하랑(200) manager·worker 조회·반영,
-- admin 전역, 본사 worker 제외 (RLS SELECT)
-- apply RPC: 하랑 200 + (manager|worker) 또는 admin
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_access_harang_production_requests()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    public.get_my_profile_role() = 'admin'
    OR (
      public.get_my_organization_code() = '100'
      AND public.get_my_profile_role() IN ('manager', 'admin')
    )
    OR (
      public.get_my_organization_code() = '200'
      AND public.get_my_profile_role() IN ('manager', 'worker')
    );
$$;

COMMENT ON FUNCTION public.can_access_harang_production_requests() IS
  '하랑 생산요청 테이블 RLS: 본사 manager·admin, 하랑 manager·worker, admin 전역. 본사 worker 제외.';

GRANT EXECUTE ON FUNCTION public.can_access_harang_production_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_harang_production_requests() TO anon;

DROP POLICY IF EXISTS "harang_pr_requests_select" ON public.harang_production_requests;
CREATE POLICY "harang_pr_requests_select"
  ON public.harang_production_requests FOR SELECT TO authenticated
  USING (public.can_access_harang_production_requests());

DROP POLICY IF EXISTS "harang_pr_lines_select" ON public.harang_production_request_lines;
CREATE POLICY "harang_pr_lines_select"
  ON public.harang_production_request_lines FOR SELECT TO authenticated
  USING (public.can_access_harang_production_requests());

DROP POLICY IF EXISTS "harang_pr_line_materials_select" ON public.harang_production_request_line_materials;
CREATE POLICY "harang_pr_line_materials_select"
  ON public.harang_production_request_line_materials FOR SELECT TO authenticated
  USING (public.can_access_harang_production_requests());

DROP POLICY IF EXISTS "harang_pr_reservations_select" ON public.harang_production_request_reservations;
CREATE POLICY "harang_pr_reservations_select"
  ON public.harang_production_request_reservations FOR SELECT TO authenticated
  USING (public.can_access_harang_production_requests());

CREATE OR REPLACE FUNCTION public.apply_harang_request_line_production(
  p_line_id UUID,
  p_produced_qty NUMERIC
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rem NUMERIC;
  hid UUID;
BEGIN
  IF NOT (
    public.is_harang_organization()
    OR public.get_my_profile_role() = 'admin'
  ) THEN
    RAISE EXCEPTION '생산 반영은 하랑(조직 200) 계정 또는 관리자만 가능합니다.';
  END IF;
  IF public.get_my_profile_role() NOT IN ('manager', 'worker', 'admin') THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  IF p_produced_qty IS NULL OR p_produced_qty <= 0 THEN
    RAISE EXCEPTION '생산수량은 0보다 커야 합니다.';
  END IF;

  SELECT remaining_qty, header_id
  INTO rem, hid
  FROM public.harang_production_request_lines
  WHERE id = p_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '요청 라인을 찾을 수 없습니다.';
  END IF;

  IF (SELECT status FROM public.harang_production_requests WHERE id = hid) IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION '완료되었거나 취소된 요청입니다.';
  END IF;

  IF p_produced_qty > rem THEN
    RAISE EXCEPTION '생산수량이 잔여수량을 초과합니다.';
  END IF;

  UPDATE public.harang_production_request_lines
  SET
    produced_qty = produced_qty + p_produced_qty,
    remaining_qty = remaining_qty - p_produced_qty,
    updated_at = now()
  WHERE id = p_line_id;

  PERFORM public.refresh_harang_request_line_reservations(p_line_id);
  PERFORM public.refresh_harang_all_open_shortage_flags();
  PERFORM public.refresh_every_harang_request_header_status();
END;
$$;

NOTIFY pgrst, 'reload schema';
