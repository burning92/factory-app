-- ============================================================
-- 설비이력기록부 단일화: 설비 이상 이력(equipment_incidents) → equipment_history_records
-- 1) 설비이력기록부에 구분·생산영향·재가동일시·점검표 연동·이관 원본 컬럼 추가
-- 2) 기록부에 이미 있는 3건(중복)은 추가 정보만 보강
-- 3) 나머지 12건은 관리번호를 지정해 이관 (legacy_incident_id 로 재실행 안전)
-- equipment_incidents 테이블은 백업용으로 유지
-- ============================================================

ALTER TABLE public.equipment_history_records
  ADD COLUMN IF NOT EXISTS incident_type TEXT
    CHECK (incident_type IS NULL OR incident_type IN ('이상', '고장', '가동중지')),
  ADD COLUMN IF NOT EXISTS has_production_impact BOOLEAN,
  ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS linked_inspection_id UUID
    REFERENCES public.daily_manufacturing_equipment_logs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_inspection_item_id UUID,
  ADD COLUMN IF NOT EXISTS legacy_incident_id UUID UNIQUE;

COMMENT ON COLUMN public.equipment_history_records.incident_type IS '구분: 이상/고장/가동중지';
COMMENT ON COLUMN public.equipment_history_records.has_production_impact IS '생산영향 여부';
COMMENT ON COLUMN public.equipment_history_records.resumed_at IS '재가동일시';
COMMENT ON COLUMN public.equipment_history_records.linked_inspection_id IS '제조설비 점검일지 부적합 연동 시 일지 ID';
COMMENT ON COLUMN public.equipment_history_records.legacy_incident_id IS '설비 이상 이력(equipment_incidents)에서 이관된 원본 ID';

-- 동일 점검일지에서 같은 설비로 중복 연동 방지 (일지 저장 시 반복 호출됨)
CREATE UNIQUE INDEX IF NOT EXISTS equipment_history_records_unique_linked_inspection
  ON public.equipment_history_records (linked_inspection_id, equipment_id)
  WHERE linked_inspection_id IS NOT NULL;

-- 2) 중복 3건: 기존 기록부 항목에 추가 정보만 보강
WITH dup(incident_id, management_no, record_date) AS (
  VALUES
    ('b7149c8f-3aef-4ea8-817e-3bd5f617dea7'::uuid, 'FP-812-1-2',   DATE '2024-12-19'),
    ('36c60d65-a8e4-41fe-b297-001bce9bad85'::uuid, 'FP-812-1-14',  DATE '2025-12-15'),
    ('8c8bbd13-04b5-4183-a42a-c8f91a1a8689'::uuid, 'FP-812-1-2-1', DATE '2025-12-18')
),
target AS (
  SELECT DISTINCT ON (d.incident_id) r.id AS record_id, i.*
  FROM dup d
  JOIN public.equipment_incidents i ON i.id = d.incident_id
  JOIN public.equipment_master m
    ON m.organization_code = i.organization_code AND m.management_no = d.management_no
  JOIN public.equipment_history_records r
    ON r.equipment_id = m.id AND r.record_date = d.record_date
  WHERE NOT EXISTS (
    SELECT 1 FROM public.equipment_history_records x WHERE x.legacy_incident_id = d.incident_id
  )
  ORDER BY d.incident_id, r.created_at
)
UPDATE public.equipment_history_records r
SET incident_type = t.incident_type,
    has_production_impact = t.has_production_impact,
    resumed_at = t.resumed_at,
    notes = CASE
      WHEN t.notes IS NULL OR t.notes = '' THEN r.notes
      ELSE CONCAT_WS(E'\n', NULLIF(r.notes, ''), t.notes)
    END,
    legacy_incident_id = t.id,
    updated_at = now()
FROM target t
WHERE r.id = t.record_id
  AND r.legacy_incident_id IS NULL;

-- 3) 12건 이관
WITH map(incident_id, management_no) AS (
  VALUES
    ('312c3cef-8d05-4659-af7c-e9a262c6935f'::uuid, 'FP-812-1-2'),
    ('8a7d6d46-85b0-436d-a473-2fe9bd53216d'::uuid, 'FP-812-1-2-1'),
    ('b22d77de-cbcc-4814-9d09-0eee6457fb23'::uuid, 'FP-812-1-15'),
    ('4a7491fa-a08f-440e-b040-cd6c2bb337c0'::uuid, 'FP-812-1-2-1'),
    ('0139451c-006c-4e09-a8a2-7ee20d54f239'::uuid, 'FP-812-1-2-1'),
    ('16cc4117-6253-4642-ab95-b92387662706'::uuid, 'FP-812-1-2-1'),
    ('ede9a6b6-9900-4a3c-8447-8e7e1a1c30e8'::uuid, 'FP-812-1-15'),
    ('ca7787f2-c711-4d48-9aad-9ab2b544e284'::uuid, 'FP-812-1-16'),
    ('064d6d45-e679-4345-b9cf-b2496a481f14'::uuid, 'FP-812-1-13'),
    ('27b2451c-df05-40c0-944a-94f7f4ae98d1'::uuid, 'FP-812-1-5'),
    ('456d1685-3c0e-49e5-b592-b4d3708935d0'::uuid, 'FP-812-1-17'),
    ('79abd1b8-4909-4846-bafe-559e499ad473'::uuid, 'FP-812-1-17')
)
INSERT INTO public.equipment_history_records (
  organization_code, equipment_id, record_date, issue_detail, notes, closure_status,
  incident_type, has_production_impact, resumed_at,
  linked_inspection_id, linked_inspection_item_id, legacy_incident_id,
  created_at, updated_at, created_by, created_by_name
)
SELECT
  i.organization_code,
  m.id,
  (i.occurred_at AT TIME ZONE 'Asia/Seoul')::date,
  i.detail,
  NULLIF(CONCAT_WS(E'\n',
    '증상: ' || CASE WHEN i.symptom_type = '기타' THEN COALESCE(i.symptom_other, '기타') ELSE i.symptom_type END,
    NULLIF(i.notes, '')
  ), ''),
  CASE WHEN i.action_status = '조치완료' THEN 'closed' ELSE 'ongoing' END,
  i.incident_type,
  i.has_production_impact,
  i.resumed_at,
  i.linked_inspection_id,
  i.linked_inspection_item_id,
  i.id,
  i.created_at,
  now(),
  i.created_by,
  COALESCE(NULLIF(TRIM(p.display_name), ''), p.login_id)
FROM map
JOIN public.equipment_incidents i ON i.id = map.incident_id
JOIN public.equipment_master m
  ON m.organization_code = i.organization_code AND m.management_no = map.management_no
LEFT JOIN public.profiles p ON p.id = i.created_by
ON CONFLICT (legacy_incident_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
