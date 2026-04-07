-- ============================================================
-- 제조설비 마스터 + 설비이력기록부 + 후속 결과(누적)
-- equipment_incidents는 선택적으로 equipment_master 참조 가능(향후 연동)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.equipment_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code TEXT NOT NULL,
  management_no TEXT NOT NULL,
  equipment_name TEXT NOT NULL,
  install_location TEXT NOT NULL,
  purpose TEXT NOT NULL,
  purchased_at DATE,
  supplier_name TEXT,
  supplier_contact TEXT,
  manufacturer_name TEXT,
  manufacturer_contact TEXT,
  specification TEXT,
  voltage TEXT,
  photo_url TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (organization_code, management_no)
);

CREATE INDEX IF NOT EXISTS idx_equipment_master_org_active
  ON public.equipment_master (organization_code, is_active);
CREATE INDEX IF NOT EXISTS idx_equipment_master_org_name
  ON public.equipment_master (organization_code, equipment_name);

COMMENT ON TABLE public.equipment_master IS '제조설비 등록(관리번호·설비명 분리). 설비이력기록부 드롭다운 소스.';

CREATE TABLE IF NOT EXISTS public.equipment_history_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code TEXT NOT NULL,
  equipment_id UUID NOT NULL REFERENCES public.equipment_master(id) ON DELETE RESTRICT,
  record_date DATE NOT NULL,
  issue_detail TEXT NOT NULL,
  emergency_action TEXT,
  repair_detail TEXT,
  notes TEXT,
  closure_status TEXT NOT NULL DEFAULT 'ongoing'
    CHECK (closure_status IN ('ongoing', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_equipment_history_records_org_date
  ON public.equipment_history_records (organization_code, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_history_records_equipment
  ON public.equipment_history_records (equipment_id, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_history_records_closure
  ON public.equipment_history_records (organization_code, closure_status);

COMMENT ON TABLE public.equipment_history_records IS '설비이력기록부 본문(초기 고장·조치). 후속 결과는 equipment_history_updates.';

CREATE TABLE IF NOT EXISTS public.equipment_history_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  history_record_id UUID NOT NULL REFERENCES public.equipment_history_records(id) ON DELETE CASCADE,
  result_date DATE NOT NULL,
  result_detail TEXT NOT NULL,
  assignee TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_equipment_history_updates_record
  ON public.equipment_history_updates (history_record_id, result_date DESC);

COMMENT ON TABLE public.equipment_history_updates IS '설비이력기록부 후속 조치·결과 누적.';

-- 설비 이상(기존) → 마스터 선택 연동(선택)
ALTER TABLE public.equipment_incidents
  ADD COLUMN IF NOT EXISTS equipment_master_id UUID REFERENCES public.equipment_master(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_incidents_equipment_master_id
  ON public.equipment_incidents (equipment_master_id);

-- RLS
ALTER TABLE public.equipment_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_history_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_history_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipment_master_select" ON public.equipment_master;
DROP POLICY IF EXISTS "equipment_master_insert" ON public.equipment_master;
DROP POLICY IF EXISTS "equipment_master_update" ON public.equipment_master;
DROP POLICY IF EXISTS "equipment_master_delete" ON public.equipment_master;

CREATE POLICY "equipment_master_select"
  ON public.equipment_master FOR SELECT TO authenticated USING (true);

CREATE POLICY "equipment_master_insert"
  ON public.equipment_master FOR INSERT TO authenticated
  WITH CHECK (public.get_my_profile_role() = 'admin');

CREATE POLICY "equipment_master_update"
  ON public.equipment_master FOR UPDATE TO authenticated
  USING (public.get_my_profile_role() = 'admin')
  WITH CHECK (public.get_my_profile_role() = 'admin');

CREATE POLICY "equipment_master_delete"
  ON public.equipment_master FOR DELETE TO authenticated
  USING (public.get_my_profile_role() = 'admin');

DROP POLICY IF EXISTS "equipment_history_records_select" ON public.equipment_history_records;
DROP POLICY IF EXISTS "equipment_history_records_insert" ON public.equipment_history_records;
DROP POLICY IF EXISTS "equipment_history_records_update" ON public.equipment_history_records;
DROP POLICY IF EXISTS "equipment_history_records_delete" ON public.equipment_history_records;

CREATE POLICY "equipment_history_records_select"
  ON public.equipment_history_records FOR SELECT TO authenticated USING (true);

CREATE POLICY "equipment_history_records_insert"
  ON public.equipment_history_records FOR INSERT TO authenticated
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin'));

CREATE POLICY "equipment_history_records_update"
  ON public.equipment_history_records FOR UPDATE TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin'));

CREATE POLICY "equipment_history_records_delete"
  ON public.equipment_history_records FOR DELETE TO authenticated
  USING (public.get_my_profile_role() = 'admin');

DROP POLICY IF EXISTS "equipment_history_updates_select" ON public.equipment_history_updates;
DROP POLICY IF EXISTS "equipment_history_updates_insert" ON public.equipment_history_updates;
DROP POLICY IF EXISTS "equipment_history_updates_update" ON public.equipment_history_updates;
DROP POLICY IF EXISTS "equipment_history_updates_delete" ON public.equipment_history_updates;

CREATE POLICY "equipment_history_updates_select"
  ON public.equipment_history_updates FOR SELECT TO authenticated USING (true);

CREATE POLICY "equipment_history_updates_insert"
  ON public.equipment_history_updates FOR INSERT TO authenticated
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin'));

CREATE POLICY "equipment_history_updates_update"
  ON public.equipment_history_updates FOR UPDATE TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin'))
  WITH CHECK (public.get_my_profile_role() IN ('manager', 'admin'));

CREATE POLICY "equipment_history_updates_delete"
  ON public.equipment_history_updates FOR DELETE TO authenticated
  USING (public.get_my_profile_role() = 'admin');

NOTIFY pgrst, 'reload schema';
