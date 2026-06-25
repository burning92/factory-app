-- 작업1 기반: 재고조정 일괄 되돌리기 + 생산입고 line_lots를 원장(소비기한 LOT) 기준으로 재연결
-- 작업2/3: harang_inventory_stock_as_of_lot 은 원장 역산(기존 200000) — 정합 후 재고조정·실사일 조회에 사용

-- ---------------------------------------------------------------------------
-- 1) 확정된 생산 사이클 재고조정 전부 되돌리기 (최근 확정부터)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revert_all_harang_stock_cycle_adjustments()
RETURNS TABLE (
  session_id UUID,
  product_name TEXT,
  adjustment_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_product TEXT;
  v_date DATE;
BEGIN
  IF NOT public.can_write_harang_stock_adjustment() AND public.get_my_profile_role() <> 'admin' THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  FOR v_id, v_product, v_date IN
    SELECT s.id, s.product_name, s.adjustment_date
    FROM public.harang_stock_adjustment_sessions s
    WHERE s.status = 'confirmed'
      AND s.adjustment_type = 'production_cycle'
    ORDER BY s.confirmed_at DESC NULLS LAST, s.adjustment_date DESC, s.created_at DESC
  LOOP
    PERFORM public.revert_harang_stock_cycle_adjustment(v_id);
    session_id := v_id;
    product_name := v_product;
    adjustment_date := v_date;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_all_harang_stock_cycle_adjustments() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) 생산입고 line_lots / usage_qty / lot_dates_summary ← 원장 usage 거래 기준 재구성
--    · 소비기한(lot_date) 단위 LOT 연결 — 입고일자 아님
--    · 원장에 없는 line_lots(유령 LOT) 제거
--    · 동일 작업지시·동일 생산일 여러 건은 기존 line_lots 비율(없으면 BOM)로 분배
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harang_reconcile_production_lots_from_ledger()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line RECORD;
  v_hdr RECORD;
  v_lot RECORD;
  v_pool RECORD;
  v_old RECORD;
  v_day_headers INTEGER;
  v_material_headers INTEGER;
  v_weight NUMERIC(14, 3);
  v_total_weight NUMERIC(14, 3);
  v_alloc_qty NUMERIC(14, 3);
  v_line_total NUMERIC(14, 3);
  v_summary TEXT;
  v_lines_updated INTEGER := 0;
  v_line_lots_removed INTEGER := 0;
  v_line_lots_inserted INTEGER := 0;
