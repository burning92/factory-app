-- ============================================================
-- 영업장 조도 점검일지: 헤더(점검자/점검일시) + 항목 실측 조도
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_illumination_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code TEXT NOT NULL,
  inspector_name TEXT,
  inspector_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_daily_illumination_logs_org_inspected
  ON public.daily_illumination_logs (organization_code, inspected_at DESC);
CREATE INDEX idx_daily_illumination_logs_org_status
  ON public.daily_illumination_logs (organization_code, status);

COMMENT ON TABLE public.daily_illumination_logs IS '영업장 조도 점검일지 헤더. 점검자=inspector_name, 점검일시=inspected_at.';
COMMENT ON COLUMN public.daily_illumination_logs.corrective_deviation IS '이탈 내용';

CREATE TABLE IF NOT EXISTS public.daily_illumination_log_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES public.daily_illumination_logs(id) ON DELETE CASCADE,
  item_index SMALLINT NOT NULL,
  item_label TEXT NOT NULL,
  min_lux INTEGER NOT NULL,
  measured_lux NUMERIC,
  conformity TEXT CHECK (conformity IN ('O', 'X')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_daily_illumination_log_items_log_id
  ON public.daily_illumination_log_items (log_id);

COMMENT ON TABLE public.daily_illumination_log_items IS '영업장 조도 점검 항목 실측값. conformity O=적합 X=부적합.';

ALTER TABLE public.daily_illumination_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_illumination_log_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_illumination_logs_select"
  ON public.daily_illumination_logs FOR SELECT USING (true);
CREATE POLICY "daily_illumination_logs_insert"
  ON public.daily_illumination_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_illumination_logs_update"
  ON public.daily_illumination_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_illumination_logs_delete"
  ON public.daily_illumination_logs FOR DELETE USING (true);

CREATE POLICY "daily_illumination_log_items_select"
  ON public.daily_illumination_log_items FOR SELECT USING (true);
CREATE POLICY "daily_illumination_log_items_insert"
  ON public.daily_illumination_log_items FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_illumination_log_items_update"
  ON public.daily_illumination_log_items FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_illumination_log_items_delete"
  ON public.daily_illumination_log_items FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';
