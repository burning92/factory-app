-- 원재료 단위 고정(예: 파베이크 도우류는 EA만) + 시드 2건

ALTER TABLE public.harang_raw_materials
  ADD COLUMN IF NOT EXISTS locked_unit TEXT;

COMMENT ON COLUMN public.harang_raw_materials.locked_unit IS
  '설정 시 입고/BOM/생산 등에서 해당 단위로만 사용 (예: EA)';

INSERT INTO public.harang_raw_materials (item_code, item_name, default_unit, locked_unit, is_active, note)
VALUES
  ('HR-PARBAKE-DOUGH-TOMATO', '파베이크도우 - 토마토', 'EA', 'EA', true, NULL),
  ('HR-PARBAKE-DOUGH-BECHAMEL', '파베이크도우 - 베샤멜', 'EA', 'EA', true, NULL)
ON CONFLICT (item_code) DO UPDATE SET
  item_name = EXCLUDED.item_name,
  default_unit = EXCLUDED.default_unit,
  locked_unit = EXCLUDED.locked_unit,
  is_active = EXCLUDED.is_active,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
