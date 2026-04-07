-- ============================================================
-- 작업자 위생점검일지: 헤더 + 항목(O/X), 승인 워크플로
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_worker_hygiene_logs (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_code, inspection_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_worker_hygiene_logs_org_date
  ON public.daily_worker_hygiene_logs (organization_code, inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_worker_hygiene_logs_status
  ON public.daily_worker_hygiene_logs (organization_code, status);

COMMENT ON TABLE public.daily_worker_hygiene_logs IS '작업자 위생점검일지 헤더. 조직·점검일자당 1건, 담당자 종합 점검(작업자별 개별 행 아님).';
COMMENT ON COLUMN public.daily_worker_hygiene_logs.corrective_deviation IS '이탈내용';
COMMENT ON COLUMN public.daily_worker_hygiene_logs.corrective_detail IS '개선조치내용';
COMMENT ON COLUMN public.daily_worker_hygiene_logs.corrective_remarks IS '비고';

CREATE TABLE IF NOT EXISTS public.daily_worker_hygiene_log_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES public.daily_worker_hygiene_logs(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  question_index SMALLINT NOT NULL,
  question_text TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('O', 'X')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_worker_hygiene_log_items_log_id
  ON public.daily_worker_hygiene_log_items (log_id);

COMMENT ON TABLE public.daily_worker_hygiene_log_items IS '작업자 위생점검 항목별 결과(O=적합, X=부적합).';

ALTER TABLE public.daily_worker_hygiene_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_worker_hygiene_log_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_worker_hygiene_logs_select" ON public.daily_worker_hygiene_logs;
DROP POLICY IF EXISTS "daily_worker_hygiene_logs_insert" ON public.daily_worker_hygiene_logs;
DROP POLICY IF EXISTS "daily_worker_hygiene_logs_update" ON public.daily_worker_hygiene_logs;
DROP POLICY IF EXISTS "daily_worker_hygiene_logs_delete" ON public.daily_worker_hygiene_logs;
CREATE POLICY "daily_worker_hygiene_logs_select" ON public.daily_worker_hygiene_logs FOR SELECT USING (true);
CREATE POLICY "daily_worker_hygiene_logs_insert" ON public.daily_worker_hygiene_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_worker_hygiene_logs_update" ON public.daily_worker_hygiene_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_worker_hygiene_logs_delete" ON public.daily_worker_hygiene_logs FOR DELETE USING (true);

DROP POLICY IF EXISTS "daily_worker_hygiene_log_items_select" ON public.daily_worker_hygiene_log_items;
DROP POLICY IF EXISTS "daily_worker_hygiene_log_items_insert" ON public.daily_worker_hygiene_log_items;
DROP POLICY IF EXISTS "daily_worker_hygiene_log_items_update" ON public.daily_worker_hygiene_log_items;
DROP POLICY IF EXISTS "daily_worker_hygiene_log_items_delete" ON public.daily_worker_hygiene_log_items;
CREATE POLICY "daily_worker_hygiene_log_items_select" ON public.daily_worker_hygiene_log_items FOR SELECT USING (true);
CREATE POLICY "daily_worker_hygiene_log_items_insert" ON public.daily_worker_hygiene_log_items FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_worker_hygiene_log_items_update" ON public.daily_worker_hygiene_log_items FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_worker_hygiene_log_items_delete" ON public.daily_worker_hygiene_log_items FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';
