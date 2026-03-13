-- ============================================================
-- usage_calculations: 마감전 저장 시 선택 필드 Nullable 보장
-- ============================================================
-- 완제품/파베이크 수량 등은 물류팀 마감 전까지 null 허용
-- ============================================================

-- status 컬럼 없으면 추가 (draft | stock_entered | closed)
ALTER TABLE public.usage_calculations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'usage_calculations_status_check'
  ) THEN
    ALTER TABLE public.usage_calculations
      ADD CONSTRAINT usage_calculations_status_check
      CHECK (status IN ('draft', 'stock_entered', 'closed'));
  END IF;
END $$;

-- 파베이크/완제품 수량 컬럼 없으면 추가 (모두 nullable)
ALTER TABLE public.usage_calculations
  ADD COLUMN IF NOT EXISTS parbake_add_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS parbake_woozooin_qty NUMERIC,
  ADD COLUMN IF NOT EXISTS parbake_sales_qty NUMERIC;

-- 기존에 NOT NULL로 되어 있을 수 있는 컬럼은 DROP NOT NULL (선택 필드만, 이미 nullable이면 무시)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usage_calculations' AND column_name = 'finished_qty_actual' AND is_nullable = 'NO') THEN
    ALTER TABLE public.usage_calculations ALTER COLUMN finished_qty_actual DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usage_calculations' AND column_name = 'parbake_add_qty' AND is_nullable = 'NO') THEN
    ALTER TABLE public.usage_calculations ALTER COLUMN parbake_add_qty DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usage_calculations' AND column_name = 'parbake_woozooin_qty' AND is_nullable = 'NO') THEN
    ALTER TABLE public.usage_calculations ALTER COLUMN parbake_woozooin_qty DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'usage_calculations' AND column_name = 'parbake_sales_qty' AND is_nullable = 'NO') THEN
    ALTER TABLE public.usage_calculations ALTER COLUMN parbake_sales_qty DROP NOT NULL;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
