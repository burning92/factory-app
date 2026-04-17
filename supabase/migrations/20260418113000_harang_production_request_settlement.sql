-- ============================================================
-- Harang production request settlement (closed_qty + closure logs)
-- - status add: settled
-- - line add: closed_qty
-- - closure log table
-- - close line RPC / header update RPC
-- - cancel policy hardening (any produced/closed line => cancel blocked)
-- ============================================================

ALTER TABLE public.harang_production_requests
  DROP CONSTRAINT IF EXISTS harang_production_requests_status_check;

ALTER TABLE public.harang_production_requests
  ADD CONSTRAINT harang_production_requests_status_check
  CHECK (status IN ('pending', 'shortage', 'in_progress', 'completed', 'settled', 'cancelled'));

ALTER TABLE public.harang_production_request_lines
  ADD COLUMN IF NOT EXISTS closed_qty NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (closed_qty >= 0);

ALTER TABLE public.harang_production_request_lines
  DROP CONSTRAINT IF EXISTS chk_harang_pr_line_qty;

ALTER TABLE public.harang_production_request_lines
  ADD CONSTRAINT chk_harang_pr_line_qty
  CHECK (ABS((remaining_qty + produced_qty + closed_qty) - requested_qty) < 0.001);

CREATE TABLE IF NOT EXISTS public.harang_production_request_line_closures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_line_id UUID NOT NULL REFERENCES public.harang_production_request_lines(id) ON DELETE CASCADE,
  closed_qty NUMERIC(14, 3) NOT NULL CHECK (closed_qty > 0),
  reason TEXT NOT NULL,
  closed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_harang_pr_line_closures_line
  ON public.harang_production_request_line_closures (request_line_id);

CREATE INDEX IF NOT EXISTS idx_harang_pr_line_closures_closed_at_desc
  ON public.harang_production_request_line_closures (closed_at DESC);

CREATE INDEX IF NOT EXISTS idx_harang_pr_line_closures_line_closed_at_desc
  ON public.harang_production_request_line_closures (request_line_id, closed_at DESC);

CREATE OR REPLACE FUNCTION public.harang_total_reserved_qty(
  p_category TEXT,
  p_item_id UUID
) RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(r.reserved_qty), 0)::NUMERIC(14, 3)
  FROM public.harang_production_request_reservations r
  JOIN public.harang_production_request_lines ln ON ln.id = r.request_line_id
  JOIN public.harang_production_requests h ON h.id = ln.header_id
  WHERE r.material_category = p_category
    AND r.material_id = p_item_id
    AND h.status NOT IN ('completed', 'settled', 'cancelled')
    AND ln.remaining_qty > 0;
$$;

