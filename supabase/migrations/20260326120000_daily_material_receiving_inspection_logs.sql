-- ============================================================
-- 원료 입고 검수일지: 헤더(반입자·반입일시) + 품목 라인 다건, 승인 워크플로
-- 같은 날 여러 입고건 허용 → 날짜 UNIQUE 없음
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_material_receiving_inspection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code TEXT NOT NULL,
  author_name TEXT,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
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

CREATE INDEX idx_daily_material_receiving_inspection_logs_org_received
  ON public.daily_material_receiving_inspection_logs (organization_code, received_at DESC);
CREATE INDEX idx_daily_material_receiving_inspection_logs_org_status
  ON public.daily_material_receiving_inspection_logs (organization_code, status);

COMMENT ON TABLE public.daily_material_receiving_inspection_logs IS '원료 입고 검수일지 헤더. 반입자명=author_name, 반입일시=received_at.';
COMMENT ON COLUMN public.daily_material_receiving_inspection_logs.corrective_deviation IS '이탈내용';

CREATE TABLE IF NOT EXISTS public.daily_material_receiving_inspection_log_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id UUID NOT NULL REFERENCES public.daily_material_receiving_inspection_logs(id) ON DELETE CASCADE,
  line_index SMALLINT NOT NULL,
  storage_category TEXT NOT NULL
    CHECK (storage_category IN ('cold', 'frozen', 'room')),
  item_name TEXT NOT NULL,
  box_qty NUMERIC,
  unit_qty NUMERIC,
  remainder_g NUMERIC,
  box_weight_g NUMERIC NOT NULL DEFAULT 0,
  unit_weight_g NUMERIC NOT NULL DEFAULT 0,
  total_weight_g NUMERIC,
  expiry_or_lot TEXT,
  label_photo_url TEXT,
  conformity TEXT NOT NULL CHECK (conformity IN ('O', 'X')),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_daily_material_receiving_inspection_log_items_log_id
  ON public.daily_material_receiving_inspection_log_items (log_id);

COMMENT ON TABLE public.daily_material_receiving_inspection_log_items IS '원료 입고 검수 품목 라인. conformity O=적합 X=부적합.';
COMMENT ON COLUMN public.daily_material_receiving_inspection_log_items.label_photo_url IS '표시사항 사진: 공개 URL 또는 data URL(소용량)';

ALTER TABLE public.daily_material_receiving_inspection_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_material_receiving_inspection_log_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_material_receiving_inspection_logs_select"
  ON public.daily_material_receiving_inspection_logs FOR SELECT USING (true);
CREATE POLICY "daily_material_receiving_inspection_logs_insert"
  ON public.daily_material_receiving_inspection_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_material_receiving_inspection_logs_update"
  ON public.daily_material_receiving_inspection_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_material_receiving_inspection_logs_delete"
  ON public.daily_material_receiving_inspection_logs FOR DELETE USING (true);

CREATE POLICY "daily_material_receiving_inspection_log_items_select"
  ON public.daily_material_receiving_inspection_log_items FOR SELECT USING (true);
CREATE POLICY "daily_material_receiving_inspection_log_items_insert"
  ON public.daily_material_receiving_inspection_log_items FOR INSERT WITH CHECK (true);
CREATE POLICY "daily_material_receiving_inspection_log_items_update"
  ON public.daily_material_receiving_inspection_log_items FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "daily_material_receiving_inspection_log_items_delete"
  ON public.daily_material_receiving_inspection_log_items FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';