BEGIN
  IF NOT public.can_write_harang_stock_adjustment() AND public.get_my_profile_role() <> 'admin' THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _harang_recon_old_pl (
    line_id UUID NOT NULL,
    lot_id UUID NOT NULL,
    quantity_used NUMERIC(14, 3) NOT NULL,
    PRIMARY KEY (line_id, lot_id)
  ) ON COMMIT DROP;

  TRUNCATE _harang_recon_old_pl;

  INSERT INTO _harang_recon_old_pl (line_id, lot_id, quantity_used)
  SELECT pl.line_id, pl.lot_id, pl.quantity_used
  FROM public.harang_production_line_lots pl;

  SELECT COUNT(*)::INTEGER INTO v_line_lots_removed FROM _harang_recon_old_pl;

  FOR v_line IN
    SELECT
      ln.id AS line_id,
      ln.header_id,
      ln.material_category,
      ln.material_id,
      ln.bom_qty
    FROM public.harang_production_lines ln
    ORDER BY ln.header_id, ln.sort_order, ln.id
  LOOP
    SELECT
      h.id,
      h.production_date,
      h.production_no,
      h.request_id,
      r.request_no
    INTO v_hdr
    FROM public.harang_production_headers h
    LEFT JOIN public.harang_production_requests r ON r.id = h.request_id
    WHERE h.id = v_line.header_id;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    DELETE FROM public.harang_production_line_lots pl
    WHERE pl.line_id = v_line.line_id;

    SELECT COUNT(*)::INTEGER INTO v_day_headers
    FROM public.harang_production_headers h2
    WHERE h2.production_date = v_hdr.production_date
      AND (
        (v_hdr.request_id IS NOT NULL AND h2.request_id = v_hdr.request_id)
        OR (v_hdr.request_id IS NULL AND h2.id = v_hdr.id)
      );

    SELECT COUNT(DISTINCT h2.id)::INTEGER INTO v_material_headers
    FROM public.harang_production_headers h2
    INNER JOIN public.harang_production_lines ln2 ON ln2.header_id = h2.id
    WHERE h2.production_date = v_hdr.production_date
      AND ln2.material_category = v_line.material_category
      AND ln2.material_id = v_line.material_id
      AND (
        (v_hdr.request_id IS NOT NULL AND h2.request_id = v_hdr.request_id)
        OR (v_hdr.request_id IS NULL AND h2.id = v_hdr.id)
      );

    v_line_total := 0;

    -- 1) 이 생산입고 No.로 찍힌 원장은 해당 라인에 직접 연결
    FOR v_pool IN
      SELECT
        t.lot_id,
        COALESCE(SUM(-t.quantity_delta), 0)::NUMERIC(14, 3) AS pool_qty
      FROM public.harang_inventory_transactions t
      INNER JOIN public.harang_inventory_lots l ON l.id = t.lot_id
      WHERE t.tx_type = 'usage'
        AND t.quantity_delta < 0
        AND t.tx_date = v_hdr.production_date
        AND t.reference_no = v_hdr.production_no
        AND l.category = v_line.material_category
        AND l.item_id = v_line.material_id
      GROUP BY t.lot_id
      HAVING COALESCE(SUM(-t.quantity_delta), 0) > 0.0005
    LOOP
      v_alloc_qty := COALESCE(v_pool.pool_qty, 0);
      INSERT INTO public.harang_production_line_lots (line_id, lot_id, quantity_used)
      VALUES (v_line.line_id, v_pool.lot_id, v_alloc_qty);
      v_line_lots_inserted := v_line_lots_inserted + 1;
      v_line_total := v_line_total + v_alloc_qty;
    END LOOP;

    -- 2) 작업지시(request_no) 원장 — 품목별 생산입고가 1건이면 전량, 복수면 비율 배분
    FOR v_pool IN
      SELECT
        t.lot_id,
        COALESCE(SUM(-t.quantity_delta), 0)::NUMERIC(14, 3) AS pool_qty
      FROM public.harang_inventory_transactions t
      INNER JOIN public.harang_inventory_lots l ON l.id = t.lot_id
      WHERE t.tx_type = 'usage'
        AND t.quantity_delta < 0
        AND t.tx_date = v_hdr.production_date
        AND v_hdr.request_no IS NOT NULL
        AND t.reference_no = v_hdr.request_no
        AND l.category = v_line.material_category
        AND l.item_id = v_line.material_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.harang_production_line_lots pl0
          WHERE pl0.line_id = v_line.line_id
            AND pl0.lot_id = t.lot_id
        )
      GROUP BY t.lot_id
      HAVING COALESCE(SUM(-t.quantity_delta), 0) > 0.0005
    LOOP
      v_alloc_qty := 0;
      v_weight := 0;
      v_total_weight := 0;

      IF v_material_headers <= 1 THEN
        v_alloc_qty := COALESCE(v_pool.pool_qty, 0);
      ELSIF v_day_headers > 1 THEN
        SELECT COALESCE(SUM(op.quantity_used), 0)::NUMERIC(14, 3) INTO v_total_weight
        FROM _harang_recon_old_pl op
        INNER JOIN public.harang_production_lines ln2 ON ln2.id = op.line_id
        INNER JOIN public.harang_production_headers h2 ON h2.id = ln2.header_id
        WHERE op.lot_id = v_pool.lot_id
          AND ln2.material_category = v_line.material_category
          AND ln2.material_id = v_line.material_id
          AND h2.production_date = v_hdr.production_date
          AND (
            (v_hdr.request_id IS NOT NULL AND h2.request_id = v_hdr.request_id)
            OR (v_hdr.request_id IS NULL AND h2.id = v_hdr.id)
          );

        v_total_weight := COALESCE(v_total_weight, 0);

        IF v_total_weight > 0.0005 THEN
          SELECT COALESCE((
            SELECT op.quantity_used
            FROM _harang_recon_old_pl op
            WHERE op.line_id = v_line.line_id
              AND op.lot_id = v_pool.lot_id
          ), 0)::NUMERIC(14, 3) INTO v_weight;
          v_alloc_qty := round((v_pool.pool_qty * v_weight / v_total_weight)::NUMERIC, 3);
        ELSE
          SELECT COALESCE(SUM(h2.finished_qty), 0)::NUMERIC(14, 3) INTO v_total_weight
          FROM public.harang_production_lines ln2
          INNER JOIN public.harang_production_headers h2 ON h2.id = ln2.header_id
          WHERE ln2.material_category = v_line.material_category
            AND ln2.material_id = v_line.material_id
            AND h2.production_date = v_hdr.production_date
            AND (
              (v_hdr.request_id IS NOT NULL AND h2.request_id = v_hdr.request_id)
              OR (v_hdr.request_id IS NULL AND h2.id = v_hdr.id)
            );

          v_total_weight := COALESCE(v_total_weight, 0);

          IF v_total_weight > 0.0005 THEN
            SELECT COALESCE(h2.finished_qty, 0)::NUMERIC(14, 3) INTO v_weight
            FROM public.harang_production_headers h2
            WHERE h2.id = v_hdr.id;

            v_alloc_qty := round(
              (v_pool.pool_qty * COALESCE(v_weight, 0) / v_total_weight)::NUMERIC,
              3
            );
          END IF;
        END IF;
      ELSE
        v_alloc_qty := COALESCE(v_pool.pool_qty, 0);
      END IF;

      v_alloc_qty := COALESCE(v_alloc_qty, 0);

      IF v_alloc_qty <= 0.0005 THEN
        CONTINUE;
      END IF;

      INSERT INTO public.harang_production_line_lots (line_id, lot_id, quantity_used)
      VALUES (v_line.line_id, v_pool.lot_id, v_alloc_qty);

      v_line_lots_inserted := v_line_lots_inserted + 1;
      v_line_total := v_line_total + v_alloc_qty;
    END LOOP;

    SELECT string_agg(d, ' · ' ORDER BY d) INTO v_summary
    FROM (
      SELECT DISTINCT to_char(l.lot_date, 'YYYY.MM.DD') AS d
      FROM public.harang_production_line_lots pl
      INNER JOIN public.harang_inventory_lots l ON l.id = pl.lot_id
      WHERE pl.line_id = v_line.line_id
    ) s;

    UPDATE public.harang_production_lines
    SET
      usage_qty = round(COALESCE(v_line_total, 0)::NUMERIC, 3),
      lot_dates_summary = v_summary
    WHERE id = v_line.line_id;

    v_lines_updated := v_lines_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'lines_updated', v_lines_updated,
    'line_lots_removed', v_line_lots_removed,
    'line_lots_inserted', v_line_lots_inserted,
    'message', '생산입고 LOT 배분을 원장(소비기한) 기준으로 재연결했습니다.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.harang_reconcile_production_lots_from_ledger() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) 원장 vs line_lots 불일치 목록 (정합 후 점검)
