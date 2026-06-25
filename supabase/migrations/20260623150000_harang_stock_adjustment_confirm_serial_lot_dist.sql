-- Fix confirm: include all physical LOTs; distribute delta only to productions that used each serial LOT

CREATE OR REPLACE FUNCTION public.confirm_harang_stock_cycle_adjustment(p_session_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session RECORD;
  v_ref TEXT;
  v_serial RECORD;
  v_lot RECORD;
  v_header RECORD;
  v_line RECORD;
  v_pl RECORD;
  v_result_id UUID;
  v_inbound NUMERIC(14, 3);
  v_physical NUMERIC(14, 3);
  v_bom NUMERIC(14, 3);
  v_actual NUMERIC(14, 3);
  v_system NUMERIC(14, 3);
  v_delta NUMERIC(14, 3);
  v_target_delta INTEGER;
  v_assigned INTEGER;
  v_hdr_delta INTEGER;
  v_pl_sum NUMERIC(14, 3);
  v_pl_assigned NUMERIC(14, 3);
  v_pl_add NUMERIC(14, 3);
  v_old_qty NUMERIC(14, 3);
  v_new_qty NUMERIC(14, 3);
  v_phys_assigned NUMERIC(14, 3);
  v_phys_part NUMERIC(14, 3);
  v_lot_count INTEGER;
  v_lot_idx INTEGER;
  v_ratio NUMERIC(10, 2);
  v_header_ids UUID[];
  v_total_finished NUMERIC(14, 3);
  v_has_lot_usage BOOLEAN;
  v_part_count INTEGER;
  v_part_idx INTEGER;
  v_part_weight NUMERIC(14, 3);
  v_total_part_weight NUMERIC(14, 3);
BEGIN
  IF NOT public.can_write_harang_stock_adjustment() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  SELECT * INTO v_session
  FROM public.harang_stock_adjustment_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '조정 세션을 찾을 수 없습니다.';
  END IF;
  IF v_session.status <> 'draft' THEN
    RAISE EXCEPTION '이미 확정되었거나 확정할 수 없는 세션입니다.';
  END IF;
  IF v_session.adjustment_type <> 'production_cycle' THEN
    RAISE EXCEPTION '생산 사이클 조정만 확정할 수 있습니다.';
  END IF;

  SELECT array_agg(t.production_header_id ORDER BY t.production_header_id)
    INTO v_header_ids
  FROM public.harang_stock_adjustment_production_targets t
  WHERE t.session_id = p_session_id;

  IF v_header_ids IS NULL OR array_length(v_header_ids, 1) IS NULL THEN
    RAISE EXCEPTION '분배 대상 생산입고가 없습니다.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.harang_stock_adjustment_lot_physical lp WHERE lp.session_id = p_session_id
  ) THEN
    RAISE EXCEPTION '실사 수량이 입력된 LOT가 없습니다.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.harang_stock_adjustment_production_targets t
    INNER JOIN public.harang_stock_adjustment_sessions s ON s.id = t.session_id
    WHERE t.production_header_id = ANY(v_header_ids)
      AND s.status = 'confirmed'
      AND s.id <> p_session_id
  ) THEN
    RAISE EXCEPTION '이미 조정 완료된 생산입고가 포함되어 있습니다.';
  END IF;

  v_ref := 'SA-' || left(replace(p_session_id::TEXT, '-', ''), 12);

  SELECT COALESCE(SUM(h.finished_qty), 0) INTO v_total_finished
  FROM public.harang_production_headers h
  WHERE h.id = ANY(v_header_ids);

  IF v_total_finished <= 0 THEN
    RAISE EXCEPTION '생산입고 수량 합계가 0입니다.';
  END IF;

  FOR v_serial IN
    SELECT
      l.category AS material_category,
      l.item_id AS material_id,
      MAX(l.item_name) AS material_name,
      MAX(l.unit) AS unit,
      l.lot_date,
      COALESCE(SUM(lp.physical_qty), 0)::NUMERIC(14, 3) AS physical_qty,
      COALESCE(SUM(l.initial_quantity), 0)::NUMERIC(14, 3) AS inbound_qty,
      array_agg(l.id ORDER BY l.inbound_date, l.id) AS lot_ids
    FROM public.harang_stock_adjustment_lot_physical lp
    INNER JOIN public.harang_inventory_lots l ON l.id = lp.lot_id
    WHERE lp.session_id = p_session_id
    GROUP BY l.category, l.item_id, l.lot_date
  LOOP
    v_inbound := v_serial.inbound_qty;
    v_physical := v_serial.physical_qty;
    v_actual := v_inbound - v_physical;

    SELECT COALESCE(SUM(pl.quantity_used), 0)::NUMERIC(14, 3) INTO v_bom
    FROM public.harang_production_line_lots pl
    INNER JOIN public.harang_production_lines ln ON ln.id = pl.line_id
    WHERE ln.header_id = ANY(v_header_ids)
      AND ln.material_category = v_serial.material_category
      AND ln.material_id = v_serial.material_id
      AND pl.lot_id = ANY(v_serial.lot_ids);

    v_system := v_inbound - v_bom;
    v_delta := v_actual - v_bom;
    v_target_delta := round(v_delta)::INTEGER;
    v_ratio := CASE
      WHEN v_bom > 0 THEN round((v_actual / v_bom) * 100::NUMERIC, 2)
      ELSE NULL
    END;

    INSERT INTO public.harang_stock_adjustment_serial_results (
      session_id,
      material_category,
      material_id,
      material_name,
      unit,
      lot_date,
      inbound_qty,
      physical_qty,
      system_stock_qty,
      bom_usage_qty,
      actual_usage_qty,
      usage_delta_qty,
      consumption_ratio_pct
    )
    VALUES (
      p_session_id,
      v_serial.material_category,
      v_serial.material_id,
      v_serial.material_name,
      v_serial.unit,
      v_serial.lot_date,
      v_inbound,
      v_physical,
      v_system,
      v_bom,
      v_actual,
      v_target_delta,
      v_ratio
    )
    RETURNING id INTO v_result_id;

    IF v_target_delta <> 0 THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.harang_production_line_lots pl
        INNER JOIN public.harang_production_lines ln ON ln.id = pl.line_id
        WHERE ln.header_id = ANY(v_header_ids)
          AND ln.material_category = v_serial.material_category
          AND ln.material_id = v_serial.material_id
          AND pl.lot_id = ANY(v_serial.lot_ids)
          AND pl.quantity_used > 0
      ) INTO v_has_lot_usage;

      v_assigned := 0;
      v_part_idx := 0;

      IF v_has_lot_usage THEN
        SELECT
          COUNT(*)::INTEGER,
          COALESCE(SUM(u.lot_usage), 0)::NUMERIC(14, 3)
        INTO v_part_count, v_total_part_weight
        FROM (
          SELECT ln.header_id, SUM(pl.quantity_used)::NUMERIC(14, 3) AS lot_usage
          FROM public.harang_production_line_lots pl
          INNER JOIN public.harang_production_lines ln ON ln.id = pl.line_id
          WHERE ln.header_id = ANY(v_header_ids)
            AND ln.material_category = v_serial.material_category
            AND ln.material_id = v_serial.material_id
            AND pl.lot_id = ANY(v_serial.lot_ids)
            AND pl.quantity_used > 0
          GROUP BY ln.header_id
        ) u;

        FOR v_header IN
          SELECT h.id, h.finished_qty, u.lot_usage
          FROM (
            SELECT ln.header_id, SUM(pl.quantity_used)::NUMERIC(14, 3) AS lot_usage
            FROM public.harang_production_line_lots pl
            INNER JOIN public.harang_production_lines ln ON ln.id = pl.line_id
            WHERE ln.header_id = ANY(v_header_ids)
              AND ln.material_category = v_serial.material_category
              AND ln.material_id = v_serial.material_id
              AND pl.lot_id = ANY(v_serial.lot_ids)
              AND pl.quantity_used > 0
            GROUP BY ln.header_id
          ) u
          INNER JOIN public.harang_production_headers h ON h.id = u.header_id
          ORDER BY h.id
        LOOP
          v_part_idx := v_part_idx + 1;
          v_part_weight := v_header.lot_usage;

          IF v_part_idx = v_part_count THEN
            v_hdr_delta := v_target_delta - v_assigned;
          ELSE
            v_hdr_delta := round((v_target_delta * v_part_weight) / v_total_part_weight)::INTEGER;
            v_assigned := v_assigned + v_hdr_delta;
          END IF;

          IF v_hdr_delta = 0 THEN
            CONTINUE;
          END IF;

          INSERT INTO public.harang_stock_adjustment_production_deltas (
            session_id, serial_result_id, production_header_id, usage_delta_qty
          )
          VALUES (p_session_id, v_result_id, v_header.id, v_hdr_delta);

          SELECT ln.id INTO v_line
          FROM public.harang_production_lines ln
          WHERE ln.header_id = v_header.id
            AND ln.material_category = v_serial.material_category
            AND ln.material_id = v_serial.material_id
          FOR UPDATE;

          IF NOT FOUND THEN
            CONTINUE;
          END IF;

          UPDATE public.harang_production_lines
          SET usage_qty = usage_qty + v_hdr_delta
          WHERE id = v_line.id;

          SELECT COALESCE(SUM(pl.quantity_used), 0) INTO v_pl_sum
          FROM public.harang_production_line_lots pl
          WHERE pl.line_id = v_line.id
            AND pl.lot_id = ANY(v_serial.lot_ids);

          v_pl_assigned := 0;

          IF v_pl_sum > 0 THEN
            FOR v_pl IN
              SELECT pl.id, pl.quantity_used
              FROM public.harang_production_line_lots pl
              WHERE pl.line_id = v_line.id
                AND pl.lot_id = ANY(v_serial.lot_ids)
              ORDER BY pl.id
            LOOP
              IF v_pl.id = (
                SELECT pl2.id
                FROM public.harang_production_line_lots pl2
                WHERE pl2.line_id = v_line.id AND pl2.lot_id = ANY(v_serial.lot_ids)
                ORDER BY pl2.id DESC
                LIMIT 1
              ) THEN
                v_pl_add := v_hdr_delta - v_pl_assigned;
              ELSE
                v_pl_add := round((v_hdr_delta * v_pl.quantity_used) / v_pl_sum);
                v_pl_assigned := v_pl_assigned + v_pl_add;
              END IF;

              UPDATE public.harang_production_line_lots
              SET quantity_used = GREATEST(0, quantity_used + v_pl_add)
              WHERE id = v_pl.id;
            END LOOP;
          END IF;
        END LOOP;
      ELSE
        SELECT
          COUNT(*)::INTEGER,
          COALESCE(SUM(h.finished_qty), 0)::NUMERIC(14, 3)
        INTO v_part_count, v_total_part_weight
        FROM public.harang_production_headers h
        INNER JOIN public.harang_production_lines ln ON ln.header_id = h.id
        WHERE h.id = ANY(v_header_ids)
          AND ln.material_category = v_serial.material_category
          AND ln.material_id = v_serial.material_id;

        FOR v_header IN
          SELECT h.id, h.finished_qty
          FROM public.harang_production_headers h
          INNER JOIN public.harang_production_lines ln ON ln.header_id = h.id
          WHERE h.id = ANY(v_header_ids)
            AND ln.material_category = v_serial.material_category
            AND ln.material_id = v_serial.material_id
          ORDER BY h.id
        LOOP
          v_part_idx := v_part_idx + 1;
          v_part_weight := v_header.finished_qty::NUMERIC(14, 3);

          IF v_part_idx = v_part_count THEN
            v_hdr_delta := v_target_delta - v_assigned;
          ELSE
            v_hdr_delta := round((v_target_delta * v_part_weight) / v_total_part_weight)::INTEGER;
            v_assigned := v_assigned + v_hdr_delta;
          END IF;

          IF v_hdr_delta = 0 THEN
            CONTINUE;
          END IF;

          INSERT INTO public.harang_stock_adjustment_production_deltas (
            session_id, serial_result_id, production_header_id, usage_delta_qty
          )
          VALUES (p_session_id, v_result_id, v_header.id, v_hdr_delta);

          SELECT ln.id INTO v_line
          FROM public.harang_production_lines ln
          WHERE ln.header_id = v_header.id
            AND ln.material_category = v_serial.material_category
            AND ln.material_id = v_serial.material_id
          FOR UPDATE;

          IF NOT FOUND THEN
            CONTINUE;
          END IF;

          UPDATE public.harang_production_lines
          SET usage_qty = usage_qty + v_hdr_delta
          WHERE id = v_line.id;
        END LOOP;
      END IF;
    END IF;

    v_phys_assigned := 0;
    SELECT COUNT(*)::INTEGER INTO v_lot_count
    FROM public.harang_inventory_lots l
    WHERE l.id = ANY(v_serial.lot_ids);

    v_lot_idx := 0;

    FOR v_lot IN
      SELECT l.*
      FROM public.harang_inventory_lots l
      WHERE l.id = ANY(v_serial.lot_ids)
      ORDER BY l.inbound_date, l.id
      FOR UPDATE
    LOOP
      v_lot_idx := v_lot_idx + 1;
      SELECT COALESCE(lp.physical_qty, 0) INTO v_new_qty
      FROM public.harang_stock_adjustment_lot_physical lp
      WHERE lp.session_id = p_session_id AND lp.lot_id = v_lot.id;

      IF v_new_qty IS NULL OR v_new_qty < 0 THEN
        IF v_lot_idx = v_lot_count THEN
          v_new_qty := v_physical - v_phys_assigned;
        ELSE
          v_phys_part := round((v_physical * v_lot.initial_quantity) / NULLIF(v_inbound, 0));
          IF v_inbound <= 0 THEN
            v_phys_part := round(v_physical / v_lot_count);
          END IF;
          v_new_qty := v_phys_part;
          v_phys_assigned := v_phys_assigned + v_new_qty;
        END IF;
      END IF;

      v_old_qty := v_lot.current_quantity;

      UPDATE public.harang_inventory_lots
      SET current_quantity = GREATEST(0, v_new_qty)
      WHERE id = v_lot.id;

      IF abs(v_new_qty - v_old_qty) > 0.0005 THEN
        INSERT INTO public.harang_inventory_transactions (
          category, item_id, item_code, item_name, lot_id,
          tx_date, tx_type, reference_no, quantity_delta, unit, note
        )
        VALUES (
          v_lot.category,
          v_lot.item_id,
          v_lot.item_code,
          v_lot.item_name,
          v_lot.id,
          v_session.adjustment_date,
          'adjustment',
          v_ref,
          v_new_qty - v_old_qty,
          v_lot.unit,
          '재고조정 확정'
        );
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.harang_stock_adjustment_sessions
  SET
    status = 'confirmed',
    wizard_step = 4,
    confirmed_at = now()
  WHERE id = p_session_id;

  RETURN p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_harang_stock_cycle_adjustment(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
