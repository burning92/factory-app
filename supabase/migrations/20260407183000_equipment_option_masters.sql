-- ============================================================
-- 설비유형/대시보드그룹 옵션 마스터 (조직별)
-- - 기존 equipment_master CHECK 제약 완화(옵션 마스터와 충돌 방지)
-- - 기존 equipment_master 값은 옵션 테이블로 백필
-- ============================================================

-- 1) CHECK 제약 완화: 옵션 마스터 방식과 충돌하므로 제거
ALTER TABLE public.equipment_master DROP CONSTRAINT IF EXISTS equipment_master_equipment_type_check;
ALTER TABLE public.equipment_master DROP CONSTRAINT IF EXISTS equipment_master_dashboard_group_check;

-- lifecycle_status는 값 집계 로직에서 의미가 있으므로 CHECK 유지(이미 있으면 그대로)

-- 2) 설비유형 옵션
CREATE TABLE IF NOT EXISTS public.equipment_type_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (organization_code, code)
);

COMMENT ON TABLE public.equipment_type_options IS '제조설비등록: 설비유형 옵션(조직별).';

-- 3) 대시보드 그룹 옵션
CREATE TABLE IF NOT EXISTS public.equipment_dashboard_group_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (organization_code, code)
);

COMMENT ON TABLE public.equipment_dashboard_group_options IS '제조설비등록: 임원 대시보드 그룹 옵션(조직별).';

-- 4) 기본 시드 + 기존 값 백필(조직별)
-- code는 단순히 label을 그대로 사용(한글 허용) — 1차 안정성 우선

INSERT INTO public.equipment_type_options (organization_code, code, label, sort_order, is_active)
SELECT org.organization_code, x.code, x.label, x.sort_order, true
FROM (SELECT DISTINCT organization_code FROM public.equipment_master) org
CROSS JOIN (
  VALUES
    ('화덕', '화덕', 10),
    ('호이스트', '호이스트', 20),
    ('반죽기', '반죽기', 30),
    ('에어컴프레셔', '에어컴프레셔', 40),
    ('기타', '기타', 999)
) AS x(code, label, sort_order)
ON CONFLICT (organization_code, code) DO NOTHING;

INSERT INTO public.equipment_dashboard_group_options (organization_code, code, label, sort_order, is_active)
SELECT org.organization_code, x.code, x.label, x.sort_order, true
FROM (SELECT DISTINCT organization_code FROM public.equipment_master) org
CROSS JOIN (
  VALUES
    ('화덕', '화덕', 10),
    ('호이스트', '호이스트', 20),
    ('반죽기', '반죽기', 30),
    ('제조설비', '제조설비', 90)
) AS x(code, label, sort_order)
ON CONFLICT (organization_code, code) DO NOTHING;

-- 기존 equipment_master에서 실제 사용 중인 값도 옵션에 백필
INSERT INTO public.equipment_type_options (organization_code, code, label, sort_order, is_active)
SELECT organization_code, equipment_type, equipment_type, 200, true
FROM public.equipment_master
WHERE equipment_type IS NOT NULL AND TRIM(equipment_type) <> ''
GROUP BY organization_code, equipment_type
ON CONFLICT (organization_code, code) DO NOTHING;

INSERT INTO public.equipment_dashboard_group_options (organization_code, code, label, sort_order, is_active)
SELECT organization_code, dashboard_group, dashboard_group, 200, true
FROM public.equipment_master
WHERE dashboard_group IS NOT NULL AND TRIM(dashboard_group) <> ''
GROUP BY organization_code, dashboard_group
ON CONFLICT (organization_code, code) DO NOTHING;

-- 5) RLS: 읽기=authenticated, 쓰기=admin
ALTER TABLE public.equipment_type_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment_dashboard_group_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipment_type_options_select" ON public.equipment_type_options;
DROP POLICY IF EXISTS "equipment_type_options_insert" ON public.equipment_type_options;
DROP POLICY IF EXISTS "equipment_type_options_update" ON public.equipment_type_options;
DROP POLICY IF EXISTS "equipment_type_options_delete" ON public.equipment_type_options;

CREATE POLICY "equipment_type_options_select"
  ON public.equipment_type_options FOR SELECT TO authenticated USING (true);
CREATE POLICY "equipment_type_options_insert"
  ON public.equipment_type_options FOR INSERT TO authenticated
  WITH CHECK (public.get_my_profile_role() = 'admin');
CREATE POLICY "equipment_type_options_update"
  ON public.equipment_type_options FOR UPDATE TO authenticated
  USING (public.get_my_profile_role() = 'admin')
  WITH CHECK (public.get_my_profile_role() = 'admin');
CREATE POLICY "equipment_type_options_delete"
  ON public.equipment_type_options FOR DELETE TO authenticated
  USING (public.get_my_profile_role() = 'admin');

DROP POLICY IF EXISTS "equipment_dashboard_group_options_select" ON public.equipment_dashboard_group_options;
DROP POLICY IF EXISTS "equipment_dashboard_group_options_insert" ON public.equipment_dashboard_group_options;
DROP POLICY IF EXISTS "equipment_dashboard_group_options_update" ON public.equipment_dashboard_group_options;
DROP POLICY IF EXISTS "equipment_dashboard_group_options_delete" ON public.equipment_dashboard_group_options;

CREATE POLICY "equipment_dashboard_group_options_select"
  ON public.equipment_dashboard_group_options FOR SELECT TO authenticated USING (true);
CREATE POLICY "equipment_dashboard_group_options_insert"
  ON public.equipment_dashboard_group_options FOR INSERT TO authenticated
  WITH CHECK (public.get_my_profile_role() = 'admin');
CREATE POLICY "equipment_dashboard_group_options_update"
  ON public.equipment_dashboard_group_options FOR UPDATE TO authenticated
  USING (public.get_my_profile_role() = 'admin')
  WITH CHECK (public.get_my_profile_role() = 'admin');
CREATE POLICY "equipment_dashboard_group_options_delete"
  ON public.equipment_dashboard_group_options FOR DELETE TO authenticated
  USING (public.get_my_profile_role() = 'admin');

CREATE INDEX IF NOT EXISTS idx_equipment_type_options_org_active_sort
  ON public.equipment_type_options (organization_code, is_active, sort_order, label);
CREATE INDEX IF NOT EXISTS idx_equipment_dashboard_group_options_org_active_sort
  ON public.equipment_dashboard_group_options (organization_code, is_active, sort_order, label);

NOTIFY pgrst, 'reload schema';

