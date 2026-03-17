-- ============================================================
-- v1: organizations, organization_ui_settings, profiles
-- 로그인 + organization scope + 조직별 UI 분기용
-- ============================================================

-- S1: organizations
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organizations IS '조직(회사). organization_code=로그인/표시용, id=데이터 join용.';

INSERT INTO public.organizations (organization_code, name)
VALUES ('armored', '아머드프레시')
ON CONFLICT (organization_code) DO NOTHING;

-- S1b: organization_ui_settings (1:1 per organization)
CREATE TABLE IF NOT EXISTS public.organization_ui_settings (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  logo_url TEXT,
  brand_name TEXT NOT NULL DEFAULT '생산관리',
  primary_color TEXT,
  menu_config JSONB,
  home_cards_config JSONB,
  default_landing_path TEXT DEFAULT '/',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organization_ui_settings IS '조직별 UI 설정. 로고/브랜드명/색상/메뉴/홈 카드/기본 랜딩.';

INSERT INTO public.organization_ui_settings (organization_id, brand_name, default_landing_path)
SELECT id, name, '/'
FROM public.organizations
WHERE organization_code = 'armored'
ON CONFLICT (organization_id) DO UPDATE SET
  brand_name = EXCLUDED.brand_name,
  updated_at = now();

-- S2: profiles (1:1 with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'worker' CHECK (role IN ('worker', 'manager', 'admin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS '사용자 프로필. auth.users와 1:1. organization_id=소속, display_name=작성자 자동입력용.';

CREATE INDEX IF NOT EXISTS idx_profiles_organization_id ON public.profiles (organization_id);

-- RLS: profiles — 본인만 읽기/수정, 본인 행만 insert 허용 (가입 시 1회)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- RLS: organizations — 인증된 사용자 읽기 허용 (scope 결정용)
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organizations_select_authenticated"
  ON public.organizations FOR SELECT
  TO authenticated
  USING (true);

-- RLS: organization_ui_settings — 인증된 사용자 읽기 허용
ALTER TABLE public.organization_ui_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organization_ui_settings_select_authenticated"
  ON public.organization_ui_settings FOR SELECT
  TO authenticated
  USING (true);

-- S3: 기존 auth.users에 대해 profiles 행 생성 (기본 조직, worker)
INSERT INTO public.profiles (id, organization_id, display_name, role)
SELECT
  u.id,
  (SELECT id FROM public.organizations WHERE organization_code = 'armored' LIMIT 1),
  COALESCE(
    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(u.raw_user_meta_data->>'display_name'), ''),
    split_part(u.email, '@', 1),
    'user'
  ),
  'worker'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);

NOTIFY pgrst, 'reload schema';
