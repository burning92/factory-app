-- ============================================================
-- 이카운트 재고 연동 MVP: 품목마스터, 재고현황, 동기화 상태
-- ============================================================
-- 구글시트(이카운트 RAW 데이터 베이스) → Supabase 동기화용 테이블.
-- 앱은 ecount_inventory_current 중심으로 원재료/부자재/반제품 탭 표시.
-- ============================================================

-- 품목 마스터 (재고_품목마스터 시트)
CREATE TABLE IF NOT EXISTS public.ecount_item_master (
  item_code TEXT NOT NULL PRIMARY KEY,
  item_name TEXT NOT NULL,
  inventory_type TEXT NOT NULL CHECK (inventory_type IN ('원재료', '부자재', '반제품')),
  category TEXT,
  box_weight_g NUMERIC NOT NULL DEFAULT 0,
  unit_weight_g NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ecount_item_master IS '이카운트 품목마스터. 구글시트 재고_품목마스터와 동기화.';
COMMENT ON COLUMN public.ecount_item_master.item_code IS '품목 고유 코드 (조인 키)';
COMMENT ON COLUMN public.ecount_item_master.inventory_type IS '원재료 | 부자재 | 반제품';
COMMENT ON COLUMN public.ecount_item_master.box_weight_g IS '1박스(g). g전용이면 0';
COMMENT ON COLUMN public.ecount_item_master.unit_weight_g IS '1개(g). g전용이면 0';
COMMENT ON COLUMN public.ecount_item_master.is_active IS '사용여부(Y→true, N→false)';

CREATE INDEX IF NOT EXISTS idx_ecount_item_master_inventory_type
  ON public.ecount_item_master (inventory_type);
CREATE INDEX IF NOT EXISTS idx_ecount_item_master_updated_at
  ON public.ecount_item_master (updated_at DESC);

-- 재고 현황 (RAW 시트 동기화 결과, 앱 주로 읽음)
CREATE TABLE IF NOT EXISTS public.ecount_inventory_current (
  id BIGSERIAL PRIMARY KEY,
  item_code TEXT NOT NULL,
  lot_no TEXT NOT NULL,
  qty NUMERIC NOT NULL DEFAULT 0,
  raw_item_name TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_code, lot_no)
);

COMMENT ON TABLE public.ecount_inventory_current IS '이카운트 시리얼/로트 재고현황. item_code+lot_no 단위. master 조인은 앱/쿼리에서.';
COMMENT ON COLUMN public.ecount_inventory_current.lot_no IS '시리얼/로트No. LOT 없으면 NO_LOT 등 치환값 사용';
COMMENT ON COLUMN public.ecount_inventory_current.raw_item_name IS 'RAW 시트 품목명 (검증/로깅용)';
COMMENT ON COLUMN public.ecount_inventory_current.synced_at IS '동기화 반영 시각';

CREATE INDEX IF NOT EXISTS idx_ecount_inventory_current_item_code
  ON public.ecount_inventory_current (item_code);
CREATE INDEX IF NOT EXISTS idx_ecount_inventory_current_updated_at
  ON public.ecount_inventory_current (updated_at DESC);

-- 동기화 현재 상태 (sync_name별 1행)
CREATE TABLE IF NOT EXISTS public.ecount_sync_status (
  sync_name TEXT NOT NULL PRIMARY KEY,
  last_synced_at TIMESTAMPTZ,
  last_status TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ecount_sync_status IS '구글시트→Supabase 동기화 현재 상태. sync_name별 최신 1행.';
COMMENT ON COLUMN public.ecount_sync_status.sync_name IS '동기화 구분자. 예: ecount_inventory';

-- updated_at 자동 갱신 트리거
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

-- RLS 미사용: 이 3개 테이블은 서버(동기화/백엔드) 전용. 클라이언트 익명 접근 차단이 목적이면 RLS 켜고 정책만 두는 편이 나음.
-- MVP에서는 서버만 접근하므로 RLS를 켜지 않음.

NOTIFY pgrst, 'reload schema';
