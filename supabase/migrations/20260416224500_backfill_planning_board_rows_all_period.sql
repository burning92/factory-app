-- 전체 기간 백필:
-- production_plan_entries / notes / leaves / manpower 를 기준으로
-- production_plan_rows 를 planning_board 소스로 일괄 재구성한다.
-- 의도: 과거 월(예: 1~3월)도 "플래닝 저장 1회" 없이 즉시 planning 우선 반영되게 함.

DO $$
BEGIN
  -- 1) 플래닝 데이터가 존재하는 날짜 집합
  CREATE TEMP TABLE tmp_planning_dates ON COMMIT DROP AS
  SELECT DISTINCT x.plan_date::date AS plan_date
  FROM (
    SELECT plan_date FROM public.production_plan_entries
    UNION
    SELECT plan_date FROM public.production_plan_notes
    UNION
    SELECT plan_date FROM public.production_plan_leaves
    UNION
    SELECT plan_date FROM public.production_plan_manpower
  ) x
  WHERE x.plan_date IS NOT NULL;

  -- 2) 기존 planning_board 미러 행 제거(전체)
  DELETE FROM public.production_plan_rows
  WHERE source_sheet_name = 'planning_board';

  -- 3) 플래닝 날짜에 해당하는 기존 sync/legacy 행 제거(master만)
  DELETE FROM public.production_plan_rows r
  USING tmp_planning_dates d
  WHERE r.plan_date = d.plan_date
    AND r.plan_version = 'master'
    AND COALESCE(r.source_sheet_name, '') <> 'planning_board';

  -- 4) entries -> 생산 행
  INSERT INTO public.production_plan_rows (
    plan_date,
    product_name,
    qty,
    category,
    note,
    plan_year,
    plan_month,
    plan_version,
    source_sheet_name,
    sort_order,
    updated_at
  )
  SELECT
    e.plan_date,
    e.product_name_snapshot,
    e.qty,
    '생산'::text AS category,
    NULL::text AS note,
    EXTRACT(YEAR FROM e.plan_date)::int AS plan_year,
    EXTRACT(MONTH FROM e.plan_date)::int AS plan_month,
    'master'::text AS plan_version,
    'planning_board'::text AS source_sheet_name,
    COALESCE(e.sort_order, 0),
    now()
  FROM public.production_plan_entries e
  WHERE COALESCE(trim(e.product_name_snapshot), '') <> ''
    AND COALESCE(e.qty, 0) > 0;

  -- 5) notes -> 메모 행
  INSERT INTO public.production_plan_rows (
    plan_date,
    product_name,
    qty,
    category,
    note,
    plan_year,
    plan_month,
    plan_version,
    source_sheet_name,
    sort_order,
    updated_at
  )
  SELECT
    n.plan_date,
    '메모'::text AS product_name,
    NULL::numeric AS qty,
    '메모'::text AS category,
    n.note_text,
    EXTRACT(YEAR FROM n.plan_date)::int AS plan_year,
    EXTRACT(MONTH FROM n.plan_date)::int AS plan_month,
    'master'::text AS plan_version,
    'planning_board'::text AS source_sheet_name,
    100000 + COALESCE(n.note_order, 0),
    now()
  FROM public.production_plan_notes n
  WHERE COALESCE(trim(n.note_text), '') <> '';

  -- 6) leaves -> 연차/반차 행
  INSERT INTO public.production_plan_rows (
    plan_date,
    product_name,
    qty,
    category,
    note,
    plan_year,
    plan_month,
    plan_version,
    source_sheet_name,
    sort_order,
    updated_at
  )
  SELECT
    l.plan_date,
    l.person_name,
    NULL::numeric AS qty,
    CASE WHEN l.leave_type = 'half' THEN '반차' ELSE '연차' END AS category,
    NULL::text AS note,
    EXTRACT(YEAR FROM l.plan_date)::int AS plan_year,
    EXTRACT(MONTH FROM l.plan_date)::int AS plan_month,
    'master'::text AS plan_version,
    'planning_board'::text AS source_sheet_name,
    200000 + ROW_NUMBER() OVER (PARTITION BY l.plan_date ORDER BY l.id),
    now()
  FROM public.production_plan_leaves l
  WHERE COALESCE(trim(l.person_name), '') <> '';

END $$;

NOTIFY pgrst, 'reload schema';
