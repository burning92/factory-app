-- ============================================================
-- equipment_master: 설비유형·호기·위치·운영상태·대시보드 그룹 확장
-- ============================================================

ALTER TABLE public.equipment_master
  ADD COLUMN IF NOT EXISTS equipment_type TEXT NOT NULL DEFAULT '기타',
  ADD COLUMN IF NOT EXISTS unit_no SMALLINT,
  ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS floor_label TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT '운영중',
  ADD COLUMN IF NOT EXISTS dashboard_group TEXT,
  ADD COLUMN IF NOT EXISTS dashboard_visible BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS installed_at DATE,
  ADD COLUMN IF NOT EXISTS removed_at DATE,
  ADD COLUMN IF NOT EXISTS replaced_from_equipment_id UUID REFERENCES public.equipment_master(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaced_by_equipment_id UUID REFERENCES public.equipment_master(id) ON DELETE SET NULL;

ALTER TABLE public.equipment_master DROP CONSTRAINT IF EXISTS equipment_master_equipment_type_check;
ALTER TABLE public.equipment_master ADD CONSTRAINT equipment_master_equipment_type_check
  CHECK (equipment_type IN ('화덕', '호이스트', '반죽기', '에어컴프레셔', '기타'));

ALTER TABLE public.equipment_master DROP CONSTRAINT IF EXISTS equipment_master_lifecycle_status_check;
ALTER TABLE public.equipment_master ADD CONSTRAINT equipment_master_lifecycle_status_check
  CHECK (lifecycle_status IN ('운영중', '예비', '사용중지', '철거'));

ALTER TABLE public.equipment_master DROP CONSTRAINT IF EXISTS equipment_master_dashboard_group_check;
ALTER TABLE public.equipment_master ADD CONSTRAINT equipment_master_dashboard_group_check
  CHECK (dashboard_group IS NULL OR dashboard_group IN ('화덕', '호이스트', '반죽기'));

COMMENT ON COLUMN public.equipment_master.equipment_type IS '설비 유형';
COMMENT ON COLUMN public.equipment_master.unit_no IS '호기(숫자), 없으면 null';
COMMENT ON COLUMN public.equipment_master.display_name IS '화면 표시명 (예: 화덕 2호기)';
COMMENT ON COLUMN public.equipment_master.floor_label IS '층 (예: 2층, 3층)';
COMMENT ON COLUMN public.equipment_master.lifecycle_status IS '운영중/예비/사용중지/철거';
COMMENT ON COLUMN public.equipment_master.dashboard_group IS '임원 대시보드 그룹; null이면 그룹 미배정';
COMMENT ON COLUMN public.equipment_master.dashboard_visible IS '대시보드 노출 여부';
COMMENT ON COLUMN public.equipment_master.installed_at IS '설치일';
COMMENT ON COLUMN public.equipment_master.removed_at IS '철거일';

-- 기존 행 백필
UPDATE public.equipment_master SET display_name = equipment_name WHERE TRIM(display_name) = '';
UPDATE public.equipment_master SET installed_at = purchased_at WHERE installed_at IS NULL AND purchased_at IS NOT NULL;

UPDATE public.equipment_master SET lifecycle_status = CASE WHEN is_active THEN '운영중' ELSE '사용중지' END;

UPDATE public.equipment_master SET equipment_type = CASE
  WHEN equipment_name LIKE '%화덕%' OR equipment_name LIKE '%오븐%' THEN '화덕'
  WHEN equipment_name LIKE '%호이스트%' THEN '호이스트'
  WHEN equipment_name LIKE '%반죽%' THEN '반죽기'
  WHEN equipment_name LIKE '%컴프레셔%' OR equipment_name LIKE '%컴프레서%' THEN '에어컴프레셔'
  ELSE '기타'
END WHERE equipment_type = '기타';

UPDATE public.equipment_master SET dashboard_group = CASE
  WHEN equipment_name LIKE '%화덕%' OR equipment_name LIKE '%오븐%' THEN '화덕'
  WHEN equipment_name LIKE '%호이스트%' THEN '호이스트'
  WHEN equipment_name LIKE '%반죽%' THEN '반죽기'
  ELSE NULL
END WHERE dashboard_group IS NULL;

UPDATE public.equipment_master SET is_active = (lifecycle_status IN ('운영중', '예비'));

CREATE INDEX IF NOT EXISTS idx_equipment_master_org_dashboard
  ON public.equipment_master (organization_code, dashboard_group, lifecycle_status)
  WHERE dashboard_visible = true;

NOTIFY pgrst, 'reload schema';
