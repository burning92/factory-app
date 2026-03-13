-- ============================================================
-- Patch: 이카운트 재고 테이블 보정 (이미 create 실행된 DB 대상)
-- ============================================================
-- 1) RLS 비활성화
-- 2) ecount_sync_status → 현재 상태 테이블로 재구성
-- 3) ecount_inventory_current FK 제거, synced_at 추가, lot_no NULL → 'NO_LOT'
-- 4) updated_at 트리거 보정
-- Idempotent: IF EXISTS / IF NOT EXISTS 사용.
-- ============================================================

-- ---------- 1. RLS 비활성화 (정책 제거 후 비활성화) ----------
DROP POLICY IF EXISTS "ecount_item_master_all" ON public.ecount_item_master;
DROP POLICY IF EXISTS "ecount_inventory_current_all" ON public.ecount_inventory_current;
DROP POLICY IF EXISTS "ecount_sync_status_all" ON public.ecount_sync_status;

DO $$
BEGIN
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ecount_item_master'::regclass) THEN
    ALTER TABLE public.ecount_item_master DISABLE ROW LEVEL SECURITY;
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ecount_inventory_current'::regclass) THEN
    ALTER TABLE public.ecount_inventory_current DISABLE ROW LEVEL SECURITY;
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ecount_sync_status'::regclass) THEN
    ALTER TABLE public.ecount_sync_status DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ---------- 2. ecount_sync_status 재구성 (이력형 → 현재 상태형) ----------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ecount_sync_status' AND column_name = 'id'
  ) THEN
    DROP TABLE IF EXISTS public.ecount_sync_status;
    CREATE TABLE public.ecount_sync_status (
      sync_name TEXT NOT NULL PRIMARY KEY,
      last_synced_at TIMESTAMPTZ,
      last_status TEXT,
      row_count INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    COMMENT ON TABLE public.ecount_sync_status IS '구글시트→Supabase 동기화 현재 상태. sync_name별 최신 1행.';
    COMMENT ON COLUMN public.ecount_sync_status.sync_name IS '동기화 구분자. 예: ecount_inventory';
  END IF;
END $$;

-- ---------- 3. ecount_inventory_current: FK 제거, synced_at 추가, lot_no 보정 ----------
ALTER TABLE public.ecount_inventory_current
  DROP CONSTRAINT IF EXISTS ecount_inventory_current_item_code_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ecount_inventory_current' AND column_name = 'synced_at'
  ) THEN
    ALTER TABLE public.ecount_inventory_current
      ADD COLUMN synced_at TIMESTAMPTZ NOT NULL DEFAULT now();
    COMMENT ON COLUMN public.ecount_inventory_current.synced_at IS '동기화 반영 시각';
  END IF;
END $$;

UPDATE public.ecount_inventory_current
SET lot_no = 'NO_LOT'
WHERE lot_no IS NULL OR trim(lot_no) = '';

ALTER TABLE public.ecount_inventory_current
  ALTER COLUMN lot_no SET NOT NULL;

-- ---------- 4. updated_at 트리거 보정 ----------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_ecount_item_master_updated_at ON public.ecount_item_master;
CREATE TRIGGER set_ecount_item_master_updated_at
  BEFORE UPDATE ON public.ecount_item_master
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_ecount_inventory_current_updated_at ON public.ecount_inventory_current;
CREATE TRIGGER set_ecount_inventory_current_updated_at
  BEFORE UPDATE ON public.ecount_inventory_current
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_ecount_sync_status_updated_at ON public.ecount_sync_status;
CREATE TRIGGER set_ecount_sync_status_updated_at
  BEFORE UPDATE ON public.ecount_sync_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';
</think>
synced_at COMMENT은 ADD COLUMN 블록에만 두고, 불필요한 ELSE 제거 중.
<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>
StrReplace