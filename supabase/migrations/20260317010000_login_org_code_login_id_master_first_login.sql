-- ============================================================
-- v1 로그인 규칙 확정: organization_code + login_id, must_change_password, master
-- ============================================================

-- profiles: login_id, must_change_password 추가 / role에 'master' 추가
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS login_id TEXT,
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT true;

-- 기존 행 backfill: auth.users 이메일에서 @ 앞부분을 login_id로, 첫 로그인 아님
UPDATE public.profiles p
SET
  login_id = COALESCE(
    NULLIF(TRIM(SPLIT_PART(u.email, '@', 1)), ''),
    'user'
  ),
  must_change_password = false
FROM auth.users u
WHERE p.id = u.id AND (p.login_id IS NULL OR p.login_id = '');

-- 기본값
UPDATE public.profiles SET login_id = 'user' WHERE login_id IS NULL OR login_id = '';
ALTER TABLE public.profiles ALTER COLUMN login_id SET NOT NULL;

-- role check에 'master' 추가
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('worker', 'manager', 'admin', 'master'));

-- (organization_id, login_id) 유일
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_org_login_id
  ON public.profiles (organization_id, login_id);

COMMENT ON COLUMN public.profiles.login_id IS '로그인 아이디 (이름01 등). 조직 내 유일.';
COMMENT ON COLUMN public.profiles.must_change_password IS '첫 로그인 후 비밀번호 변경 필요 여부.';

-- 마스터 조직 + UI 설정
INSERT INTO public.organizations (organization_code, name)
VALUES ('master', '시스템관리')
ON CONFLICT (organization_code) DO NOTHING;

INSERT INTO public.organization_ui_settings (organization_id, brand_name, default_landing_path)
SELECT id, name, '/manage'
FROM public.organizations
WHERE organization_code = 'master'
ON CONFLICT (organization_id) DO UPDATE SET updated_at = now();

-- RLS: master는 모든 profiles 조회/수정, organizations 전체 관리
CREATE POLICY "profiles_select_master"
  ON public.profiles FOR SELECT
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'master'
  );

CREATE POLICY "profiles_update_master"
  ON public.profiles FOR UPDATE
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'master'
  )
  WITH CHECK (true);

CREATE POLICY "organizations_all_master"
  ON public.organizations FOR ALL
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'master'
  )
  WITH CHECK (true);

-- organization_ui_settings: master가 수정 가능
CREATE POLICY "organization_ui_settings_all_master"
  ON public.organization_ui_settings FOR ALL
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'master'
  )
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
