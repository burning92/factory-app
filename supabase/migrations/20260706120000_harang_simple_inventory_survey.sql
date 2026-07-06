-- ============================================================
-- 하랑 간편 재고: 재고조사 스냅샷 + 실사 기준 소모량 리포트
--
-- [안전] 이 마이그레이션은 신규 테이블·함수만 추가합니다.
--   - 기존 테이블 DROP/ALTER 없음 (신규 2테이블만 CREATE)
--   - 기존 데이터 DELETE/UPDATE 없음
--   - inventory_transactions / inventory_lots / production 테이블 미수정
--   - sync / backfill / reconcile / revert 호출 없음
--
-- 역할: 실사 스냅샷 저장 + (전 조사 + 기간 inbound − 현 조사) 소모량 리포트
-- BOM·생산입력·usage·adjustment·current_quantity는 사용·변경하지 않음
-- ============================================================

CREATE TABLE IF NOT EXISTS public.harang_inventory_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_date DATE NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  note TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_harang_inventory_surveys_date
  ON public.harang_inventory_surveys (survey_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_harang_inventory_surveys_status
  ON public.harang_inventory_surveys (status, survey_date DESC);

COMMENT ON TABLE public.harang_inventory_surveys IS
  '간편 재고조사 세션. 확정 시 LOT별 실사 수량 스냅샷만 저장 (생산/BOM 추적 없음).';

CREATE TABLE IF NOT EXISTS public.harang_inventory_survey_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES public.harang_inventory_surveys(id) ON DELETE CASCADE,
  lot_id UUID NOT NULL REFERENCES public.harang_inventory_lots(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK (category IN ('raw_material', 'packaging_material')),
  item_id UUID NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  lot_date DATE NOT NULL,
  unit TEXT NOT NULL,
  physical_qty NUMERIC(14, 3) NOT NULL CHECK (physical_qty >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (survey_id, lot_id)
);

CREATE INDEX IF NOT EXISTS idx_harang_inventory_survey_lines_survey
  ON public.harang_inventory_survey_lines (survey_id);

CREATE INDEX IF NOT EXISTS idx_harang_inventory_survey_lines_item
  ON public.harang_inventory_survey_lines (item_id, lot_date);

COMMENT ON TABLE public.harang_inventory_survey_lines IS
  '재고조사 LOT별 실사 수량. 리포트는 품목+소비기한(lot_date) 단위로 합산.';

DROP TRIGGER IF EXISTS set_harang_inventory_surveys_updated_at ON public.harang_inventory_surveys;
CREATE TRIGGER set_harang_inventory_surveys_updated_at
  BEFORE UPDATE ON public.harang_inventory_surveys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_harang_inventory_survey_lines_updated_at ON public.harang_inventory_survey_lines;
CREATE TRIGGER set_harang_inventory_survey_lines_updated_at
  BEFORE UPDATE ON public.harang_inventory_survey_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.harang_inventory_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harang_inventory_survey_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "harang_inventory_surveys_select" ON public.harang_inventory_surveys;
DROP POLICY IF EXISTS "harang_inventory_surveys_write" ON public.harang_inventory_surveys;
CREATE POLICY "harang_inventory_surveys_select"
  ON public.harang_inventory_surveys FOR SELECT TO authenticated
  USING (public.can_access_harang_data() OR public.is_headquarters_organization());
CREATE POLICY "harang_inventory_surveys_write"
  ON public.harang_inventory_surveys FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

DROP POLICY IF EXISTS "harang_inventory_survey_lines_select" ON public.harang_inventory_survey_lines;
DROP POLICY IF EXISTS "harang_inventory_survey_lines_write" ON public.harang_inventory_survey_lines;
CREATE POLICY "harang_inventory_survey_lines_select"
  ON public.harang_inventory_survey_lines FOR SELECT TO authenticated
  USING (public.can_access_harang_data() OR public.is_headquarters_organization());
CREATE POLICY "harang_inventory_survey_lines_write"
  ON public.harang_inventory_survey_lines FOR ALL TO authenticated
  USING (public.can_write_harang_ops())
  WITH CHECK (public.can_write_harang_ops());

-- 확정: draft → confirmed
-- [안전] harang_inventory_surveys.status/confirmed_at/confirmed_by 만 변경.
--   line_lots는 저장 시점에 이미 survey_lines에 있음. 원장·LOT 캐시·생산 데이터 미접촉.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_harang_inventory_survey(p_survey_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_survey RECORD;
  v_line_count INT;
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  SELECT * INTO v_survey
  FROM public.harang_inventory_surveys
  WHERE id = p_survey_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '재고조사를 찾을 수 없습니다.';
  END IF;
  IF v_survey.status = 'confirmed' THEN
    RAISE EXCEPTION '이미 확정된 재고조사입니다.';
  END IF;

  SELECT COUNT(*) INTO v_line_count
  FROM public.harang_inventory_survey_lines
  WHERE survey_id = p_survey_id;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION '실사 라인이 없습니다. LOT별 수량을 입력하세요.';
  END IF;

  -- 전체 LOT 스냅샷: 마스터에 있는 모든 LOT마다 실사 line 필수 (0 포함, NULL/누락 불가)
  IF EXISTS (
    SELECT 1
    FROM public.harang_inventory_lots l
    LEFT JOIN public.harang_inventory_survey_lines sl
      ON sl.survey_id = p_survey_id AND sl.lot_id = l.id
    WHERE sl.id IS NULL
  ) THEN
    RAISE EXCEPTION '조사 대상 LOT 중 실사 수량이 누락된 항목이 있습니다. 0 재고 LOT도 0으로 입력 후 저장하세요.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.harang_inventory_survey_lines sl
    WHERE sl.survey_id = p_survey_id
      AND sl.physical_qty IS NULL
  ) THEN
    RAISE EXCEPTION '실사 수량이 NULL인 line이 있습니다. 저장 후 다시 확정하세요.';
  END IF;

  UPDATE public.harang_inventory_surveys
  SET status = 'confirmed',
      confirmed_at = now(),
      confirmed_by = v_uid,
      updated_at = now()
  WHERE id = p_survey_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_harang_inventory_survey(UUID) TO authenticated;

-- 조사 구간별 소모량 리포트 (품목 + 소비기한 LOT)
-- 계산: 전 조사 snapshot + (전 조사일 < tx_date <= 현 조사일) inbound ONLY − 현 조사 snapshot
-- 첫 번째 확정 조사(rn=1)는 pairs에 포함되지 않음 → baseline, 소모량 없음
-- usage / adjustment / disposal / production / line_lots / current_quantity 미사용
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harang_list_survey_consumption_report(
  p_month TEXT DEFAULT NULL,
  p_item_id UUID DEFAULT NULL
)
RETURNS TABLE (
  period_label TEXT,
  prev_survey_id UUID,
  prev_survey_date DATE,
  curr_survey_id UUID,
  curr_survey_date DATE,
  category TEXT,
  item_id UUID,
  item_name TEXT,
  unit TEXT,
  lot_date DATE,
  prev_physical NUMERIC(14, 3),
  period_inbound NUMERIC(14, 3),
  curr_physical NUMERIC(14, 3),
  calculated_consumption NUMERIC(14, 3)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.can_access_harang_data() OR public.is_headquarters_organization()) THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  RETURN QUERY
  WITH confirmed AS (
    SELECT
      s.id,
      s.survey_date,
      s.title,
      s.confirmed_at,
      s.created_at,
      ROW_NUMBER() OVER (
        ORDER BY s.survey_date ASC, s.confirmed_at ASC NULLS LAST, s.created_at ASC
      ) AS rn
    FROM public.harang_inventory_surveys s
    WHERE s.status = 'confirmed'
  ),
  pairs AS (
    SELECT
      curr.id AS curr_id,
      curr.survey_date AS curr_date,
      curr.title AS curr_title,
      prev.id AS prev_id,
      prev.survey_date AS prev_date,
      prev.title AS prev_title
    FROM confirmed curr
    INNER JOIN confirmed prev ON prev.rn = curr.rn - 1
  ),
  prev_agg AS (
    SELECT
      p.curr_id,
      sl.category AS line_category,
      sl.item_id AS line_item_id,
      sl.item_name AS line_item_name,
      sl.unit AS line_unit,
      sl.lot_date AS line_lot_date,
      COALESCE(SUM(sl.physical_qty), 0)::NUMERIC(14, 3) AS qty
    FROM pairs p
    JOIN public.harang_inventory_survey_lines sl ON sl.survey_id = p.prev_id
    GROUP BY p.curr_id, sl.category, sl.item_id, sl.item_name, sl.unit, sl.lot_date
  ),
  curr_agg AS (
    SELECT
      p.curr_id,
      sl.category AS line_category,
      sl.item_id AS line_item_id,
      sl.item_name AS line_item_name,
      sl.unit AS line_unit,
      sl.lot_date AS line_lot_date,
      COALESCE(SUM(sl.physical_qty), 0)::NUMERIC(14, 3) AS qty
    FROM pairs p
    JOIN public.harang_inventory_survey_lines sl ON sl.survey_id = p.curr_id
    GROUP BY p.curr_id, sl.category, sl.item_id, sl.item_name, sl.unit, sl.lot_date
  ),
  keys AS (
    SELECT curr_id, line_category, line_item_id, line_item_name, line_unit, line_lot_date FROM prev_agg
    UNION
    SELECT curr_id, line_category, line_item_id, line_item_name, line_unit, line_lot_date FROM curr_agg
    UNION
    -- 기간 중 inbound만 있고 전/현 조사 line에 없는 품목+소비기한 (케이스 B/D)
    SELECT
      p.curr_id,
      l.category AS line_category,
      l.item_id AS line_item_id,
      l.item_name AS line_item_name,
      l.unit AS line_unit,
      l.lot_date AS line_lot_date
    FROM pairs p
    JOIN public.harang_inventory_transactions t
      ON t.tx_type = 'inbound'
     AND t.tx_date > p.prev_date
     AND t.tx_date <= p.curr_date
    JOIN public.harang_inventory_lots l ON l.id = t.lot_id
  ),
  inbound AS (
    -- 기간 중 입고: 전 조사일 다음날(>) ~ 현 조사일(<=) inbound만
    SELECT
      p.curr_id,
      l.category AS line_category,
      l.item_id AS line_item_id,
      l.lot_date AS line_lot_date,
      COALESCE(SUM(t.quantity_delta), 0)::NUMERIC(14, 3) AS qty
    FROM pairs p
    JOIN public.harang_inventory_transactions t
      ON t.tx_type = 'inbound'
     AND t.tx_date > p.prev_date
     AND t.tx_date <= p.curr_date
    JOIN public.harang_inventory_lots l ON l.id = t.lot_id
    GROUP BY p.curr_id, l.category, l.item_id, l.lot_date
  )
  SELECT
    to_char(p.prev_date, 'YYYY.MM.DD') || ' ~ ' || to_char(p.curr_date, 'YYYY.MM.DD') AS period_label,
    p.prev_id AS prev_survey_id,
    p.prev_date AS prev_survey_date,
    p.curr_id AS curr_survey_id,
    p.curr_date AS curr_survey_date,
    k.line_category AS category,
    k.line_item_id AS item_id,
    k.line_item_name AS item_name,
    k.line_unit AS unit,
    k.line_lot_date AS lot_date,
    COALESCE(pa.qty, 0) AS prev_physical,
    COALESCE(ib.qty, 0) AS period_inbound,
    COALESCE(ca.qty, 0) AS curr_physical,
    (COALESCE(pa.qty, 0) + COALESCE(ib.qty, 0) - COALESCE(ca.qty, 0))::NUMERIC(14, 3) AS calculated_consumption
  FROM pairs p
  JOIN keys k ON k.curr_id = p.curr_id
  LEFT JOIN prev_agg pa
    ON pa.curr_id = k.curr_id
   AND pa.line_category = k.line_category
   AND pa.line_item_id = k.line_item_id
   AND pa.line_lot_date = k.line_lot_date
  LEFT JOIN curr_agg ca
    ON ca.curr_id = k.curr_id
   AND ca.line_category = k.line_category
   AND ca.line_item_id = k.line_item_id
   AND ca.line_lot_date = k.line_lot_date
  LEFT JOIN inbound ib
    ON ib.curr_id = k.curr_id
   AND ib.line_category = k.line_category
   AND ib.line_item_id = k.line_item_id
   AND ib.line_lot_date = k.line_lot_date
  WHERE (p_month IS NULL OR to_char(p.curr_date, 'YYYY-MM') = p_month)
    AND (p_item_id IS NULL OR k.line_item_id = p_item_id)
  ORDER BY p.curr_date DESC, k.line_item_name, k.line_lot_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.harang_list_survey_consumption_report(TEXT, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 월별 품목 소모량 + 월말 재고 (lot_date 합산)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.harang_list_survey_monthly_item_summary(
  p_month TEXT DEFAULT NULL
)
RETURNS TABLE (
  month_label TEXT,
  category TEXT,
  item_id UUID,
  item_name TEXT,
  unit TEXT,
  total_consumption NUMERIC(14, 3),
  month_end_stock NUMERIC(14, 3),
  last_survey_date DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.can_access_harang_data() OR public.is_headquarters_organization()) THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  RETURN QUERY
  WITH detail AS (
    SELECT
      d.period_label,
      d.prev_survey_id,
      d.prev_survey_date,
      d.curr_survey_id,
      d.curr_survey_date,
      d.category AS rpt_category,
      d.item_id AS rpt_item_id,
      d.item_name AS rpt_item_name,
      d.unit AS rpt_unit,
      d.lot_date AS rpt_lot_date,
      d.prev_physical,
      d.period_inbound,
      d.curr_physical,
      d.calculated_consumption
    FROM public.harang_list_survey_consumption_report(p_month, NULL) AS d
  ),
  month_end AS (
    SELECT DISTINCT ON (d.month_key, d.rpt_item_id)
      d.month_key,
      d.rpt_item_id,
      d.rpt_category,
      d.rpt_item_name,
      d.rpt_unit,
      d.curr_survey_date,
      SUM(d.curr_physical) OVER (
        PARTITION BY d.month_key, d.rpt_item_id, d.curr_survey_id
      )::NUMERIC(14, 3) AS end_stock
    FROM (
      SELECT
        to_char(curr_survey_date, 'YYYY-MM') AS month_key,
        detail.*
      FROM detail
    ) d
    ORDER BY d.month_key, d.rpt_item_id, d.curr_survey_date DESC
  )
  SELECT
    d.month_key AS month_label,
    d.rpt_category AS category,
    d.rpt_item_id AS item_id,
    d.rpt_item_name AS item_name,
    d.rpt_unit AS unit,
    SUM(d.calculated_consumption)::NUMERIC(14, 3) AS total_consumption,
    me.end_stock AS month_end_stock,
    me.curr_survey_date AS last_survey_date
  FROM (
    SELECT to_char(curr_survey_date, 'YYYY-MM') AS month_key, detail.*
    FROM detail
  ) d
  LEFT JOIN month_end me ON me.month_key = d.month_key AND me.rpt_item_id = d.rpt_item_id
  GROUP BY d.month_key, d.rpt_category, d.rpt_item_id, d.rpt_item_name, d.rpt_unit, me.end_stock, me.curr_survey_date
  ORDER BY d.month_key DESC, d.rpt_item_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.harang_list_survey_monthly_item_summary(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
