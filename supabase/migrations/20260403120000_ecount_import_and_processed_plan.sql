-- 이카운트 생산입고 등 외부 실적 행 (대시보드 보정용)
-- 생산계획가공 시트 동기화 (날짜·제품명·수량·투입인원)

CREATE TABLE IF NOT EXISTS public.ecount_production_import_lines (
  id BIGSERIAL PRIMARY KEY,
  movement_date DATE NOT NULL,
  item_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  movement_type TEXT NOT NULL DEFAULT '생산입고',
  external_ref TEXT,
  source TEXT NOT NULL DEFAULT 'ecount',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ecount_production_import_lines IS '이카운트 등 외부 생산·입고 명세. 대시보드는 생산입고만 합산하며 2차마감이 있는 일자는 중복 방지를 위해 제외.';
COMMENT ON COLUMN public.ecount_production_import_lines.movement_type IS '예: 생산입고, 품질-폐기, 생산소모. 동기화 후 집계는 생산입고만 사용.';
COMMENT ON COLUMN public.ecount_production_import_lines.external_ref IS '일자-No 등 원본 키 (선택)';

CREATE INDEX IF NOT EXISTS idx_ecount_production_import_lines_movement_date
  ON public.ecount_production_import_lines (movement_date DESC);

CREATE INDEX IF NOT EXISTS idx_ecount_production_import_lines_type_date
  ON public.ecount_production_import_lines (movement_type, movement_date);

CREATE TABLE IF NOT EXISTS public.production_plan_processed_rows (
  id BIGSERIAL PRIMARY KEY,
  plan_date DATE NOT NULL,
  product_name TEXT NOT NULL,
  qty NUMERIC,
  manpower NUMERIC,
  plan_year INTEGER NOT NULL,
  plan_month INTEGER NOT NULL,
  source_sheet_name TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.production_plan_processed_rows IS '생산계획가공 시트(날짜·제품명·수량·투입인원) 동기화. 가동률·계획합계 보조.';
COMMENT ON COLUMN public.production_plan_processed_rows.manpower IS '해당 행의 투입인원. 같은 일자 여러 행이면 일별 max로 가동률 산출.';

CREATE INDEX IF NOT EXISTS idx_production_plan_processed_rows_plan_date
  ON public.production_plan_processed_rows (plan_date DESC);

CREATE INDEX IF NOT EXISTS idx_production_plan_processed_rows_year_month
  ON public.production_plan_processed_rows (plan_year DESC, plan_month DESC);

DROP TRIGGER IF EXISTS set_production_plan_processed_rows_updated_at ON public.production_plan_processed_rows;
CREATE TRIGGER set_production_plan_processed_rows_updated_at
  BEFORE UPDATE ON public.production_plan_processed_rows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';