--    · 동일 생산일+작업지시의 원장은 생산입고별로 쪼개지므로, 라인별로 원장 전체를
--      비교하면 오탐이 난다. 단일 생산입고만 qty 비교, 복수 건은 풀 합계만 검사.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harang_list_production_ledger_line_lot_mismatches()
RETURNS TABLE (
  production_header_id UUID,
  production_date DATE,
  production_no TEXT,
  material_name TEXT,
  lot_date DATE,
  ledger_qty NUMERIC(14, 3),
  line_lot_qty NUMERIC(14, 3),
  issue_type TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH hdr AS (
    SELECT
      h.id AS header_id,
      h.production_date,
      h.production_no,
      h.request_id,
      COALESCE(h.request_id, h.id) AS pool_key,
      r.request_no,
      ln.id AS line_id,
      ln.material_name,
      ln.material_category,
      ln.material_id
    FROM public.harang_production_headers h
    INNER JOIN public.harang_production_lines ln ON ln.header_id = h.id
    LEFT JOIN public.harang_production_requests r ON r.id = h.request_id
  ),
  ledger_pool AS (
    SELECT
      t.tx_date AS production_date,
      COALESCE(
        (SELECT r.id FROM public.harang_production_requests r WHERE r.request_no = t.reference_no),
        (SELECT h.id FROM public.harang_production_headers h WHERE h.production_no = t.reference_no LIMIT 1)
      ) AS pool_key,
      l.category AS material_category,
      l.item_id AS material_id,
      l.lot_date,
      COALESCE(SUM(-t.quantity_delta), 0)::NUMERIC(14, 3) AS pool_qty
    FROM public.harang_inventory_transactions t
    INNER JOIN public.harang_inventory_lots l ON l.id = t.lot_id
    WHERE t.tx_type = 'usage'
      AND t.quantity_delta < 0
    GROUP BY 1, 2, 3, 4, 5
  ),
  pool_headers AS (
    SELECT
      h.production_date,
      COALESCE(h.request_id, h.id) AS pool_key,
      ln.material_category,
      ln.material_id,
      COUNT(DISTINCT h.id)::INTEGER AS header_count
    FROM public.harang_production_headers h
    INNER JOIN public.harang_production_lines ln ON ln.header_id = h.id
    GROUP BY 1, 2, 3, 4
  ),
  line_lots AS (
    SELECT
      hdr.header_id,
      hdr.production_date,
      hdr.production_no,
      hdr.pool_key,
      hdr.line_id,
      hdr.material_name,
      hdr.material_category,
      hdr.material_id,
      l.lot_date,
      COALESCE(SUM(pl.quantity_used), 0)::NUMERIC(14, 3) AS qty
    FROM hdr
    INNER JOIN public.harang_production_line_lots pl ON pl.line_id = hdr.line_id
    INNER JOIN public.harang_inventory_lots l ON l.id = pl.lot_id
    GROUP BY
      hdr.header_id, hdr.production_date, hdr.production_no, hdr.pool_key,
      hdr.line_id, hdr.material_name, hdr.material_category, hdr.material_id, l.lot_date
  ),
  pool_line_sum AS (
    SELECT
      ll.pool_key,
      ll.production_date,
      ll.material_category,
      ll.material_id,
      ll.lot_date,
      COALESCE(SUM(ll.qty), 0)::NUMERIC(14, 3) AS line_sum
    FROM line_lots ll
    GROUP BY 1, 2, 3, 4, 5
  ),
  phantom AS (
    SELECT
      ll.header_id,
      ll.production_date,
      ll.production_no,
      ll.material_name,
      ll.lot_date,
      0::NUMERIC(14, 3) AS ledger_qty,
      ll.qty AS line_lot_qty,
      'phantom_line_lot'::TEXT AS issue_type
    FROM line_lots ll
  WHERE NOT EXISTS (
      SELECT 1
      FROM public.harang_inventory_transactions t
      INNER JOIN public.harang_inventory_lots l ON l.id = t.lot_id
      INNER JOIN hdr ON hdr.line_id = ll.line_id
      WHERE t.lot_id IN (
          SELECT pl.lot_id
          FROM public.harang_production_line_lots pl
          INNER JOIN public.harang_inventory_lots l2 ON l2.id = pl.lot_id
          WHERE pl.line_id = ll.line_id AND l2.lot_date = ll.lot_date
        )
        AND t.tx_type = 'usage'
        AND t.quantity_delta < 0
        AND t.tx_date = hdr.production_date
        AND l.lot_date = ll.lot_date
        AND l.category = hdr.material_category
        AND l.item_id = hdr.material_id
        AND (
          (hdr.request_no IS NOT NULL AND t.reference_no = hdr.request_no)
          OR t.reference_no = hdr.production_no
        )
    )
    AND ll.qty > 0.5
  ),
  single_header_mismatch AS (
    SELECT
      ll.header_id,
      ll.production_date,
      ll.production_no,
      ll.material_name,
      ll.lot_date,
      COALESCE(lp.pool_qty, 0) AS ledger_qty,
      ll.qty AS line_lot_qty,
      'qty_mismatch'::TEXT AS issue_type
    FROM line_lots ll
    INNER JOIN pool_headers ph
      ON ph.production_date = ll.production_date
      AND ph.pool_key = ll.pool_key
      AND ph.material_category = ll.material_category
      AND ph.material_id = ll.material_id
    LEFT JOIN ledger_pool lp
      ON lp.production_date = ll.production_date
      AND lp.pool_key = ll.pool_key
      AND lp.material_category = ll.material_category
      AND lp.material_id = ll.material_id
      AND lp.lot_date = ll.lot_date
    WHERE ph.header_count = 1
      AND abs(COALESCE(lp.pool_qty, 0) - ll.qty) > 0.5
  ),
  pool_imbalance AS (
    SELECT
      hdr.header_id,
      pls.production_date,
      hdr.production_no,
      hdr.material_name,
      pls.lot_date,
      COALESCE(lp.pool_qty, 0) AS ledger_qty,
      pls.line_sum AS line_lot_qty,
      'pool_imbalance'::TEXT AS issue_type
    FROM pool_line_sum pls
    INNER JOIN pool_headers ph
      ON ph.production_date = pls.production_date
      AND ph.pool_key = pls.pool_key
      AND ph.material_category = pls.material_category
      AND ph.material_id = pls.material_id
    INNER JOIN hdr
      ON hdr.production_date = pls.production_date
      AND hdr.pool_key = pls.pool_key
      AND hdr.material_category = pls.material_category
      AND hdr.material_id = pls.material_id
    LEFT JOIN ledger_pool lp
      ON lp.production_date = pls.production_date
      AND lp.pool_key = pls.pool_key
      AND lp.material_category = pls.material_category
      AND lp.material_id = pls.material_id
      AND lp.lot_date = pls.lot_date
    WHERE ph.header_count > 1
      AND abs(COALESCE(lp.pool_qty, 0) - pls.line_sum) > 0.5
    GROUP BY
      hdr.header_id, pls.production_date, hdr.production_no, hdr.material_name,
      pls.lot_date, lp.pool_qty, pls.line_sum
  ),
  missing_line AS (
    SELECT
      hdr.header_id,
      lp.production_date,
      hdr.production_no,
      hdr.material_name,
      lp.lot_date,
      lp.pool_qty AS ledger_qty,
      0::NUMERIC(14, 3) AS line_lot_qty,
      'missing_line_lot'::TEXT AS issue_type
    FROM ledger_pool lp
    INNER JOIN hdr
      ON hdr.production_date = lp.production_date
      AND hdr.pool_key = lp.pool_key
      AND hdr.material_category = lp.material_category
      AND hdr.material_id = lp.material_id
    INNER JOIN pool_headers ph
      ON ph.production_date = lp.production_date
      AND ph.pool_key = lp.pool_key
      AND ph.material_category = lp.material_category
      AND ph.material_id = lp.material_id
    LEFT JOIN pool_line_sum pls
      ON pls.production_date = lp.production_date
      AND pls.pool_key = lp.pool_key
      AND pls.material_category = lp.material_category
      AND pls.material_id = lp.material_id
      AND pls.lot_date = lp.lot_date
    LEFT JOIN line_lots ll
      ON ll.line_id = hdr.line_id
      AND ll.lot_date = lp.lot_date
    WHERE lp.pool_qty > 0.5
      AND COALESCE(pls.line_sum, 0) <= 0.5
      AND ph.header_count = 1
      AND COALESCE(ll.qty, 0) <= 0.5
  )
  SELECT * FROM phantom
  UNION ALL
  SELECT * FROM single_header_mismatch
  UNION ALL
  SELECT * FROM pool_imbalance
  UNION ALL
  SELECT * FROM missing_line
  ORDER BY production_date DESC, production_no, material_name, lot_date;
$$;

GRANT EXECUTE ON FUNCTION public.harang_list_production_ledger_line_lot_mismatches() TO authenticated;

NOTIFY pgrst, 'reload schema';
