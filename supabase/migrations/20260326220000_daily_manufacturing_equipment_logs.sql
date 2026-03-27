-- ============================================================
-- 제조설비 점검표: 헤더 + 항목(O/X, 부적합사항), 승인 워크플로
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_manufacturing_equipment_logs (
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_code, inspection_date)
);

CREATE INDEX idx_daily_manufacturing_equipment_logs_org_date
  ON public.daily_manufacturing_equipment_logs (organization_code, inspection_date DESC);
CREATE INDEX idx_daily_manufacturing_equipment_logs_status
  ON public.daily_manufacturing_equipment_logs (organization_code, status);

COMMENT ON TABLE public.daily_manufacturing_equipment_logs IS '제조설비 점검표 헤더.';

CREATE TABLE IF NOT EXISTS public.daily_manufacturing_equipment_log_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES public.daily_manufacturing_equipment_logs(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  question_index SMALLINT NOT NULL,
  question_text TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('O', 'X')),
  nonconformity_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT daily_manufacturing_equipment_nonconformity_check CHECK (
    (result = 'X' AND nonconformity_note IS NOT NULL AND btrim(nonconformity_note) <> '')
    OR
    (result = 'O' AND nonconformity_note IS NULL)
  )
);

CREATE INDEX idx_daily_manufacturing_equipment_log_items_log_id
  ON public.daily_manufacturing_equipment_log_items (log_id);

COMMENT ON TABLE public.daily_manufacturing_equipment_log_items IS '제조설비 점검표 항목별 결과(O=적합, X=부적합).';
COMMENT ON COLUMN public.daily_manufacturing_equipment_log_items.nonconformity_note IS '부적합사항 (result=X 필수)';

ALTER TABLE public.daily_manufacturing_equipment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_manufacturing_equipment_log_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_manufacturing_equipment_logs_select"
  ON public.daily_manufacturing_equipment_logs FOR SELECT USING (true);
CREATE POLICY "daily_manufacturing_equipment_logs_insert"
  ON public.daily_manufacturing_equipment_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_manufacturing_equipment_logs_update"
  ON public.daily_manufacturing_equipment_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_manufacturing_equipment_logs_delete"
  ON public.daily_manufacturing_equipment_logs FOR DELETE USING (true);

CREATE POLICY "daily_manufacturing_equipment_log_items_select"
  ON public.daily_manufacturing_equipment_log_items FOR SELECT USING (true);
CREATE POLICY "daily_manufacturing_equipment_log_items_insert"
  ON public.daily_manufacturing_equipment_log_items FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_manufacturing_equipment_log_items_update"
  ON public.daily_manufacturing_equipment_log_items FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_manufacturing_equipment_log_items_delete"
  ON public.daily_manufacturing_equipment_log_items FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';
