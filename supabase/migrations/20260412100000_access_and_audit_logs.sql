-- 접속 로그 / 감사 로그 (관리자 조회 전용)

CREATE TABLE IF NOT EXISTS public.access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  login_id TEXT,
  display_name TEXT,
  role TEXT,
  event TEXT NOT NULL DEFAULT 'page_view',
  page_path TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON public.access_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_user_id_created_at ON public.access_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_page_path_created_at ON public.access_logs (page_path, created_at DESC);

COMMENT ON TABLE public.access_logs IS '접속/페이지 진입 이력. 관리자만 조회.';
COMMENT ON COLUMN public.access_logs.event IS '접속 이벤트 종류(page_view 등)';

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  actor_login_id TEXT,
  actor_display_name TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT,
  target_label TEXT,
  before_data JSONB,
  after_data JSONB,
  meta JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created_at ON public.audit_logs (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs (target_table, target_id);

COMMENT ON TABLE public.audit_logs IS '데이터 변경 감사 로그. 관리자만 조회.';
COMMENT ON COLUMN public.audit_logs.action IS 'create/update/delete/approve/reject/login 등';

ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "access_logs_select_admin" ON public.access_logs;
CREATE POLICY "access_logs_select_admin"
  ON public.access_logs FOR SELECT TO authenticated
  USING (public.get_my_profile_role() = 'admin');

DROP POLICY IF EXISTS "access_logs_insert_own" ON public.access_logs;
CREATE POLICY "access_logs_insert_own"
  ON public.access_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_select_admin"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.get_my_profile_role() = 'admin');

DROP POLICY IF EXISTS "audit_logs_insert_own" ON public.audit_logs;
CREATE POLICY "audit_logs_insert_own"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = actor_user_id);

NOTIFY pgrst, 'reload schema';
