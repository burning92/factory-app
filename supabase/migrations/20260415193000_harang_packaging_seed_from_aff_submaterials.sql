-- ============================================================
-- Harang packaging materials seed from AFF submaterial master
-- - Source: public.planning_submaterial_items (AFF 부자재정보 관리)
-- - Rule: default_unit is always EA (개당)
-- ============================================================

ALTER TABLE public.harang_packaging_materials
  ADD COLUMN IF NOT EXISTS source_submaterial_item_id BIGINT;

COMMENT ON COLUMN public.harang_packaging_materials.source_submaterial_item_id IS 'AFF planning_submaterial_items.id 원본 참조(초기 이관 추적용)';

CREATE UNIQUE INDEX IF NOT EXISTS idx_harang_packaging_materials_source_submaterial_item_id
  ON public.harang_packaging_materials (source_submaterial_item_id)
  WHERE source_submaterial_item_id IS NOT NULL;

WITH submaterial_candidates AS (
  SELECT
    s.id,
    s.submaterial_name,
    COALESCE(NULLIF(TRIM(s.inventory_item_code), ''), 'AFFS-' || s.id::TEXT) AS item_code,
    s.active,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(NULLIF(TRIM(s.inventory_item_code), ''), 'AFFS-' || s.id::TEXT)
      ORDER BY s.id DESC
    ) AS rn
  FROM public.planning_submaterial_items s
),
deduped AS (
  SELECT
    id,
    submaterial_name,
    item_code,
    active
  FROM submaterial_candidates
  WHERE rn = 1
)
INSERT INTO public.harang_packaging_materials (
  item_code,
  item_name,
  default_unit,
  is_active,
  note,
  source_submaterial_item_id
)
SELECT
  d.item_code,
  d.submaterial_name AS item_name,
  'EA' AS default_unit,
  COALESCE(d.active, true) AS is_active,
  'AFF 부자재정보 관리 이관' AS note,
  d.id AS source_submaterial_item_id
FROM deduped d
ON CONFLICT (item_code) DO UPDATE
SET
  item_name = EXCLUDED.item_name,
  default_unit = 'EA',
  is_active = EXCLUDED.is_active,
  source_submaterial_item_id = COALESCE(public.harang_packaging_materials.source_submaterial_item_id, EXCLUDED.source_submaterial_item_id),
  updated_at = now();

NOTIFY pgrst, 'reload schema';
