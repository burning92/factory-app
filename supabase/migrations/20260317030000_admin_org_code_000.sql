-- ============================================================
-- Admin 로그인도 숫자 회사코드 체계로 통일: master → 000
-- ============================================================

UPDATE public.organizations
SET organization_code = '000', name = '시스템관리'
WHERE organization_code = 'master';

-- organization_ui_settings는 organization_id FK로 연결되어 있으므로 코드 변경만 하면 됨

COMMENT ON COLUMN public.organizations.organization_code IS '사람 입력/표시용 코드. 숫자형(000=admin, 100=아머드프레시, 200=하랑 등).';

NOTIFY pgrst, 'reload schema';
