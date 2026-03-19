-- ============================================================
-- 영업장환경위생점검일지: 헤더 + 항목 (1:N)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_hygiene_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code TEXT NOT NULL,
  inspection_date DATE NOT NULL,
  author_name TEXT,
  corrective_content TEXT,
  corrective_datetime TIMESTAMPTZ,
  corrective_deviation TEXT,
  corrective_detail TEXT,
  corrective_actor TEXT,
  corrective_approver TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_code, inspection_date)
);

CREATE INDEX idx_daily_hygiene_logs_org_date ON public.daily_hygiene_logs (organization_code, inspection_date DESC);

COMMENT ON TABLE public.daily_hygiene_logs IS '영업장환경위생점검일지 헤더. 부적합 시 조치 필드 사용.';
COMMENT ON COLUMN public.daily_hygiene_logs.corrective_content IS '부적합 조치 - 내용';
COMMENT ON COLUMN public.daily_hygiene_logs.corrective_deviation IS '부적합 조치 - 이탈내용';
COMMENT ON COLUMN public.daily_hygiene_logs.corrective_detail IS '부적합 조치 - 세부 개선 조치 내역';
COMMENT ON COLUMN public.daily_hygiene_logs.corrective_actor IS '부적합 조치 - 개선조치자';
COMMENT ON COLUMN public.daily_hygiene_logs.corrective_approver IS '부적합 조치 - 승인자';

CREATE TABLE IF NOT EXISTS public.daily_hygiene_log_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES public.daily_hygiene_logs(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  question_index SMALLINT NOT NULL,
  question_text TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('O', 'X')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_daily_hygiene_log_items_log_id ON public.daily_hygiene_log_items (log_id);

COMMENT ON TABLE public.daily_hygiene_log_items IS '영업장환경위생점검일지 항목별 결과(O/X).';

ALTER TABLE public.daily_hygiene_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_hygiene_log_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_hygiene_logs_select" ON public.daily_hygiene_logs FOR SELECT USING (true);
CREATE POLICY "daily_hygiene_logs_insert" ON public.daily_hygiene_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_hygiene_logs_update" ON public.daily_hygiene_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_hygiene_logs_delete" ON public.daily_hygiene_logs FOR DELETE USING (true);

CREATE POLICY "daily_hygiene_log_items_select" ON public.daily_hygiene_log_items FOR SELECT USING (true);
CREATE POLICY "daily_hygiene_log_items_insert" ON public.daily_hygiene_log_items FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_hygiene_log_items_update" ON public.daily_hygiene_log_items FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_hygiene_log_items_delete" ON public.daily_hygiene_log_items FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';
