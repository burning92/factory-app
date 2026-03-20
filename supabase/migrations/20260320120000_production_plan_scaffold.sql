-- ============================================================
-- 생산계획 (구글시트 VIEW_CALENDAR 등 → sync API → Supabase) 뼈대
-- ============================================================

CREATE TABLE IF NOT EXISTS public.production_plan_rows (
  id BIGSERIAL PRIMARY KEY,
  plan_date DATE NOT NULL,
  product_name TEXT NOT NULL,
  qty NUMERIC,
  category TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.production_plan_rows IS '생산계획(시트 동기화) 행. 읽기 전용 UI는 이 테이블을 조회.';
COMMENT ON COLUMN public.production_plan_rows.plan_date IS '계획 일자 (YYYY-MM-DD)';
COMMENT ON COLUMN public.production_plan_rows.category IS '구분 등 표시용';
COMMENT ON COLUMN public.production_plan_rows.sort_order IS '같은 일자 내 정렬';

CREATE INDEX IF NOT EXISTS idx_production_plan_rows_plan_date
  ON public.production_plan_rows (plan_date DESC);

CREATE INDEX IF NOT EXISTS idx_production_plan_rows_updated_at
  ON public.production_plan_rows (updated_at DESC);

CREATE TABLE IF NOT EXISTS public.production_plan_sync_status (
  sync_name TEXT NOT NULL PRIMARY KEY,
  last_synced_at TIMESTAMPTZ,
  last_status TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  source_refreshed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.production_plan_sync_status IS '생산계획 시트→Supabase 동기화 상태. sync_name별 1행.';
COMMENT ON COLUMN public.production_plan_sync_status.source_refreshed_at IS '시트 마지막 갱신 시각(payload.sourceRefreshedAt).';

DROP TRIGGER IF EXISTS set_production_plan_rows_updated_at ON public.production_plan_rows;
CREATE TRIGGER set_production_plan_rows_updated_at
  BEFORE UPDATE ON public.production_plan_rows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_production_plan_sync_status_updated_at ON public.production_plan_sync_status;
CREATE TRIGGER set_production_plan_sync_status_updated_at
  BEFORE UPDATE ON public.production_plan_sync_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS 미사용: 이카운트 재고 테이블 MVP와 동일. 앱 읽기는 서버에서 service role(getSupabaseAdmin) 사용.
NOTIFY pgrst, 'reload schema';
