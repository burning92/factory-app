-- ============================================================
-- Harang product BOM: support raw/packaging category
-- ============================================================

ALTER TABLE public.harang_product_bom
  ADD COLUMN IF NOT EXISTS material_category TEXT NOT NULL DEFAULT 'raw_material'
  CHECK (material_category IN ('raw_material', 'packaging_material'));

-- 기존 FK는 raw 전용이라 부자재 id 저장을 막으므로 제거
ALTER TABLE public.harang_product_bom
  DROP CONSTRAINT IF EXISTS harang_product_bom_material_id_fkey;

CREATE INDEX IF NOT EXISTS idx_harang_product_bom_category
  ON public.harang_product_bom (material_category, product_name);

NOTIFY pgrst, 'reload schema';
