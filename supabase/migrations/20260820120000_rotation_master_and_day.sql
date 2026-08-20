-- 작업 로테이션: 포지션·우선순위 마스터 + 날짜별 출근/수동배치

CREATE TABLE IF NOT EXISTS public.rotation_workers (
  organization_code TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  name TEXT NOT NULL,
  preferred TEXT NOT NULL,
  shift TEXT NOT NULL DEFAULT '0800-1800',
  worker_group TEXT NOT NULL DEFAULT 'floor',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_code, worker_id)
);

CREATE TABLE IF NOT EXISTS public.rotation_positions (
  organization_code TEXT NOT NULL,
  product_group TEXT NOT NULL,
  position_id TEXT NOT NULL,
  process TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_code, product_group, position_id)
);

CREATE TABLE IF NOT EXISTS public.rotation_priorities (
  organization_code TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  product_group TEXT NOT NULL,
  position_id TEXT NOT NULL,
  priority SMALLINT NOT NULL CHECK (priority BETWEEN 0 AND 5),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_code, worker_id, product_group, position_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS rotation_priorities_unique_rank
  ON public.rotation_priorities (organization_code, product_group, position_id, priority)
  WHERE priority BETWEEN 1 AND 4;

CREATE TABLE IF NOT EXISTS public.rotation_day_meta (
  organization_code TEXT NOT NULL,
  work_date DATE NOT NULL,
  product_line TEXT NOT NULL DEFAULT 'phono_signature',
  lunch BOOLEAN NOT NULL DEFAULT true,
  break_rotation BOOLEAN NOT NULL DEFAULT false,
  split_shift BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_code, work_date)
);

CREATE TABLE IF NOT EXISTS public.rotation_day_attendance (
  organization_code TEXT NOT NULL,
  work_date DATE NOT NULL,
  worker_id TEXT NOT NULL,
  present BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (organization_code, work_date, worker_id)
);

CREATE TABLE IF NOT EXISTS public.rotation_day_assignments (
  organization_code TEXT NOT NULL,
  work_date DATE NOT NULL,
  period_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  station TEXT NOT NULL,
  position_id TEXT,
  priority SMALLINT,
  is_manual BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (organization_code, work_date, period_id, worker_id)
);

COMMENT ON TABLE public.rotation_workers IS '작업 로테이션 인원 마스터(주공정·출근조). 일일 출근 여부는 rotation_day_attendance.';
COMMENT ON TABLE public.rotation_positions IS '제품군별 세부포지션 마스터.';
COMMENT ON TABLE public.rotation_priorities IS '작업자×제품군×포지션 후보 순번(1~4 유일, 5 비상, 0 불가).';
COMMENT ON TABLE public.rotation_day_attendance IS '작업일별 출근 여부.';
COMMENT ON TABLE public.rotation_day_assignments IS '작업일별 배치. is_manual=true 는 수동 수정분.';

ALTER TABLE public.rotation_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotation_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotation_priorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotation_day_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotation_day_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotation_day_assignments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rotation_workers',
    'rotation_positions',
    'rotation_priorities',
    'rotation_day_meta',
    'rotation_day_attendance',
    'rotation_day_assignments'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (organization_code = public.get_my_organization_code() OR public.get_my_organization_code() = ''000'')',
      t || '_select', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (
        (organization_code = public.get_my_organization_code() OR public.get_my_organization_code() = ''000'')
        AND public.get_my_profile_role() IN (''manager'', ''admin'', ''quality_manager'', ''headquarters'')
      ) WITH CHECK (
        (organization_code = public.get_my_organization_code() OR public.get_my_organization_code() = ''000'')
        AND public.get_my_profile_role() IN (''manager'', ''admin'', ''quality_manager'', ''headquarters'')
      )',
      t || '_write', t
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
