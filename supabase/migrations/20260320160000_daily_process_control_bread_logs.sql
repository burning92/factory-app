-- ============================================================
-- 공정관리 점검일지(빵류): 헤더 + 공정 항목(O/X), 승인 워크플로
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_process_control_bread_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code TEXT NOT NULL,
  inspection_date DATE NOT NULL,
  author_name TEXT,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  product_name TEXT,
  work_start_time TEXT,
  work_end_time TEXT,
  fermentation_start_at TIMESTAMPTZ,
  fermentation_end_at TIMESTAMPTZ,
  topping_weight_check_g NUMERIC,
  notes TEXT,
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
  corrective_datetime TIMESTAMPTZ,
  corrective_deviation TEXT,
  corrective_detail TEXT,
  corrective_remarks TEXT,
  corrective_actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_code, inspection_date)
);

CREATE INDEX idx_daily_process_control_bread_logs_org_date
  ON public.daily_process_control_bread_logs (organization_code, inspection_date DESC);
CREATE INDEX idx_daily_process_control_bread_logs_status
  ON public.daily_process_control_bread_logs (organization_code, status);

COMMENT ON TABLE public.daily_process_control_bread_logs IS '공정관리 점검일지(빵류) 헤더.';
COMMENT ON COLUMN public.daily_process_control_bread_logs.corrective_deviation IS '이탈내용';

CREATE TABLE IF NOT EXISTS public.daily_process_control_bread_log_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES public.daily_process_control_bread_logs(id) ON DELETE CASCADE,
  stage_index SMALLINT NOT NULL,
  stage_name TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('O', 'X')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (log_id, stage_index)
);

CREATE INDEX idx_daily_process_control_bread_log_items_log_id
  ON public.daily_process_control_bread_log_items (log_id);

COMMENT ON TABLE public.daily_process_control_bread_log_items IS '공정관리 점검일지(빵류) 항목별 결과(O=적합, X=부적합).';

ALTER TABLE public.daily_process_control_bread_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_process_control_bread_log_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_process_control_bread_logs_select" ON public.daily_process_control_bread_logs FOR SELECT USING (true);
CREATE POLICY "daily_process_control_bread_logs_insert" ON public.daily_process_control_bread_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_process_control_bread_logs_update" ON public.daily_process_control_bread_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_process_control_bread_logs_delete" ON public.daily_process_control_bread_logs FOR DELETE USING (true);

CREATE POLICY "daily_process_control_bread_log_items_select" ON public.daily_process_control_bread_log_items FOR SELECT USING (true);
CREATE POLICY "daily_process_control_bread_log_items_insert" ON public.daily_process_control_bread_log_items FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_process_control_bread_log_items_update" ON public.daily_process_control_bread_log_items FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_process_control_bread_log_items_delete" ON public.daily_process_control_bread_log_items FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';