CREATE OR REPLACE FUNCTION public.refresh_harang_all_open_shortage_flags()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT ln.id AS line_id
    FROM public.harang_production_request_lines ln
    JOIN public.harang_production_requests h ON h.id = ln.header_id
    WHERE h.status NOT IN ('completed', 'settled', 'cancelled')
      AND ln.remaining_qty > 0
  LOOP
    PERFORM public.refresh_harang_request_line_shortage_flags(r.line_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_harang_request_header_status(p_header_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  st TEXT;
  cur_st TEXT;
  has_short BOOLEAN;
  has_prog BOOLEAN;
  all_done BOOLEAN;
  line_count INT;
  any_closed BOOLEAN;
BEGIN
  SELECT status INTO cur_st FROM public.harang_production_requests WHERE id = p_header_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF cur_st = 'cancelled' THEN
    RETURN;
  END IF;

  SELECT COUNT(*) INTO line_count FROM public.harang_production_request_lines WHERE header_id = p_header_id;

  IF line_count = 0 THEN
    has_short := false;
    has_prog := false;
    any_closed := false;
    all_done := false;
  ELSE
    SELECT
      COALESCE(BOOL_OR(ln.material_shortage_flag AND ln.remaining_qty > 0), false),
      COALESCE(BOOL_OR(ln.produced_qty > 0), false),
      COALESCE(BOOL_OR(ln.closed_qty > 0), false),
      COALESCE(BOOL_AND(ln.remaining_qty <= 0), false)
    INTO has_short, has_prog, any_closed, all_done
    FROM public.harang_production_request_lines ln
    WHERE ln.header_id = p_header_id;
  END IF;

  IF line_count = 0 THEN
    st := 'pending';
  ELSIF all_done AND any_closed THEN
    st := 'settled';
  ELSIF all_done THEN
    st := 'completed';
  ELSIF has_short THEN
    st := 'shortage';
  ELSIF has_prog THEN
    st := 'in_progress';
  ELSE
    st := 'pending';
  END IF;

  UPDATE public.harang_production_requests SET status = st, updated_at = now() WHERE id = p_header_id;
END;
$$;

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

  IF (SELECT status FROM public.harang_production_requests WHERE id = hid) IN ('completed', 'settled', 'cancelled') THEN
    RAISE EXCEPTION '종료되었거나 취소된 요청입니다.';
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

CREATE OR REPLACE FUNCTION public.close_harang_request_line_remaining(
  p_line_id UUID,
  p_close_qty NUMERIC,
  p_reason TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rem NUMERIC;
  hid UUID;
  actor UUID := auth.uid();
BEGIN
  IF NOT public.is_headquarters_organization() THEN
    RAISE EXCEPTION '잔량 종결은 본사(조직 100)만 가능합니다.';
  END IF;
  IF public.get_my_profile_role() NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  IF p_close_qty IS NULL OR p_close_qty <= 0 THEN
    RAISE EXCEPTION '종결수량은 0보다 커야 합니다.';
  END IF;
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION '종결사유를 입력하세요.';
  END IF;

  SELECT remaining_qty, header_id
  INTO rem, hid
  FROM public.harang_production_request_lines
  WHERE id = p_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '요청 라인을 찾을 수 없습니다.';
  END IF;

  IF (SELECT status FROM public.harang_production_requests WHERE id = hid) IN ('completed', 'settled', 'cancelled') THEN
    RAISE EXCEPTION '완료/종결/취소 상태 라인은 종결할 수 없습니다.';
  END IF;

  IF p_close_qty > rem THEN
    RAISE EXCEPTION '종결수량이 잔여수량을 초과합니다.';
  END IF;

  UPDATE public.harang_production_request_lines
  SET
    closed_qty = closed_qty + p_close_qty,
    remaining_qty = remaining_qty - p_close_qty,
    updated_at = now()
  WHERE id = p_line_id;

  INSERT INTO public.harang_production_request_line_closures (
    request_line_id, closed_qty, reason, closed_by, closed_at
  ) VALUES (
    p_line_id, p_close_qty, trim(p_reason), actor, now()
  );

  PERFORM public.refresh_harang_request_line_reservations(p_line_id);
  PERFORM public.refresh_harang_all_open_shortage_flags();
  PERFORM public.refresh_every_harang_request_header_status();
END;
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
  IF NOT public.is_headquarters_organization() THEN
    RAISE EXCEPTION '요청 수정은 본사(조직 100)만 가능합니다.';
  END IF;
  IF public.get_my_profile_role() NOT IN ('manager', 'admin') THEN
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

CREATE OR REPLACE FUNCTION public.cancel_harang_production_request(p_header_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_progress BOOLEAN;
BEGIN
  IF NOT public.is_headquarters_organization() THEN
    RAISE EXCEPTION '취소는 본사만 가능합니다.';
  END IF;
  IF public.get_my_profile_role() NOT IN ('manager', 'admin') THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.harang_production_request_lines ln
    WHERE ln.header_id = p_header_id
      AND (ln.produced_qty > 0 OR ln.closed_qty > 0)
  ) INTO has_progress;

  IF has_progress THEN
    RAISE EXCEPTION '생산 반영 또는 잔량 종결이 있는 요청은 취소할 수 없습니다.';
  END IF;

  UPDATE public.harang_production_request_lines
  SET produced_qty = requested_qty, closed_qty = 0, remaining_qty = 0, updated_at = now()
  WHERE header_id = p_header_id;

  DELETE FROM public.harang_production_request_reservations
  WHERE request_line_id IN (SELECT id FROM public.harang_production_request_lines WHERE header_id = p_header_id);

  UPDATE public.harang_production_requests
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_header_id;

  PERFORM public.refresh_harang_all_open_shortage_flags();
  PERFORM public.refresh_every_harang_request_header_status();
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_harang_request_line_remaining(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_harang_production_request_header(UUID, DATE, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_harang_production_request(UUID) TO authenticated;

ALTER TABLE public.harang_production_request_line_closures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "harang_pr_line_closures_select" ON public.harang_production_request_line_closures;
CREATE POLICY "harang_pr_line_closures_select"
  ON public.harang_production_request_line_closures FOR SELECT TO authenticated
  USING (public.can_access_harang_production_requests());

GRANT SELECT ON public.harang_production_request_line_closures TO authenticated;

NOTIFY pgrst, 'reload schema';
