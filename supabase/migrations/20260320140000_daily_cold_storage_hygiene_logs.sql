-- ============================================================
-- 냉장 · 냉동온도 및 위생 점검일지: 헤더(오전/오후 온도 컬럼) + 체크 항목(O/X), 승인 워크플로
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_cold_storage_hygiene_logs (
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
  corrective_datetime TIMESTAMPTZ,
  corrective_deviation TEXT,
  corrective_detail TEXT,
  corrective_remarks TEXT,
  corrective_actor TEXT,
  am_measure_time TEXT,
  pm_measure_time TEXT,
  am_temp_floor1_refrigerator_c NUMERIC,
  am_temp_floor1_freezer_c NUMERIC,
  am_temp_dough_aging_c NUMERIC,
  am_temp_topping_refrigerator_c NUMERIC,
  am_temp_blast_freezer_1_c NUMERIC,
  am_temp_blast_freezer_2_c NUMERIC,
  pm_temp_floor1_refrigerator_c NUMERIC,
  pm_temp_floor1_freezer_c NUMERIC,
  pm_temp_dough_aging_c NUMERIC,
  pm_temp_topping_refrigerator_c NUMERIC,
  pm_temp_blast_freezer_1_c NUMERIC,
  pm_temp_blast_freezer_2_c NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_code, inspection_date)
);

CREATE INDEX idx_daily_cold_storage_hygiene_logs_org_date
  ON public.daily_cold_storage_hygiene_logs (organization_code, inspection_date DESC);
CREATE INDEX idx_daily_cold_storage_hygiene_logs_status
  ON public.daily_cold_storage_hygiene_logs (organization_code, status);

COMMENT ON TABLE public.daily_cold_storage_hygiene_logs IS '냉장 · 냉동온도 및 위생 점검일지 헤더.';
COMMENT ON COLUMN public.daily_cold_storage_hygiene_logs.corrective_deviation IS '이탈내용';

CREATE TABLE IF NOT EXISTS public.daily_cold_storage_hygiene_log_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES public.daily_cold_storage_hygiene_logs(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  question_index SMALLINT NOT NULL,
  question_text TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('O', 'X')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (log_id, category, question_index)
);

CREATE INDEX idx_daily_cold_storage_hygiene_log_items_log_id
  ON public.daily_cold_storage_hygiene_log_items (log_id);

COMMENT ON TABLE public.daily_cold_storage_hygiene_log_items IS '냉장·냉동 위생 점검 항목별 결과(O=적합, X=부적합).';

ALTER TABLE public.daily_cold_storage_hygiene_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_cold_storage_hygiene_log_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_cold_storage_hygiene_logs_select" ON public.daily_cold_storage_hygiene_logs FOR SELECT USING (true);
CREATE POLICY "daily_cold_storage_hygiene_logs_insert" ON public.daily_cold_storage_hygiene_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_cold_storage_hygiene_logs_update" ON public.daily_cold_storage_hygiene_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_cold_storage_hygiene_logs_delete" ON public.daily_cold_storage_hygiene_logs FOR DELETE USING (true);

CREATE POLICY "daily_cold_storage_hygiene_log_items_select" ON public.daily_cold_storage_hygiene_log_items FOR SELECT USING (true);
CREATE POLICY "daily_cold_storage_hygiene_log_items_insert" ON public.daily_cold_storage_hygiene_log_items FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_cold_storage_hygiene_log_items_update" ON public.daily_cold_storage_hygiene_log_items FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_cold_storage_hygiene_log_items_delete" ON public.daily_cold_storage_hygiene_log_items FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';
