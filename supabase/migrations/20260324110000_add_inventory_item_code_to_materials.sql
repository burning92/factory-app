-- materials: 앱 원료명 -> 이카운트 재고 item_code 매핑(다대일 허용)
ALTER TABLE IF EXISTS public.materials
  ADD COLUMN IF NOT EXISTS inventory_item_code TEXT;

COMMENT ON COLUMN public.materials.inventory_item_code IS
  'ecount_inventory_current.item_code 매핑용 코드. 여러 materials가 같은 코드 사용 가능';
