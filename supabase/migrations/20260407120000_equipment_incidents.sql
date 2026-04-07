-- 설비 이상(고장·가동중지·이상) 이력 — 정기 점검 부적합과 분리
-- ============================================================

CREATE TABLE IF NOT EXISTS public.equipment_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code TEXT NOT NULL,
  equipment_name TEXT NOT NULL CHECK (equipment_name IN ('화덕', '호이스트', '기타')),
  equipment_custom_name TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  incident_type TEXT NOT NULL CHECK (incident_type IN ('이상', '고장', '가동중지')),
  symptom_type TEXT NOT NULL CHECK (symptom_type IN ('소음', '작동불량', '체인 이상', '버튼 불량', '기타')),
  symptom_other TEXT,
  detail TEXT NOT NULL,
  has_production_impact BOOLEAN NOT NULL DEFAULT false,
  action_status TEXT NOT NULL CHECK (action_status IN ('확인중', '수리요청', '수리중', '조치완료')),
  resumed_at TIMESTAMPTZ,
  notes TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'linked_from_inspection')),
  linked_inspection_id UUID REFERENCES public.daily_manufacturing_equipment_logs(id) ON DELETE SET NULL,
  linked_inspection_item_id UUID REFERENCES public.daily_manufacturing_equipment_log_items(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_equipment_incidents_org_occurred
  ON public.equipment_incidents (organization_code, occurred_at DESC);
CREATE INDEX idx_equipment_incidents_org_equipment
  ON public.equipment_incidents (organization_code, equipment_name, occurred_at DESC);

COMMENT ON TABLE public.equipment_incidents IS '제조설비 실제 이상·고장·가동중지 이력(점검표와 별도)';

-- 동일 점검일지에서 같은 주요 설비로 중복 연동 방지
CREATE UNIQUE INDEX equipment_incidents_unique_linked_log_equipment
  ON public.equipment_incidents (linked_inspection_id, equipment_name)
  WHERE linked_inspection_id IS NOT NULL AND source_type = 'linked_from_inspection';

ALTER TABLE public.equipment_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "equipment_incidents_select" ON public.equipment_incidents FOR SELECT USING (true);
CREATE POLICY "equipment_incidents_insert" ON public.equipment_incidents FOR INSERT WITH CHECK (true);
CREATE POLICY "equipment_incidents_update" ON public.equipment_incidents FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "equipment_incidents_delete" ON public.equipment_incidents FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';
