-- inventory_current에 앱 표시용 컬럼 추가 (동기화 시 master 기준으로 채움, 없으면 raw_item_name / 미분류)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ecount_inventory_current' AND column_name='display_item_name') THEN
    ALTER TABLE public.ecount_inventory_current ADD COLUMN display_item_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ecount_inventory_current' AND column_name='inventory_type') THEN
    ALTER TABLE public.ecount_inventory_current ADD COLUMN inventory_type TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ecount_inventory_current' AND column_name='category') THEN
    ALTER TABLE public.ecount_inventory_current ADD COLUMN category TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ecount_inventory_current' AND column_name='box_weight_g') THEN
    ALTER TABLE public.ecount_inventory_current ADD COLUMN box_weight_g NUMERIC NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ecount_inventory_current' AND column_name='unit_weight_g') THEN
    ALTER TABLE public.ecount_inventory_current ADD COLUMN unit_weight_g NUMERIC NOT NULL DEFAULT 0;
  END IF;
END $$;

COMMENT ON COLUMN public.ecount_inventory_current.display_item_name IS '표시 품목명. master 있으면 item_name, 없으면 raw_item_name';
COMMENT ON COLUMN public.ecount_inventory_current.inventory_type IS '원재료|부자재|반제품|미분류';
