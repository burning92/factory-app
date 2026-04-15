-- ============================================================
-- Harang product BOM seed from AFF BOM
-- - only product rows with variant "파베이크사용"
-- ============================================================

ALTER TABLE public.harang_product_bom
  ADD COLUMN IF NOT EXISTS source_bom_id UUID;

COMMENT ON COLUMN public.harang_product_bom.source_bom_id IS 'AFF bom.id 원본 참조(초기 이관 추적용)';

CREATE UNIQUE INDEX IF NOT EXISTS idx_harang_product_bom_source_bom_id
  ON public.harang_product_bom (source_bom_id)
  WHERE source_bom_id IS NOT NULL;

WITH aff_parbake_bom AS (
  SELECT
    b.id AS source_bom_id,
    b.product_name,
    b.material_name,
    b.bom_g_per_ea
  FROM public.bom b
  WHERE b.product_name LIKE '%파베이크사용%'
),
matched_materials AS (
  SELECT
    a.source_bom_id,
    a.product_name,
    a.material_name,
    a.bom_g_per_ea,
    hrm.id AS harang_material_id,
    hrm.item_code AS harang_material_code,
    hrm.item_name AS harang_material_name
  FROM aff_parbake_bom a
  JOIN public.harang_raw_materials hrm
    ON hrm.item_name = a.material_name
    OR (hrm.source_material_id IS NOT NULL AND hrm.source_material_id IN (
      SELECT m.id FROM public.materials m WHERE m.material_name = a.material_name
    ))
),
deduped AS (
  SELECT DISTINCT ON (product_name, harang_material_id)
    source_bom_id,
    product_name,
    harang_material_id,
    harang_material_code,
    harang_material_name,
    bom_g_per_ea
  FROM matched_materials
  ORDER BY product_name, harang_material_id, source_bom_id DESC
)
INSERT INTO public.harang_product_bom (
  product_name,
  material_id,
  material_code,
  material_name,
  bom_qty,
  unit,
  is_active,
  source_bom_id
)
SELECT
  d.product_name,
  d.harang_material_id,
  d.harang_material_code,
  d.harang_material_name,
  COALESCE(d.bom_g_per_ea, 0)::NUMERIC(14, 3) AS bom_qty,
  'g' AS unit,
  TRUE AS is_active,
  d.source_bom_id
FROM deduped d
ON CONFLICT (product_name, material_id) DO UPDATE
SET
  material_code = EXCLUDED.material_code,
  material_name = EXCLUDED.material_name,
  bom_qty = EXCLUDED.bom_qty,
  unit = 'g',
  is_active = EXCLUDED.is_active,
  source_bom_id = COALESCE(public.harang_product_bom.source_bom_id, EXCLUDED.source_bom_id),
  updated_at = now();

NOTIFY pgrst, 'reload schema';
