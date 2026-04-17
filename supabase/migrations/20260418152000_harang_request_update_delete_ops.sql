-- ============================================================
-- Harang production request update/delete operations
-- - header update (due_date/priority/note only)
-- - hard delete request when no production/closure history
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_manage_harang_request_ops()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    (public.get_my_organization_code() = '100' AND public.get_my_profile_role() IN ('manager', 'admin'))
    OR (public.get_my_organization_code() = '000' AND public.get_my_profile_role() = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.update_harang_production_request_header(
  p_header_id UUID,
  p_due_date DATE,
  p_priority INTEGER,
  p_note TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_harang_request_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  UPDATE public.harang_production_requests
  SET
    due_date = COALESCE(p_due_date, due_date),
    priority = COALESCE(p_priority, priority),
    note = NULLIF(trim(COALESCE(p_note, '')), ''),
    updated_at = now()
  WHERE id = p_header_id
    AND status <> 'cancelled';

  IF NOT FOUND THEN
    RAISE EXCEPTION '요청을 찾을 수 없거나 취소 상태입니다.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_harang_production_request(p_header_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_production BOOLEAN;
  v_has_closure BOOLEAN;
BEGIN
  IF NOT public.can_manage_harang_request_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.harang_production_requests WHERE id = p_header_id) THEN
    RAISE EXCEPTION '요청을 찾을 수 없습니다.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.harang_production_headers ph
    WHERE ph.request_id = p_header_id
  ) INTO v_has_production;

  SELECT EXISTS (
    SELECT 1
    FROM public.harang_production_request_line_closures c
    JOIN public.harang_production_request_lines ln ON ln.id = c.request_line_id
    WHERE ln.header_id = p_header_id
  ) INTO v_has_closure;

  IF v_has_production OR v_has_closure THEN
    RAISE EXCEPTION '이미 생산반영 또는 종결 이력이 있는 요청은 삭제할 수 없습니다.';
  END IF;

  -- remove related production reservations first (explicit cleanup)
  DELETE FROM public.harang_production_request_reservations
  WHERE request_line_id IN (
    SELECT id FROM public.harang_production_request_lines WHERE header_id = p_header_id
  );

  -- cascading deletes: lines -> line_materials / closures / reservations
  DELETE FROM public.harang_production_requests WHERE id = p_header_id;

  PERFORM public.refresh_harang_all_open_shortage_flags();
  PERFORM public.refresh_every_harang_request_header_status();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_harang_production_request_header(UUID, DATE, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_harang_production_request(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
