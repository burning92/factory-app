-- 재고 품목마스터·재고현황의 부자재를 플래닝 부자재 마스터(planning_submaterial_items)에 일괄 반영
-- - ecount_item_master: inventory_type = '부자재' 인 품목 전체
-- - 마스터에 없고 ecount_inventory_current 에만 있는 부자재 코드(표시명은 current 기준)
-- - 동일 표시명이 여러 코드에 걸리면 submaterial_name 에 [item_code] 접미사
-- - 이미 같은 submaterial_name 이 있으면 ON CONFLICT 로 코드·중량·active 갱신

WITH unioned AS (
  SELECT
    TRIM(m.item_code)::text AS item_code,
    COALESCE(NULLIF(TRIM(m.item_name), ''), TRIM(m.item_code)::text) AS base_name,
    COALESCE(m.box_weight_g, 0)::numeric(12, 2) AS box_w,
    COALESCE(m.unit_weight_g, 0)::numeric(12, 2) AS unit_w,
    COALESCE(m.is_active, true) AS is_act
  FROM public.ecount_item_master m
  WHERE m.inventory_type = '부자재'
    AND TRIM(m.item_code) <> ''

  UNION ALL

  SELECT
    TRIM(c.item_code)::text,
    COALESCE(
      NULLIF(TRIM(c.display_item_name), ''),
      NULLIF(TRIM(c.raw_item_name), ''),
      TRIM(c.item_code)::text
    ) AS base_name,
    COALESCE(c.box_weight_g, 0)::numeric(12, 2),
    COALESCE(c.unit_weight_g, 0)::numeric(12, 2),
    true AS is_act
  FROM (
    SELECT DISTINCT ON (item_code)
      item_code,
      display_item_name,
      raw_item_name,
      box_weight_g,
      unit_weight_g,
      lot_no
    FROM public.ecount_inventory_current
    WHERE inventory_type = '부자재'
      AND TRIM(item_code) <> ''
    ORDER BY item_code, lot_no
  ) c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.ecount_item_master m
    WHERE m.item_code = c.item_code
      AND m.inventory_type = '부자재'
  )
),
named AS (
  SELECT
    item_code,
    CASE
      WHEN COUNT(*) OVER (PARTITION BY base_name) > 1 THEN base_name || ' [' || item_code || ']'
      ELSE base_name
    END AS submaterial_name,
    box_w,
    unit_w,
    is_act
  FROM unioned
)
INSERT INTO public.planning_submaterial_items (
  submaterial_name,
  box_weight_g,
  unit_weight_g,
  inventory_item_code,
  active
)
SELECT
  submaterial_name,
  box_w,
  unit_w,
  item_code,
  is_act
FROM named
ON CONFLICT (submaterial_name) DO UPDATE SET
  inventory_item_code = EXCLUDED.inventory_item_code,
  box_weight_g = EXCLUDED.box_weight_g,
  unit_weight_g = EXCLUDED.unit_weight_g,
  active = EXCLUDED.active,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
