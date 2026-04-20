-- ============================================================
-- 생산입고 삭제 시 입출고 이력(harang_inventory_transactions) 정합성
--
-- 문제:
-- - 작업지시 생산입고는 reference_no에 생산입고 No(production_no)가 아니라
--   생산요청 번호(request_no, 예: HRP-...)를 넣는다.
-- - 레거시 직접 생산입고는 note='생산입고', reference_no=production_no 이다.
-- - 기존 delete_harang_production_with_usage 는
--   reference_no=production_no AND note='작업지시 생산입고' 만 삭제해
--   실제로는 한 건도 매칭되지 않거나(작업지시), 레거시 이력이 남는다.
-- 그 결과 LOT 재고는 복구되어도 '사용' 이력이 남아 입고 삭제가 막힌다.
--
-- 요청 헤더가 먼저 삭제되면 request_id 가 NULL 이 될 수 있으므로,
-- 삭제 시점에 남아 있는 사용 이력에서 request_no 를 보조로 읽는다.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_harang_production_with_usage(
  p_header_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_head RECORD;
  v_status TEXT;
  v_request_no TEXT;
BEGIN
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  SELECT * INTO v_head
  FROM public.harang_production_headers
  WHERE id = p_header_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '생산입고를 찾을 수 없습니다.';
  END IF;

  v_request_no := NULL;
  IF v_head.request_id IS NOT NULL THEN
    SELECT r.request_no INTO v_request_no
    FROM public.harang_production_requests r
    WHERE r.id = v_head.request_id;
  END IF;

  IF v_request_no IS NULL AND v_head.request_line_id IS NOT NULL THEN
    SELECT r.request_no INTO v_request_no
    FROM public.harang_production_request_lines ln
    JOIN public.harang_production_requests r ON r.id = ln.header_id
    WHERE ln.id = v_head.request_line_id;
  END IF;

  IF v_request_no IS NULL THEN
    SELECT t.reference_no INTO v_request_no
    FROM public.harang_inventory_transactions t
    INNER JOIN public.harang_production_line_lots pl ON pl.lot_id = t.lot_id
    INNER JOIN public.harang_production_lines ln ON ln.id = pl.line_id
    WHERE ln.header_id = p_header_id
      AND t.tx_type = 'usage'
      AND t.note = '작업지시 생산입고'
    LIMIT 1;
  END IF;

  IF v_head.request_line_id IS NOT NULL THEN
    SELECT h.status INTO v_status
    FROM public.harang_production_request_lines ln
    JOIN public.harang_production_requests h ON h.id = ln.header_id
    WHERE ln.id = v_head.request_line_id
    FOR UPDATE;

    IF v_status IN ('cancelled') THEN
      RAISE EXCEPTION '취소된 요청 라인의 생산입고는 수정/삭제할 수 없습니다.';
    END IF;
  END IF;

  -- 1) LOT 재고 복구
  UPDATE public.harang_inventory_lots l
  SET current_quantity = l.current_quantity + x.qty
  FROM (
    SELECT pl.lot_id, SUM(pl.quantity_used)::NUMERIC(14,3) AS qty
    FROM public.harang_production_lines ln
    JOIN public.harang_production_line_lots pl ON pl.line_id = ln.id
    WHERE ln.header_id = p_header_id
    GROUP BY pl.lot_id
  ) x
  WHERE l.id = x.lot_id;

  -- 2) 재고 트랜잭션 삭제 (레거시 + 작업지시 모두)
  DELETE FROM public.harang_inventory_transactions
  WHERE tx_type = 'usage'
    AND (
      (reference_no = v_head.production_no AND note = '생산입고')
      OR (
        v_request_no IS NOT NULL
        AND reference_no = v_request_no
        AND note = '작업지시 생산입고'
      )
    );

  -- 3) 요청 반영수량 복구
  IF v_head.request_line_id IS NOT NULL THEN
    UPDATE public.harang_production_request_lines
    SET
      produced_qty = GREATEST(0, produced_qty - COALESCE(v_head.applied_to_request_qty, 0)),
      remaining_qty = remaining_qty + COALESCE(v_head.applied_to_request_qty, 0),
      updated_at = now()
    WHERE id = v_head.request_line_id;
  END IF;

  -- 4) 생산입고 삭제 (자식은 cascade)
  DELETE FROM public.harang_production_headers WHERE id = p_header_id;

  IF v_head.request_line_id IS NOT NULL THEN
    PERFORM public.refresh_harang_request_line_reservations(v_head.request_line_id);
    PERFORM public.refresh_harang_all_open_shortage_flags();
    PERFORM public.refresh_every_harang_request_header_status();
  END IF;
END;
$$;

-- 이미 잘못 남아 있는 고아 '사용' 이력 정리
-- (동일 LOT를 다른 생산에서 쓴 경우를 가리지 않도록: 요청번호·생산헤더·LOT를 함께 매칭)
DELETE FROM public.harang_inventory_transactions t
WHERE t.tx_type = 'usage'
  AND t.note = '작업지시 생산입고'
  AND NOT EXISTS (
    SELECT 1
    FROM public.harang_production_headers h
    INNER JOIN public.harang_production_lines ln ON ln.header_id = h.id
    INNER JOIN public.harang_production_line_lots pl ON pl.line_id = ln.id AND pl.lot_id = t.lot_id
    WHERE (
      EXISTS (
        SELECT 1
        FROM public.harang_production_requests r
        WHERE r.id = h.request_id
          AND r.request_no = t.reference_no
      )
      OR EXISTS (
        SELECT 1
        FROM public.harang_production_request_lines rl
        INNER JOIN public.harang_production_requests r ON r.id = rl.header_id
        WHERE rl.id = h.request_line_id
          AND r.request_no = t.reference_no
      )
    )
  );

DELETE FROM public.harang_inventory_transactions t
WHERE t.tx_type = 'usage'
  AND t.note = '생산입고'
  AND NOT EXISTS (
    SELECT 1
    FROM public.harang_production_headers h
    INNER JOIN public.harang_production_lines ln ON ln.header_id = h.id
    INNER JOIN public.harang_production_line_lots pl ON pl.line_id = ln.id AND pl.lot_id = t.lot_id
    WHERE h.production_no = t.reference_no
  );

NOTIFY pgrst, 'reload schema';
