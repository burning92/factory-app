-- ============================================================
-- 영업장 온·습도점검일지: 헤더 + 구역별 항목 (1:N), 승인 워크플로
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_temp_humidity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code TEXT NOT NULL,
  inspection_date DATE NOT NULL,
  author_name TEXT,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by_name TEXT,
  rejected_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reject_reason TEXT,
  -- 기준 이탈 시 개선조치 (승인자는 헤더 approved_by_name에 반영, 별도 입력 컬럼 없음)
  corrective_datetime TIMESTAMPTZ,
  corrective_deviation TEXT,
  corrective_detail TEXT,
  corrective_remarks TEXT,
  corrective_actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_code, inspection_date)
);

CREATE INDEX idx_daily_temp_humidity_logs_org_date
  ON public.daily_temp_humidity_logs (organization_code, inspection_date DESC);
CREATE INDEX idx_daily_temp_humidity_logs_status
  ON public.daily_temp_humidity_logs (organization_code, status);

COMMENT ON TABLE public.daily_temp_humidity_logs IS '영업장 온·습도점검일지 헤더.';
COMMENT ON COLUMN public.daily_temp_humidity_logs.corrective_deviation IS '이탈내용';
COMMENT ON COLUMN public.daily_temp_humidity_logs.corrective_detail IS '개선조치내용';
COMMENT ON COLUMN public.daily_temp_humidity_logs.corrective_remarks IS '비고';

CREATE TABLE IF NOT EXISTS public.daily_temp_humidity_log_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES public.daily_temp_humidity_logs(id) ON DELETE CASCADE,
  zone_index SMALLINT NOT NULL,
  zone_name TEXT NOT NULL,
  max_temp_c NUMERIC NOT NULL,
  max_humidity_pct NUMERIC NOT NULL,
  actual_temp_c NUMERIC,
  actual_humidity_pct NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (log_id, zone_index)
);

CREATE INDEX idx_daily_temp_humidity_log_items_log_id
  ON public.daily_temp_humidity_log_items (log_id);

COMMENT ON TABLE public.daily_temp_humidity_log_items IS '온·습도점검 구역별 측정값(기준 스냅샷 포함).';

ALTER TABLE public.daily_temp_humidity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_temp_humidity_log_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_temp_humidity_logs_select" ON public.daily_temp_humidity_logs FOR SELECT USING (true);
CREATE POLICY "daily_temp_humidity_logs_insert" ON public.daily_temp_humidity_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_temp_humidity_logs_update" ON public.daily_temp_humidity_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_temp_humidity_logs_delete" ON public.daily_temp_humidity_logs FOR DELETE USING (true);

CREATE POLICY "daily_temp_humidity_log_items_select" ON public.daily_temp_humidity_log_items FOR SELECT USING (true);
CREATE POLICY "daily_temp_humidity_log_items_insert" ON public.daily_temp_humidity_log_items FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_temp_humidity_log_items_update" ON public.daily_temp_humidity_log_items FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_temp_humidity_log_items_delete" ON public.daily_temp_humidity_log_items FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';
