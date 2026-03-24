-- ============================================================
-- 원료 해동 일지: 헤더(원료/LOT/수량/해동점검) + 승인 워크플로
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_raw_thawing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code TEXT NOT NULL,
  thawing_date DATE NOT NULL,
  planned_use_date DATE,
  author_name TEXT,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  item_code TEXT,
  material_name TEXT,
  lot_no TEXT,
  lot_selected TEXT,
  lot_manual TEXT,
  box_weight_g NUMERIC,
  unit_weight_g NUMERIC,
  box_qty NUMERIC,
  unit_qty NUMERIC,
  remainder_g NUMERIC,
  total_weight_g NUMERIC,
  thawing_start_at TIMESTAMPTZ,
  thawing_end_at TIMESTAMPTZ,
  thawing_room_temp_c NUMERIC,
  sensory_odor_result TEXT CHECK (sensory_odor_result IN ('O', 'X')),
  sensory_color_result TEXT CHECK (sensory_color_result IN ('O', 'X')),
  foreign_matter_result TEXT CHECK (foreign_matter_result IN ('O', 'X')),
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

CREATE INDEX idx_daily_raw_thawing_logs_org_date
  ON public.daily_raw_thawing_logs (organization_code, thawing_date DESC);
CREATE INDEX idx_daily_raw_thawing_logs_status
  ON public.daily_raw_thawing_logs (organization_code, status);

COMMENT ON TABLE public.daily_raw_thawing_logs IS '원료 해동 일지 헤더.';
COMMENT ON COLUMN public.daily_raw_thawing_logs.corrective_deviation IS '이탈내용';

ALTER TABLE public.daily_raw_thawing_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_raw_thawing_logs_select" ON public.daily_raw_thawing_logs FOR SELECT USING (true);
CREATE POLICY "daily_raw_thawing_logs_insert" ON public.daily_raw_thawing_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_raw_thawing_logs_update" ON public.daily_raw_thawing_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_raw_thawing_logs_delete" ON public.daily_raw_thawing_logs FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';
