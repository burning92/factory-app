-- ============================================================
-- Harang raw materials: add weight fields + seed from AFF
-- ============================================================

ALTER TABLE public.harang_raw_materials
  ADD COLUMN IF NOT EXISTS box_weight_g NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (box_weight_g >= 0),
  ADD COLUMN IF NOT EXISTS unit_weight_g NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_weight_g >= 0),
  ADD COLUMN IF NOT EXISTS source_material_id UUID;

COMMENT ON COLUMN public.harang_raw_materials.box_weight_g IS '1박스 중량(g). g전용이면 0';
COMMENT ON COLUMN public.harang_raw_materials.unit_weight_g IS '1개(낱개) 중량(g). g전용이면 0';
COMMENT ON COLUMN public.harang_raw_materials.source_material_id IS 'AFF materials.id 원본 참조(초기 이관 추적용)';

CREATE UNIQUE INDEX IF NOT EXISTS idx_harang_raw_materials_source_material_id
  ON public.harang_raw_materials (source_material_id)
  WHERE source_material_id IS NOT NULL;

WITH material_candidates AS (
  SELECT
    m.id,
    m.material_name,
    COALESCE(NULLIF(TRIM(m.inventory_item_code), ''), 'AFFM-' || SUBSTRING(REPLACE(m.id::TEXT, '-', '') FROM 1 FOR 8)) AS item_code,
    COALESCE(m.box_weight_g, 0)::NUMERIC(12, 2) AS box_weight_g,
    COALESCE(m.unit_weight_g, 0)::NUMERIC(12, 2) AS unit_weight_g,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(NULLIF(TRIM(m.inventory_item_code), ''), 'AFFM-' || SUBSTRING(REPLACE(m.id::TEXT, '-', '') FROM 1 FOR 8))
      ORDER BY m.id DESC
    ) AS rn
  FROM public.materials m
),
deduped AS (
  SELECT
    id,
    material_name,
    item_code,
    box_weight_g,
    unit_weight_g
  FROM material_candidates
  WHERE rn = 1
)
INSERT INTO public.harang_raw_materials (
  item_code,
  item_name,
  default_unit,
  box_weight_g,
  unit_weight_g,
  is_active,
  note,
  source_material_id
)
SELECT
  d.item_code,
  d.material_name AS item_name,
  CASE
    WHEN d.box_weight_g = 0 AND d.unit_weight_g = 0 THEN 'g'
    ELSE 'EA'
  END AS default_unit,
  d.box_weight_g,
  d.unit_weight_g,
  TRUE AS is_active,
  'AFF 원재료 이관' AS note,
  d.id AS source_material_id
FROM deduped d
ON CONFLICT (item_code) DO UPDATE
SET
  item_name = EXCLUDED.item_name,
  default_unit = EXCLUDED.default_unit,
  box_weight_g = EXCLUDED.box_weight_g,
  unit_weight_g = EXCLUDED.unit_weight_g,
  source_material_id = COALESCE(public.harang_raw_materials.source_material_id, EXCLUDED.source_material_id),
  updated_at = now();

NOTIFY pgrst, 'reload schema';
